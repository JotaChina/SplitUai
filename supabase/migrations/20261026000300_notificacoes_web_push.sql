-- Inbox notifications are durable in-app events. Push is an optional delivery channel.
alter table public.group_invitations drop constraint if exists group_invitations_status_check;
alter table public.group_invitations add constraint group_invitations_status_check
  check (status in ('pending','sent','accepted','revoked','expired','declined'));
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null unique,
  kind text not null check (kind in ('expense_added','expense_changed','expense_removed','invitation_received','invitation_accepted','invitation_declined','invitation_expired','settlement_partial','settlement_total')),
  title text not null,
  message text not null,
  destination text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_read_own on public.notifications for select to authenticated using (user_id=(select auth.uid()));
create policy notifications_mark_own on public.notifications for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on public.notifications from anon;

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index web_push_subscriptions_user_idx on public.web_push_subscriptions(user_id);
alter table public.web_push_subscriptions enable row level security;
create policy push_subscriptions_read_own on public.web_push_subscriptions for select to authenticated using (user_id=(select auth.uid()));
create policy push_subscriptions_insert_own on public.web_push_subscriptions for insert to authenticated with check (user_id=(select auth.uid()));
create policy push_subscriptions_delete_own on public.web_push_subscriptions for delete to authenticated using (user_id=(select auth.uid()));
revoke update on public.web_push_subscriptions from authenticated;
grant select, insert, delete on public.web_push_subscriptions to authenticated;
revoke all on public.web_push_subscriptions from anon;

