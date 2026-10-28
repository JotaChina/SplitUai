-- Allow accepted friends with an existing account to receive group invitations
-- in-app without resolving or disclosing their email address.
alter table public.group_invitations
  alter column invited_email drop not null,
  add column invited_user_id uuid references auth.users(id) on delete cascade;

alter table public.group_invitations
  add constraint group_invitations_recipient_check
  check (invited_user_id is not null or invited_email is not null);

create extension if not exists pg_net;
create table private.push_delivery_settings (
  singleton boolean primary key default true check (singleton),
  webhook_secret text not null
);
revoke all on private.push_delivery_settings from public, anon, authenticated;

create index group_invitations_invited_user_idx
  on public.group_invitations(invited_user_id, created_at desc)
  where invited_user_id is not null;

create or replace function public.create_group_invitation_for_friend(p_group_id uuid, p_friend_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invitation_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para gerenciar convites.' using errcode = '42501'; end if;
  perform 1 from public.groups where id = p_group_id for update;
  if not private.is_current_user_group_admin(p_group_id) then
    raise exception 'Somente administradores ativos podem gerenciar convites.' using errcode = '42501';
  end if;
  if p_friend_id is null or p_friend_id = (select auth.uid()) or not exists (
    select 1 from public.friendships f where f.status = 'accepted' and
      ((f.requester_id = (select auth.uid()) and f.addressee_id = p_friend_id) or
       (f.addressee_id = (select auth.uid()) and f.requester_id = p_friend_id))
  ) then raise exception 'Não foi possível criar um convite para essa pessoa.' using errcode = '42501'; end if;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_friend_id and active) then
    raise exception 'Essa pessoa já participa do grupo.' using errcode = '23505';
  end if;
  update public.group_invitations set status = 'expired'
    where group_id = p_group_id and invited_user_id = p_friend_id and status in ('pending','sent') and expires_at <= now();
  if exists (select 1 from public.group_invitations where group_id = p_group_id and invited_user_id = p_friend_id and status in ('pending','sent') and expires_at > now()) then
    raise exception 'Já existe um convite ativo para essa amizade.' using errcode = '23505';
  end if;
  insert into public.group_invitations(group_id, invited_email, invited_user_id, invited_by, status, expires_at)
    values (p_group_id, null, p_friend_id, (select auth.uid()), 'pending', now() + interval '14 days')
    returning id into v_invitation_id;
  return v_invitation_id;
end;
$$;

create or replace function public.list_my_group_invitations()
returns table(id uuid, group_id uuid, group_name text, invited_email text, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_email text := lower((select auth.jwt()->>'email'));
begin
  if v_user is null then raise exception 'Entre na sua conta para ver os convites.' using errcode='42501'; end if;
  update public.group_invitations i set status='expired'
    where (i.invited_user_id = v_user or (i.invited_user_id is null and i.invited_email = v_email))
      and i.status in ('pending','sent') and i.expires_at <= now();
  return query select i.id,i.group_id,g.name,i.invited_email,i.status,i.created_at,i.expires_at
    from public.group_invitations i join public.groups g on g.id=i.group_id
    where (i.invited_user_id = v_user or (i.invited_user_id is null and i.invited_email = v_email))
      and i.status in ('pending','sent','expired')
    order by i.created_at desc;
end;
$$;

create or replace function public.accept_group_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_user uuid := (select auth.uid()); v_email text := lower((select auth.jwt()->>'email'));
begin
  if v_user is null then raise exception 'Entre na sua conta para aceitar convites.' using errcode='42501'; end if;
  select i.group_id into v_group from public.group_invitations i
    where i.id=p_invitation_id and (i.invited_user_id=v_user or (i.invited_user_id is null and i.invited_email=v_email));
  if v_group is null then raise exception 'Convite não encontrado.' using errcode='P0002'; end if;
  perform 1 from public.groups where id=v_group for update;
  select i.group_id into v_group from public.group_invitations i
    where i.id=p_invitation_id and (i.invited_user_id=v_user or (i.invited_user_id is null and i.invited_email=v_email))
      and i.status in ('pending','sent') and i.expires_at>now() for update;
  if v_group is null then raise exception 'Convite expirado, cancelado ou destinado a outra conta.' using errcode='42501'; end if;
  insert into public.group_members(group_id,user_id,role,active) values(v_group,v_user,'member',true)
    on conflict(group_id,user_id) do update set active=true;
  update public.group_invitations set status='accepted' where id=p_invitation_id;
  return v_group;
end;
$$;

create or replace function public.decline_group_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.group_invitations i set status='declined'
    where i.id=p_invitation_id and (i.invited_user_id=(select auth.uid()) or
      (i.invited_user_id is null and i.invited_email=lower((select auth.jwt()->>'email'))))
      and i.status in ('pending','sent') and i.expires_at>now();
  if not found then raise exception 'Convite não encontrado ou expirado.' using errcode='P0002'; end if;
end;
$$;

-- Friendship requests and acceptance are durable inbox events; the existing
-- notification INSERT webhook delivers them to subscribed devices as Push.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'expense_added','expense_changed','expense_removed','invitation_received','invitation_accepted',
  'invitation_declined','invitation_expired','settlement_partial','settlement_total',
  'friend_request_received','friend_request_accepted','friend_request_declined'
));

