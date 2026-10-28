-- Relações de amizade são separadas de membros e convites de grupo.
create schema if not exists private;
revoke all on schema private from public, anon;

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_unique on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_pending_idx on public.friendships(addressee_id, created_at desc) where status = 'pending';
create index friendships_requester_pending_idx on public.friendships(requester_id, created_at desc) where status = 'pending';
alter table public.friendships enable row level security;
create policy friendships_select_participants on public.friendships for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));
revoke all on public.friendships from public, anon, authenticated;
grant select on public.friendships to authenticated;

create table private.friend_search_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);
revoke all on private.friend_search_windows from public, anon, authenticated;

create or replace function private.consume_friend_search(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := now(); v_attempts integer;
begin
  insert into private.friend_search_windows(user_id, window_started_at, attempts)
  values (p_user_id, v_now, 1)
  on conflict (user_id) do update
    set window_started_at = case
          when private.friend_search_windows.window_started_at <= v_now - interval '15 minutes' then v_now
          else private.friend_search_windows.window_started_at end,
        attempts = case
          when private.friend_search_windows.window_started_at <= v_now - interval '15 minutes' then 1
          else private.friend_search_windows.attempts + 1 end
  returning attempts into v_attempts;
  return v_attempts <= 30;
end;
$$;
revoke all on function private.consume_friend_search(uuid) from public, anon, authenticated;

create or replace function public.search_friend_by_username(p_username text)
returns table(user_id uuid, username text, display_name text, avatar_url text, relationship_status text, request_direction text)
language plpgsql security definer set search_path = '' as $$
declare v_username text := lower(btrim(coalesce(p_username, ''))); v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(v_username) not between 3 and 24 or v_username !~ '^[a-z0-9_]+$' then
    raise exception 'Digite um username completo válido.' using errcode = '22023';
  end if;
  if not private.consume_friend_search(v_user) then
    raise exception 'Limite de buscas atingido. Tente novamente em alguns minutos.' using errcode = 'P0001';
  end if;
  return query
    select p.id, p.username, p.display_name, p.avatar_url,
      f.status,
      case when f.id is null then null when f.requester_id = v_user then 'outgoing' else 'incoming' end
    from public.profiles p
    left join public.friendships f on
      (f.requester_id = v_user and f.addressee_id = p.id) or
      (f.requester_id = p.id and f.addressee_id = v_user)
    where p.username = v_username and p.id <> v_user
    limit 1;
end;
$$;

create or replace function public.list_my_friendships()
returns table(id uuid, requester_id uuid, addressee_id uuid, status text, created_at timestamptz,
  other_user_id uuid, username text, display_name text, avatar_url text, direction text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.requester_id, f.addressee_id, f.status, f.created_at,
    p.id, p.username, p.display_name, p.avatar_url,
    case when f.requester_id = (select auth.uid()) then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
  where (f.requester_id = (select auth.uid()) or f.addressee_id = (select auth.uid()))
  order by f.status, f.created_at desc
$$;

create or replace function public.manage_friendship(p_user_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_friendship public.friendships%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_user_id is null or p_user_id = v_actor then raise exception 'Ação inválida.' using errcode = '22023'; end if;
  if p_action not in ('send', 'accept', 'decline', 'cancel', 'unfriend') then raise exception 'Ação inválida.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(v_actor::text, p_user_id::text) || ':' || greatest(v_actor::text, p_user_id::text), 0));
  if p_action = 'send' then
    if not exists(select 1 from public.profiles where id = p_user_id and username is not null) then
      raise exception 'Não foi possível enviar o pedido.' using errcode = 'P0002';
    end if;
    insert into public.friendships(requester_id, addressee_id, status)
      values (v_actor, p_user_id, 'pending')
      on conflict do nothing;
    return;
  end if;
  select * into v_friendship from public.friendships f
    where (f.requester_id = v_actor and f.addressee_id = p_user_id)
       or (f.requester_id = p_user_id and f.addressee_id = v_actor)
    for update;
  if not found then raise exception 'A relação não está mais disponível.' using errcode = 'P0002'; end if;
  if p_action = 'accept' then
    if v_friendship.status <> 'pending' or v_friendship.addressee_id <> v_actor then raise exception 'Ação não permitida.' using errcode = '42501'; end if;
    update public.friendships set status = 'accepted', updated_at = now() where id = v_friendship.id;
  elsif p_action = 'decline' then
    if v_friendship.status <> 'pending' or v_friendship.addressee_id <> v_actor then raise exception 'Ação não permitida.' using errcode = '42501'; end if;
    delete from public.friendships where id = v_friendship.id;
  elsif p_action = 'cancel' then
    if v_friendship.status <> 'pending' or v_friendship.requester_id <> v_actor then raise exception 'Ação não permitida.' using errcode = '42501'; end if;
    delete from public.friendships where id = v_friendship.id;
  elsif p_action = 'unfriend' then
    if v_friendship.status <> 'accepted' then raise exception 'Ação não permitida.' using errcode = '42501'; end if;
    delete from public.friendships where id = v_friendship.id;
  end if;
end;
$$;

-- Admins may use an accepted friendship to target an existing group invite.
-- The target email is resolved and consumed only inside this database function.
create or replace function public.create_group_invitation_for_friend(p_group_id uuid, p_friend_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text; v_invitation_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta para gerenciar convites.' using errcode = '42501'; end if;
  if not private.is_current_user_group_admin(p_group_id) then
    raise exception 'Somente administradores ativos podem gerenciar convites.' using errcode = '42501';
  end if;
  if p_friend_id is null or p_friend_id = (select auth.uid()) or not exists (
    select 1 from public.friendships f where f.status = 'accepted' and
      ((f.requester_id = (select auth.uid()) and f.addressee_id = p_friend_id) or
       (f.addressee_id = (select auth.uid()) and f.requester_id = p_friend_id))
  ) then raise exception 'Não foi possível criar um convite para essa pessoa.' using errcode = '42501'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u
    where u.id = p_friend_id and u.email is not null and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'Não foi possível criar um convite para essa pessoa.' using errcode = 'P0002'; end if;
  v_invitation_id := public.manage_group_invitation(p_group_id, v_email, 'create', null);
  return v_invitation_id;
end;
$$;

revoke all on function public.search_friend_by_username(text) from public, anon;
revoke all on function public.list_my_friendships() from public, anon;
revoke all on function public.manage_friendship(uuid, text) from public, anon;
revoke all on function public.create_group_invitation_for_friend(uuid, uuid) from public, anon;
grant execute on function public.search_friend_by_username(text) to authenticated;
grant execute on function public.list_my_friendships() to authenticated;
grant execute on function public.manage_friendship(uuid, text) to authenticated;
grant execute on function public.create_group_invitation_for_friend(uuid, uuid) to authenticated;
