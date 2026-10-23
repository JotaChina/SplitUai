-- Etapa 7: gestão de membros e convites. A remoção é lógica para preservar
-- referências financeiras e permitir consultar o histórico sem manter acesso.
alter table public.group_members add column active boolean not null default true;
alter table public.group_members add column display_name text check (display_name is null or char_length(display_name) between 1 and 80);
alter table public.group_invitations drop constraint group_invitations_status_check;
alter table public.group_invitations add constraint group_invitations_status_check
  check (status in ('pending', 'sent', 'accepted', 'revoked', 'expired'));

create or replace function private.is_current_user_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members gm where gm.group_id=p_group_id and gm.user_id=(select auth.uid()) and gm.active);
$$;
create or replace function private.is_current_user_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members gm where gm.group_id=p_group_id and gm.user_id=(select auth.uid()) and gm.active and gm.role='admin');
$$;
create or replace function private.can_current_user_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile_id=(select auth.uid()) or exists (
    select 1 from public.group_members t join public.group_members c on c.group_id=t.group_id
    where t.user_id=p_profile_id and c.user_id=(select auth.uid()) and c.active
  );
$$;

-- A stored invitation stays pending until Auth creates the invited account or
-- its owner accepts it. Only authenticated callers can access their own inbox.
create or replace function public.list_my_group_invitations()
returns table(id uuid, group_id uuid, group_name text, invited_email text, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para ver os convites.' using errcode='42501'; end if;
  return query select i.id,i.group_id,g.name,i.invited_email,
    case when i.status in ('pending','sent') and i.expires_at<=now() then 'expired' else i.status end,
    i.created_at,i.expires_at
  from public.group_invitations i join public.groups g on g.id=i.group_id
  where i.invited_email=lower((select auth.jwt()->>'email')) and i.status in ('pending','sent')
  order by i.created_at desc;
end $$;

create or replace function public.manage_group_invitation(p_group_id uuid,p_email text,p_action text,p_invitation_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text:=lower(btrim(coalesce(p_email,''))); v_id uuid;
begin
  perform 1 from public.groups where id=p_group_id for update;
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para gerenciar convites.' using errcode='42501'; end if;
  if not private.is_current_user_group_admin(p_group_id) then raise exception 'Somente administradores ativos podem gerenciar convites.' using errcode='42501'; end if;
  if p_action='create' then
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Informe um e-mail válido.' using errcode='22023'; end if;
    if exists(select 1 from auth.users u join public.group_members m on m.user_id=u.id and m.group_id=p_group_id and m.active where lower(u.email)=v_email) then raise exception 'Essa pessoa já participa do grupo.' using errcode='23505'; end if;
    update public.group_invitations set status='expired' where group_id=p_group_id and invited_email=v_email and status in ('pending','sent') and expires_at<=now();
    if exists(select 1 from public.group_invitations where group_id=p_group_id and invited_email=v_email and status in ('pending','sent') and expires_at>now()) then raise exception 'Já existe um convite ativo para esse e-mail.' using errcode='23505'; end if;
    insert into public.group_invitations(group_id,invited_email,invited_by,status,expires_at) values(p_group_id,v_email,(select auth.uid()),'pending',now()+interval '14 days') returning id into v_id;
    return v_id;
  elsif p_action in ('resend','cancel') then
    update public.group_invitations set status=case when p_action='cancel' then 'revoked' else 'pending' end,
      expires_at=case when p_action='resend' then now()+interval '14 days' else expires_at end, sent_at=null
    where id=p_invitation_id and group_id=p_group_id and status in ('pending','sent') and expires_at>now() returning id into v_id;
    if v_id is null then raise exception 'Convite não encontrado, expirado ou já respondido.' using errcode='P0002'; end if;
    return v_id;
  end if;
  raise exception 'Operação de convite inválida.' using errcode='22023';
end $$;

create or replace function public.accept_group_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group uuid;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para aceitar o convite.' using errcode='42501'; end if;
  select i.group_id into v_group from public.group_invitations i where i.id=p_invitation_id;
  if v_group is null then raise exception 'Convite não encontrado.' using errcode='P0002'; end if;
  perform 1 from public.groups where id=v_group for update;
  select i.group_id into v_group from public.group_invitations i join auth.users u on lower(u.email)=i.invited_email
  where i.id=p_invitation_id and u.id=(select auth.uid()) and i.status in ('pending','sent') and i.expires_at>now() for update of i;
  if v_group is null then raise exception 'Convite expirado, cancelado ou destinado a outro e-mail.' using errcode='42501'; end if;
  insert into public.group_members(group_id,user_id,role,active) values(v_group,(select auth.uid()),'member',true)
  on conflict(group_id,user_id) do update set active=true;
  update public.group_invitations set status='accepted' where id=p_invitation_id;
  return v_group;
end $$;

create or replace function public.update_group_member(p_group_id uuid,p_user_id uuid,p_role text,p_display_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.groups where id=p_group_id for update;
  if not private.is_current_user_group_admin(p_group_id) then raise exception 'Somente administradores ativos podem editar participantes.' using errcode='42501'; end if;
  if p_role is null or p_role not in ('admin','member') then raise exception 'Papel inválido.' using errcode='22023'; end if;
  if not exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_user_id and active) then raise exception 'Participante não encontrado ou já removido.' using errcode='P0002'; end if;
  if p_role='member' and (select count(*) from public.group_members where group_id=p_group_id and active and role='admin')=1
    and exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_user_id and role='admin') then raise exception 'Transfira a administração antes de rebaixar o último administrador.' using errcode='23514'; end if;
  if p_display_name is not null and btrim(p_display_name)<>'' and char_length(btrim(p_display_name)) not between 1 and 80 then raise exception 'O nome deve ter até 80 caracteres.' using errcode='22023'; end if;
  update public.group_members set role=p_role,display_name=case when p_display_name is null then display_name else nullif(btrim(p_display_name),'') end where group_id=p_group_id and user_id=p_user_id;
end $$;

create or replace function public.remove_group_member(p_group_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.groups where id=p_group_id for update;
  if not private.is_current_user_group_admin(p_group_id) then raise exception 'Somente administradores ativos podem remover participantes.' using errcode='42501'; end if;
  if p_user_id=(select auth.uid()) then raise exception 'Transfira a administração ou peça a outro administrador para remover sua conta.' using errcode='23514'; end if;
  if not exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_user_id and active) then raise exception 'Participante não encontrado ou já removido.' using errcode='P0002'; end if;
  if exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_user_id and role='admin')
    and (select count(*) from public.group_members where group_id=p_group_id and active and role='admin')=1 then raise exception 'Transfira a administração antes de remover o último administrador.' using errcode='23514'; end if;
  update public.group_members set active=false where group_id=p_group_id and user_id=p_user_id;
