-- Disposable CI only; cron/network are stubbed to prevent external deliveries.
do $$ begin if current_database()<>'charges_ci' then raise exception 'Disposable CI database required'; end if; end $$;
create role service_role nologin bypassrls;
alter table auth.users add column created_at timestamptz not null default now();
alter table public.notifications add column created_at timestamptz not null default now();
create table private.push_delivery_settings(singleton boolean primary key default true check(singleton),webhook_secret text not null);
create table public.web_push_subscriptions(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,p256dh text not null,auth text not null,created_at timestamptz not null default now(),last_success_at timestamptz
);
alter table public.web_push_subscriptions enable row level security;
create policy push_read on public.web_push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy push_insert on public.web_push_subscriptions for insert to authenticated with check(user_id=(select auth.uid()));
create policy push_delete on public.web_push_subscriptions for delete to authenticated using(user_id=(select auth.uid()));
grant select,insert,delete on public.web_push_subscriptions to authenticated;
create schema cron;
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create schema net;
create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
create function private.dispatch_notification_push() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger notifications_push after insert on public.notifications for each row execute function private.dispatch_notification_push();
