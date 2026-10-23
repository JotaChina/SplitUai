-- Sending is only possible through the leased Edge Function. The older
-- resend RPC branch could clear a live lease and allow duplicate delivery.
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
    if v_id is null then raise exception 'Convite não encontrado, expirado ou já respondido.' using errcode='P0002'; end if;
    return v_id;
  end if;
  raise exception 'Operação de convite inválida.' using errcode='22023';
end $$;