do $$ begin
  if exists (select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

create or replace function private.add_notification(p_user uuid,p_key text,p_kind text,p_title text,p_message text,p_destination text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(user_id,event_key,kind,title,message,destination)
  values(p_user,p_key,p_kind,p_title,p_message,p_destination) on conflict(event_key) do nothing;
$$;
revoke all on function private.add_notification(uuid,text,text,text,text,text) from public,anon,authenticated;

create or replace function private.notify_expense_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_expense uuid; v_kind text; v_action text; v_actor uuid; v_key text;
begin
  v_group := coalesce(new.group_id,old.group_id); v_expense := coalesce(new.id,old.id);
  v_actor := (select auth.uid());
  v_action := case when tg_op='INSERT' then 'added' when tg_op='UPDATE' then 'changed' else 'removed' end;
  v_kind := case v_action when 'added' then 'expense_added' when 'changed' then 'expense_changed' else 'expense_removed' end;
  v_key := 'expense:'||v_expense::text||':'||v_action||':'||txid_current()::text;
  insert into public.notifications(user_id,event_key,kind,title,message,destination)
    select gm.user_id,v_key||':'||gm.user_id::text,v_kind,
      case v_action when 'added' then 'Nova despesa no grupo' when 'changed' then 'Despesa atualizada' else 'Despesa removida' end,
      'Há uma atualização em um grupo do SplitUai.', '/SplitUai/?group='||v_group::text||'&expense='||v_expense::text
    from public.group_members gm where gm.group_id=v_group and gm.active and gm.user_id is distinct from v_actor
  on conflict(event_key) do nothing;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger notifications_expenses after insert or update or delete on public.expenses
  for each row execute function private.notify_expense_change();

create or replace function private.notify_invitation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_kind text; v_title text; v_key text; v_group_name text;
begin
  select id into v_user from auth.users where lower(email)=lower(new.invited_email) limit 1;
  select name into v_group_name from public.groups where id=new.group_id;
  if tg_op='INSERT' then
    if v_user is not null then perform private.add_notification(v_user,'invite:'||new.id||':received','invitation_received','Convite para um grupo','Você recebeu um convite para participar de um grupo.','/SplitUai/?tab=invitations'); end if;
  elsif old.status is distinct from new.status then
    if new.status='accepted' then
      if v_user is not null then perform private.add_notification(v_user,'invite:'||new.id||':received','invitation_received','Convite para um grupo','Você recebeu um convite para participar de um grupo.','/SplitUai/?group='||new.group_id::text); end if;
      if v_user is not null then update public.notifications set destination='/SplitUai/?group='||new.group_id::text where user_id=v_user and event_key='invite:'||new.id||':received'; end if;
      v_kind:='invitation_accepted'; v_title:='Convite aceito';
    elsif new.status='declined' then v_kind:='invitation_declined'; v_title:='Convite recusado';
    elsif new.status='revoked' then return new;
    elsif new.status='expired' then v_kind:='invitation_expired'; v_title:='Convite expirado';
    else return new; end if;
    v_key:='invite:'||new.id||':'||new.status;
    perform private.add_notification(new.invited_by,v_key,v_kind,v_title,'Um convite enviado por você teve uma atualização.','/SplitUai/?group='||new.group_id::text||'&tab=invitations');
  end if;
  return new;
end $$;
create trigger notifications_group_invitations after insert or update of status on public.group_invitations
  for each row execute function private.notify_invitation_change();

create or replace function private.notify_paid_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_obligation numeric; v_paid numeric; v_remaining numeric; v_kind text; v_key text; v_uid uuid;
begin
  if new.status<>'paid' or (tg_op='UPDATE' and old.status='paid') then return new; end if;
  -- Compare settled total with the still-open net obligation for this payer/recipient pair.
  select greatest(0, coalesce(sum(case when e.paid_by=new.paid_by and s.user_id=new.received_by then s.amount_cents
      when e.paid_by=new.received_by and s.user_id=new.paid_by then -s.amount_cents else 0 end),0))
    into v_obligation from public.expenses e join public.expense_shares s on s.expense_id=e.id where e.group_id=new.group_id;
  select coalesce(sum(amount_cents),0) into v_paid from public.group_settlements gs
    where gs.group_id=new.group_id and gs.status='paid' and gs.paid_by=new.paid_by and gs.received_by=new.received_by and gs.id<>new.id;
  v_remaining:=greatest(0,v_obligation-v_paid);
  v_kind:=case when new.amount_cents>=v_remaining then 'settlement_total' else 'settlement_partial' end;
  v_key:='settlement:'||new.id::text||':paid';
  for v_uid in select gm.user_id from public.group_members gm where gm.group_id=new.group_id and gm.active loop
    perform private.add_notification(v_uid,v_key||':'||v_uid::text,v_kind,
      case when v_kind='settlement_total' then 'Acerto concluído' else 'Acerto parcial realizado' end,
      'Um acerto foi registrado em um grupo do SplitUai.','/SplitUai/?group='||new.group_id::text||'&settlement='||new.id::text);
  end loop;
  return new;
end $$;
create trigger notifications_paid_settlement after insert or update of status on public.group_settlements
  for each row execute function private.notify_paid_settlement();

revoke all on function private.notify_expense_change() from public,anon,authenticated;
revoke all on function private.notify_invitation_change() from public,anon,authenticated;
revoke all on function private.notify_paid_settlement() from public,anon,authenticated;

-- Materialize expired invitations when the authenticated inbox is opened. The
-- status transition is idempotent and the trigger creates one sender notice.
create or replace function public.list_my_group_invitations()
returns table(id uuid, group_id uuid, group_name text, invited_email text, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para ver os convites.' using errcode='42501'; end if;
  update public.group_invitations i set status='expired'
    where i.invited_email=lower((select auth.jwt()->>'email')) and i.status in ('pending','sent') and i.expires_at<=now();
  return query select i.id,i.group_id,g.name,i.invited_email,i.status,i.created_at,i.expires_at
    from public.group_invitations i join public.groups g on g.id=i.group_id
    where i.invited_email=lower((select auth.jwt()->>'email')) and i.status in ('pending','sent','expired')
    order by i.created_at desc;
end $$;
revoke all on function public.list_my_group_invitations() from public,anon;
grant execute on function public.list_my_group_invitations() to authenticated;

create or replace function public.decline_group_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.group_invitations i set status='declined'
    where i.id=p_invitation_id and i.invited_email=lower((select auth.jwt()->>'email'))
      and i.status in ('pending','sent') and i.expires_at>now();
  if not found then raise exception 'Convite não encontrado ou expirado.' using errcode='P0002'; end if;
end $$;
revoke all on function public.decline_group_invitation(uuid) from public,anon;
grant execute on function public.decline_group_invitation(uuid) to authenticated;

create or replace function public.expire_group_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.group_invitations set status='expired'
    where status in ('pending','sent') and expires_at<=now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.expire_group_invitations() from public,anon,authenticated;
grant execute on function public.expire_group_invitations() to service_role;
