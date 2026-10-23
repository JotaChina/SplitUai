-- Chave Pix opcional, editável pelo titular e legível somente pelo escopo RLS
-- já aplicado aos perfis (titular e pessoas com acesso ao grupo em comum).
alter table public.profiles
  add column pix_key text,
  add constraint profiles_pix_key_length_check
    check (pix_key is null or (char_length(btrim(pix_key)) between 1 and 128));

grant update (pix_key) on public.profiles to authenticated;

-- O acesso dos helpers acompanha o estado ativo da associação ao grupo.
create or replace function private.is_current_user_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid()) and gm.active
  );
$$;

create or replace function private.is_current_user_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid()) and gm.role = 'admin' and gm.active
  );
$$;

create or replace function private.can_current_user_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile_id = (select auth.uid()) or exists (
    select 1
    from public.group_members target_member
    join public.group_members current_member on current_member.group_id = target_member.group_id
    where target_member.user_id = p_profile_id and target_member.active
      and current_member.user_id = (select auth.uid()) and current_member.active
  );
$$;

-- Apelidos são globais do perfil. A gestão do grupo altera somente papéis;
-- administradores não podem gravar o nome/apelido de outra pessoa.
drop function public.update_group_member(uuid, uuid, text, text);
create function public.update_group_member(p_group_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not private.is_current_user_group_admin(p_group_id) then
    raise exception 'Somente administradores ativos podem editar participantes.' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Peça a outro administrador para alterar seu papel.' using errcode = '23514';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id and active
  ) then
    raise exception 'Participante não encontrado ou já removido.' using errcode = 'P0002';
  end if;
  if p_role = 'member'
    and (select count(*) from public.group_members where group_id = p_group_id and active and role = 'admin') = 1
    and exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id and role = 'admin') then
    raise exception 'Transfira a administração antes de rebaixar o último administrador.' using errcode = '23514';
  end if;
  update public.group_members set role = p_role where group_id = p_group_id and user_id = p_user_id;
end
$$;
revoke all on function public.update_group_member(uuid, uuid, text) from public, anon;
grant execute on function public.update_group_member(uuid, uuid, text) to authenticated;

alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in (
  'hospedagem', 'alimentacao', 'transporte', 'corrida', 'atividades', 'outros',
  'aluguel', 'luz', 'agua', 'iptu'
));

-- A validação do RPC compartilhado acompanha as novas categorias. As migrations
-- anteriores permanecem imutáveis e a mudança não altera lançamentos existentes.
do $migration$
declare
  v_definition text;
  v_old text := $old$p_category not in ('hospedagem','alimentacao','transporte','corrida','atividades','outros')$old$;
  v_new text := $new$p_category not in ('hospedagem','alimentacao','transporte','corrida','atividades','outros','aluguel','luz','agua','iptu')$new$;
begin
  select pg_get_functiondef(
    'private.save_expense_with_schedule(uuid,uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif position('''aluguel''' in v_definition) = 0 then
    raise exception 'Could not extend expense category validation for household bills';
  end if;
end
$migration$;