create or replace function private.notify_friendship_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_target uuid; v_key text; v_kind text; v_title text; v_message text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.add_notification(new.addressee_id,'friendship:'||new.id||':request','friend_request_received',
      'Pedido de amizade','Você recebeu um pedido de amizade.','/SplitUai/?tab=friends');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform private.add_notification(new.requester_id,'friendship:'||new.id||':accepted','friend_request_accepted',
      'Pedido de amizade aceito','Seu pedido de amizade foi aceito.','/SplitUai/?tab=friends');
  elsif tg_op = 'DELETE' and old.status = 'pending' then
    v_target := case when v_actor = old.requester_id then old.addressee_id else old.requester_id end;
    if v_actor = old.addressee_id then
      perform private.add_notification(v_target,'friendship:'||old.id||':declined','friend_request_declined',
        'Pedido de amizade recusado','Seu pedido de amizade foi recusado.','/SplitUai/?tab=friends');
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger notifications_friendships after insert or update of status or delete on public.friendships
  for each row execute function private.notify_friendship_change();
revoke all on function private.notify_friendship_change() from public,anon,authenticated;

create or replace function private.dispatch_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_net_schema text; v_request_id bigint;
begin
  select webhook_secret into v_secret from private.push_delivery_settings where singleton;
  if v_secret is not null then
    select n.nspname into v_net_schema from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid=e.extnamespace where e.extname='pg_net';
    execute format('select %I.http_post($1,$2,$3,$4,$5)',v_net_schema) into v_request_id
      using 'http://kong:8000/functions/v1/send-web-push', jsonb_build_object('record',to_jsonb(new)),
        '{}'::jsonb, jsonb_build_object('Content-Type','application/json','x-push-webhook-secret',v_secret), 5000;
  end if;
  return new;
end;
$$;
create trigger notifications_dispatch_push after insert on public.notifications
  for each row execute function private.dispatch_notification_push();
revoke all on function private.dispatch_notification_push() from public,anon,authenticated;

-- Update group invitation notifications to address account-based invitations
-- directly, while keeping the legacy email flow intact.
create or replace function private.notify_invitation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_kind text; v_title text; v_key text;
begin
  v_user := coalesce(new.invited_user_id, (select id from auth.users where lower(email)=lower(new.invited_email) limit 1));
  if tg_op='INSERT' then
    if v_user is not null then perform private.add_notification(v_user,'invite:'||new.id||':received','invitation_received','Convite para um grupo','Você recebeu um convite para participar de um grupo.','/SplitUai/?tab=invitations'); end if;
  elsif old.status is distinct from new.status then
    if new.status='accepted' then
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
end;
$$;
