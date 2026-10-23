-- Complete the invite lifecycle without joining users during Auth user creation.
alter table public.group_invitations
  drop constraint group_invitations_status_check;
update public.group_invitations set status='cancelled' where status='revoked';
alter table public.group_invitations
  add constraint group_invitations_status_check
  check (status in ('pending', 'sent', 'accepted', 'expired', 'cancelled'));
alter table public.group_invitations add column sending_token uuid;
alter table public.group_invitations add column sending_until timestamptz;

create or replace function public.manage_group_invitation(p_group_id uuid,p_email text,p_action text,p_invitation_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text:=lower(btrim(coalesce(p_email,''))); v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para gerenciar convites.' using errcode='42501'; end if;
  perform 1 from public.groups where id=p_group_id for update;
  if not private.is_current_user_group_admin(p_group_id) then raise exception 'Somente administradores ativos podem gerenciar convites.' using errcode='42501'; end if;
  if p_action='create' then
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Informe um e-mail válido.' using errcode='22023'; end if;
    if exists(select 1 from auth.users u join public.group_members m on m.user_id=u.id and m.group_id=p_group_id and m.active where lower(u.email)=v_email) then raise exception 'Essa pessoa já participa do grupo.' using errcode='23505'; end if;
    update public.group_invitations set status='expired' where group_id=p_group_id and invited_email=v_email and status in ('pending','sent') and expires_at<=now();
    if exists(select 1 from public.group_invitations where group_id=p_group_id and invited_email=v_email and status in ('pending','sent') and expires_at>now()) then raise exception 'Já existe um convite ativo para esse e-mail.' using errcode='23505'; end if;
    insert into public.group_invitations(group_id,invited_email,invited_by,status,expires_at) values(p_group_id,v_email,(select auth.uid()),'pending',now()+interval '14 days') returning id into v_id;
    return v_id;
  elsif p_action='cancel' then
    update public.group_invitations set status='cancelled',sending_token=null,sending_until=null
    where id=p_invitation_id and group_id=p_group_id and status in ('pending','sent') and expires_at>now()
      returning id into v_id;
    if v_id is null then raise exception 'Convite não encontrado, expirado, em envio ou já respondido.' using errcode='P0002'; end if;
    return v_id;
  end if;
  raise exception 'Operação de convite inválida.' using errcode='22023';
end $$;

create or replace function public.claim_group_invitation_email(p_group_id uuid,p_invitation_id uuid)
returns table(invited_email text, claim_token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_token uuid;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para enviar convites.' using errcode='42501'; end if;
  perform 1 from public.groups where id=p_group_id for update;
  if not private.is_current_user_group_admin(p_group_id) then raise exception 'Somente administradores ativos podem enviar convites.' using errcode='42501'; end if;
  update public.group_invitations i set sending_token=gen_random_uuid(),sending_until=now()+interval '2 minutes'
    where i.id=p_invitation_id and i.group_id=p_group_id and i.status in ('pending','sent') and i.expires_at>now()
      and (i.sending_until is null or i.sending_until<=now())
    returning i.sending_token into v_token;
  if v_token is null then raise exception 'Convite não encontrado, expirado, cancelado ou com envio em andamento.' using errcode='P0002'; end if;
  return query select i.invited_email,v_token,i.expires_at from public.group_invitations i where i.id=p_invitation_id;
end $$;

create or replace function public.finish_group_invitation_email(p_invitation_id uuid,p_claim_token uuid,p_sent boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_sent then
    update public.group_invitations set status='sent',sent_at=now(),expires_at=now()+interval '14 days',sending_token=null,sending_until=null
    where id=p_invitation_id and sending_token=p_claim_token and status in ('pending','sent') and expires_at>now();
  else
    update public.group_invitations set sending_token=null,sending_until=null
    where id=p_invitation_id and sending_token=p_claim_token and status in ('pending','sent');
  end if;
  if not found then raise exception 'Envio expirado ou convite cancelado durante a operação.' using errcode='P0002'; end if;
end $$;

create or replace function public.accept_group_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_email text;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para aceitar o convite.' using errcode='42501'; end if;
  select lower(u.email) into v_email from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'Confirme o e-mail da conta antes de aceitar o convite.' using errcode='42501'; end if;
  select i.group_id into v_group from public.group_invitations i where i.id=p_invitation_id;
  if v_group is null then raise exception 'Convite não encontrado.' using errcode='P0002'; end if;
  perform 1 from public.groups where id=v_group for update;
  select i.group_id into v_group from public.group_invitations i where i.id=p_invitation_id and i.invited_email=v_email
    and i.status in ('pending','sent') and i.expires_at>now() for update;
  if v_group is null then raise exception 'Convite expirado, cancelado, já respondido ou destinado a outro e-mail.' using errcode='42501'; end if;
  insert into public.group_members(group_id,user_id,role,active) values(v_group,(select auth.uid()),'member',true)
  on conflict(group_id,user_id) do update set active=true;
  update public.group_invitations set status='accepted',sending_token=null,sending_until=null where id=p_invitation_id;
  return v_group;
end $$;

-- Auth user creation may create a profile, but joining a group only occurs via accept_group_invitation.
create or replace function public.handle_invited_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text; v_bootstrap boolean;
begin
  v_email:=lower(btrim(new.email));
  if v_email is null or v_email='' then raise exception 'SplitUai accounts are invitation-only' using errcode='42501'; end if;
  select exists(select 1 from public.bootstrap_invites b where b.email=v_email and b.consumed_at is null and b.expires_at>now()) into v_bootstrap;
  if not v_bootstrap and not exists(select 1 from public.group_invitations i where i.invited_email=v_email and i.status in ('pending','sent') and i.expires_at>now()) then
    raise exception 'A valid SplitUai invitation is required' using errcode='42501';
  end if;
  insert into public.profiles(id,display_name) values(new.id,nullif(btrim(new.raw_user_meta_data->>'name'),''));
  if v_bootstrap then update public.bootstrap_invites set consumed_at=now() where email=v_email and consumed_at is null; end if;
  return new;
end $$;

revoke all on function public.claim_group_invitation_email(uuid,uuid) from public,anon;
revoke all on function public.finish_group_invitation_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_group_invitation_email(uuid,uuid) to authenticated;
grant execute on function public.finish_group_invitation_email(uuid,uuid,boolean) to service_role;
