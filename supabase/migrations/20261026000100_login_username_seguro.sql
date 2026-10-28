-- Login por @username sem expor e-mails nem abrir leitura anônima de profiles.
-- A resolução e o contador de tentativas só são executáveis pela Edge Function
-- autenticada com a chave server-side do Supabase.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to service_role;

create table private.login_attempt_windows (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);
create index login_attempt_windows_expiry_idx on private.login_attempt_windows(window_started_at);
revoke all on private.login_attempt_windows from public, anon, authenticated;
grant all on private.login_attempt_windows to service_role;

create or replace function private.resolve_login_username(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(btrim(coalesce(p_username, '')))
  limit 1
$$;
revoke all on function private.resolve_login_username(text) from public, anon, authenticated;
grant execute on function private.resolve_login_username(text) to service_role;

create or replace function private.consume_login_attempt(p_key_hash text, p_limit integer default 8)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_attempts integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_limit is null or p_limit not between 1 and 100 then
    return false;
  end if;
  delete from private.login_attempt_windows where window_started_at < v_now - interval '1 day';
  insert into private.login_attempt_windows(key_hash, window_started_at, attempts)
    values (p_key_hash, v_now, 1)
  on conflict (key_hash) do update
    set window_started_at = case
          when private.login_attempt_windows.window_started_at <= v_now - interval '15 minutes' then v_now
          else private.login_attempt_windows.window_started_at end,
        attempts = case
          when private.login_attempt_windows.window_started_at <= v_now - interval '15 minutes' then 1
          else private.login_attempt_windows.attempts + 1 end
  returning attempts into v_attempts;
  return v_attempts <= p_limit;
end
$$;
revoke all on function private.consume_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function private.consume_login_attempt(text, integer) to service_role;

-- PostgREST só aceita schemas expostos. Estes wrappers residem em public, mas
-- EXECUTE fica restrito à chave service_role usada pela Edge Function.
create or replace function public.server_resolve_login_username(p_username text)
returns text language sql stable security definer set search_path = '' as $$
  select private.resolve_login_username(p_username)
$$;
revoke all on function public.server_resolve_login_username(text) from public, anon, authenticated;
grant execute on function public.server_resolve_login_username(text) to service_role;

create or replace function public.server_consume_login_attempt(p_key_hash text, p_limit integer default 8)
returns boolean language sql security definer set search_path = '' as $$
  select private.consume_login_attempt(p_key_hash, p_limit)
$$;
revoke all on function public.server_consume_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.server_consume_login_attempt(text, integer) to service_role;