end $$;

revoke all on function public.list_my_group_invitations() from public,anon;
revoke all on function public.manage_group_invitation(uuid,text,text,uuid) from public,anon;
revoke all on function public.accept_group_invitation(uuid) from public,anon;
revoke all on function public.update_group_member(uuid,uuid,text,text) from public,anon;
revoke all on function public.remove_group_member(uuid,uuid) from public,anon;
grant execute on function public.list_my_group_invitations() to authenticated;
grant execute on function public.manage_group_invitation(uuid,text,text,uuid) to authenticated;
grant execute on function public.accept_group_invitation(uuid) to authenticated;
grant execute on function public.update_group_member(uuid,uuid,text,text) to authenticated;
grant execute on function public.remove_group_member(uuid,uuid) to authenticated;

-- Newly invited Auth users join immediately and the invitation is marked accepted.
create or replace function public.handle_invited_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text; v_bootstrap boolean; v_invite record;
begin
  v_email:=lower(btrim(new.email));
  if v_email is null or v_email='' then raise exception 'SplitUai accounts are invitation-only' using errcode='42501'; end if;
  select exists(select 1 from public.bootstrap_invites b where b.email=v_email and b.consumed_at is null and b.expires_at>now()) into v_bootstrap;
  if not v_bootstrap and not exists(select 1 from public.group_invitations i where i.invited_email=v_email and i.status in ('pending','sent') and i.expires_at>now()) then
    raise exception 'A valid SplitUai invitation is required' using errcode='42501';
  end if;
  insert into public.profiles(id,display_name) values(new.id,nullif(btrim(new.raw_user_meta_data->>'name'),''));
  if v_bootstrap then update public.bootstrap_invites set consumed_at=now() where email=v_email and consumed_at is null; end if;
  for v_invite in select i.id,i.group_id from public.group_invitations i where i.invited_email=v_email and i.status in ('pending','sent') and i.expires_at>now() for update loop
    insert into public.group_members(group_id,user_id,role,active) values(v_invite.group_id,new.id,'member',true)
      on conflict(group_id,user_id) do update set active=true;
    update public.group_invitations set status='accepted' where id=v_invite.id;
  end loop;
  return new;
end $$;
revoke all on function public.handle_invited_auth_user() from public,anon,authenticated;

-- Keep direct writes closed; group membership changes flow only through RPCs.
revoke insert,update,delete on public.group_members,public.group_invitations from authenticated;
grant select on public.group_members,public.group_invitations to authenticated;
