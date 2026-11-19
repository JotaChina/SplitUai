-- Durable inbox remains authoritative; Push is an independent, best-effort channel.
alter table private.push_delivery_settings add column function_url text not null default 'http://kong:8000/functions/v1/send-web-push';
alter table private.push_delivery_settings add column queue_started_at timestamptz not null default now();
alter table public.web_push_subscriptions add column invalidated_at timestamptz;
alter table public.web_push_subscriptions add column last_confirmed_at timestamptz;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','accepted','failed','expired')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  lease_until timestamptz,
  lease_token uuid,
  last_status integer,
  last_error text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);
create index push_deliveries_due on public.push_deliveries(next_attempt_at) where status in ('pending','processing');
create index push_deliveries_user_test on public.push_deliveries(user_id,created_at desc) where notification_id is null;
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public,anon,authenticated;
grant select on public.push_deliveries to authenticated;
create policy push_delivery_read_own on public.push_deliveries for select to authenticated using (user_id=(select auth.uid()));
grant all on public.push_deliveries to service_role;

-- Possession of both encryption keys proves control of an existing subscription.
-- A known endpoint alone cannot take over another account's device.
create function public.register_push_device(p_endpoint text,p_p256dh text,p_auth text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_endpoint)>2048 or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|updates\.push\.services\.mozilla\.org|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
     or p_p256dh !~ '^[A-Za-z0-9_-]{87}=?$' or p_auth !~ '^[A-Za-z0-9_-]{22}={0,2}$'
     or p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'Invalid or unsupported subscription';
  end if;
  insert into public.web_push_subscriptions(user_id,endpoint,p256dh,auth,last_confirmed_at)
    values(v_user,p_endpoint,p_p256dh,p_auth,now())
    on conflict(endpoint) do update set user_id=excluded.user_id,invalidated_at=null,last_confirmed_at=now(),
      created_at=case when web_push_subscriptions.user_id<>excluded.user_id then now() else web_push_subscriptions.created_at end
    where web_push_subscriptions.p256dh=excluded.p256dh and web_push_subscriptions.auth=excluded.auth
    returning id into v_id;
  if v_id is null then raise exception 'Subscription ownership could not be verified' using errcode='42501'; end if;
  delete from public.push_deliveries where subscription_id=v_id and user_id<>v_user;
  return v_id;
end $$;
revoke all on function public.register_push_device(text,text,text) from public,anon;
grant execute on function public.register_push_device(text,text,text) to authenticated;
-- All new registrations must use the ownership-aware RPC, not a client upsert.
revoke insert,update on public.web_push_subscriptions from authenticated;
revoke update(user_id,endpoint,p256dh,auth) on public.web_push_subscriptions from authenticated;

create table private.push_test_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null
);
revoke all on private.push_test_limits from public,anon,authenticated;

create function public.enqueue_push_test(p_subscription_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,0));
  perform 1 from public.web_push_subscriptions where id=p_subscription_id and user_id=v_user for update;
  if not found then raise exception 'Device not found' using errcode='42501'; end if;
  if exists(select 1 from private.push_test_limits where user_id=v_user and requested_at>now()-interval '1 minute') then
    raise exception 'Wait one minute before testing again' using errcode='P0001';
  end if;
  insert into private.push_test_limits values(v_user,now()) on conflict(user_id) do update set requested_at=excluded.requested_at;
  insert into public.push_deliveries(subscription_id,user_id,expires_at)
    values(p_subscription_id,v_user,now()+interval '10 minutes') returning id into v_id;
  return v_id;
end $$;
revoke all on function public.enqueue_push_test(uuid) from public,anon;
grant execute on function public.enqueue_push_test(uuid) to authenticated;

-- Fast wakeup is optional: failure here never aborts a business transaction.
create function private.wake_push_worker()
returns void language plpgsql security definer set search_path='' as $$
declare v_secret text; v_url text;
begin
  select webhook_secret,function_url into v_secret,v_url from private.push_delivery_settings where singleton;
  if v_secret is not null and exists(select 1 from public.push_deliveries where status in ('pending','processing') and next_attempt_at<=now()) then
    perform net.http_post(url:=v_url, body:='{}'::jsonb,
      headers:=jsonb_build_object('Content-Type','application/json','x-push-webhook-secret',v_secret), timeout_milliseconds:=5000);
  end if;
exception when others then raise warning 'Push worker wakeup failed; scheduled recovery will retry';
end $$;
revoke all on function private.wake_push_worker() from public,anon,authenticated;

create or replace function private.dispatch_notification_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.push_deliveries(notification_id,subscription_id,user_id,expires_at)
    select new.id,s.id,new.user_id,new.created_at+interval '24 hours'
    from public.web_push_subscriptions s where s.user_id=new.user_id and s.invalidated_at is null on conflict do nothing;
  perform private.wake_push_worker();
  return new;
exception when others then
  raise warning 'Push enqueue failed; inbox preserved and scheduled recovery will retry';
  return new;
end $$;

create function public.claim_push_deliveries()
returns setof public.push_deliveries language plpgsql security definer set search_path='' as $$
begin
  update public.push_deliveries set status='expired',lease_token=null,lease_until=null
    where status in ('pending','processing') and (expires_at<=now() or (attempts>=6 and coalesce(lease_until,now())<=now()));
  return query
    with due as (
      select d.id from public.push_deliveries d
      join public.web_push_subscriptions s on s.id=d.subscription_id and s.user_id=d.user_id and s.invalidated_at is null
      where d.status in ('pending','processing') and d.next_attempt_at<=now()
        and (d.lease_until is null or d.lease_until<=now()) and d.attempts<6 and d.expires_at>now()
      order by d.next_attempt_at limit 10 for update of d skip locked
    ) update public.push_deliveries d set status='processing',attempts=d.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
      from due where d.id=due.id returning d.*;
end $$;
revoke all on function public.claim_push_deliveries() from public,anon,authenticated;
grant execute on function public.claim_push_deliveries() to service_role;

-- Every minute: recover an enqueue failure, reclaim expired leases, wake worker.
-- New devices never receive old notifications; no historical bulk push.
create function private.recover_push_queue()
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.push_deliveries(notification_id,subscription_id,user_id,expires_at)
    select n.id,s.id,n.user_id,n.created_at+interval '24 hours'
    from public.notifications n join public.web_push_subscriptions s on s.user_id=n.user_id and s.created_at<=n.created_at and s.invalidated_at is null
    where n.created_at>greatest(now()-interval '24 hours',(select queue_started_at from private.push_delivery_settings where singleton))
    on conflict do nothing;
  perform private.wake_push_worker();
  -- Bounded diagnostic retention; no endpoint/key/payload is copied to the queue.
  delete from public.push_deliveries where created_at<now()-interval '14 days' and status in ('accepted','failed','expired');
end $$;
revoke all on function private.recover_push_queue() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('splituai-push-recovery','* * * * *','select private.recover_push_queue()');
