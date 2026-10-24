-- Group scoped expense/rate split favorites. Active members can read/use them;
-- the creator or an active group admin can change or remove them.
create or replace function private.favorite_participants_are_active(p_group_id uuid, p_template jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select jsonb_typeof(p_template->'participants') = 'array'
    and jsonb_array_length(coalesce(p_template->'participants','[]'::jsonb)) > 0
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_template->'participants','[]'::jsonb)) p(user_id)
      where not exists (select 1 from public.group_members gm where gm.group_id=p_group_id and gm.user_id=p.user_id::uuid and gm.active)
    )
    and (p_template->>'paid_by' is null or exists (
      select 1 from public.group_members gm where gm.group_id=p_group_id and gm.user_id=(p_template->>'paid_by')::uuid and gm.active
    ));
$$;
revoke all on function private.favorite_participants_are_active(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.favorite_participants_are_active(uuid,jsonb) to authenticated;

create table public.group_expense_favorites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null check (kind in ('split','expense')),
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, group_id)
);
alter table public.group_expense_favorites enable row level security;
create policy group_expense_favorites_select_members on public.group_expense_favorites
  for select to authenticated using (private.is_current_user_group_member(group_id));
create policy group_expense_favorites_insert_members on public.group_expense_favorites
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and private.is_current_user_group_member(group_id)
    and private.favorite_participants_are_active(group_id, template)
  );
create policy group_expense_favorites_update_owners_admins on public.group_expense_favorites
  for update to authenticated using (
    private.is_current_user_group_admin(group_id) or created_by = (select auth.uid())
  ) with check (
    private.is_current_user_group_member(group_id)
    and private.favorite_participants_are_active(group_id, template)
  );
create policy group_expense_favorites_delete_owners_admins on public.group_expense_favorites
  for delete to authenticated using (private.is_current_user_group_member(group_id) and (
    private.is_current_user_group_admin(group_id) or created_by = (select auth.uid())
  ));
revoke all on public.group_expense_favorites from public, anon, authenticated;
grant select, insert, update, delete on public.group_expense_favorites to authenticated;

-- Migration 005 moved this helper to private and revoked the public signature.
-- Storage policies must invoke the private helper to preserve the admin check.
drop policy if exists splituai_images_group_insert on storage.objects;
drop policy if exists splituai_images_group_update on storage.objects;
drop policy if exists splituai_images_group_delete on storage.objects;
create policy splituai_images_group_insert on storage.objects
  for insert to authenticated with check (
    bucket_id='splituai-images' and (storage.foldername(name))[1]='groups'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and private.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  );
create policy splituai_images_group_update on storage.objects
  for update to authenticated using (
    bucket_id='splituai-images' and (storage.foldername(name))[1]='groups'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and private.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  ) with check (
    bucket_id='splituai-images' and (storage.foldername(name))[1]='groups'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and private.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  );
create policy splituai_images_group_delete on storage.objects
  for delete to authenticated using (
    bucket_id='splituai-images' and (storage.foldername(name))[1]='groups'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and private.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  );
