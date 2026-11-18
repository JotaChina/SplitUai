-- Only for an empty disposable CI PostgreSQL database, never production.
do $$ begin
  if current_database() <> 'charges_ci' then raise exception 'Test fixture requires charges_ci'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,storage,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key references auth.users,username text,display_name text,pix_key text);
create table public.friendships(id uuid primary key default gen_random_uuid(),requester_id uuid,addressee_id uuid,status text);
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,event_key text unique,kind text constraint notifications_kind_check check(kind in ('friend_request_received')),title text,message text,destination text);
create function private.add_notification(p_user uuid,p_key text,p_kind text,p_title text,p_message text,p_destination text)
returns void language sql security definer set search_path='' as $$
  insert into public.notifications(user_id,event_key,kind,title,message,destination)
  values(p_user,p_key,p_kind,p_title,p_message,p_destination) on conflict(event_key) do nothing;
$$;
revoke all on function private.add_notification(uuid,text,text,text,text,text) from public;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text unique);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into public.profiles select id,'user'||right(id::text,1),'Pessoa', 'pix-test' from auth.users;
