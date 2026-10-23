-- Fotos de perfil e grupos, com arquivos públicos e gravação autorizada.
alter table public.profiles add column avatar_url text;
alter table public.groups add column icon_url text;
alter table public.groups add column cover_url text;

grant update (avatar_url) on public.profiles to authenticated;
grant update (icon_url, cover_url) on public.groups to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('splituai-images', 'splituai-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy splituai_images_public_read on storage.objects
  for select to public using (bucket_id = 'splituai-images');

create policy splituai_images_profile_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
create policy splituai_images_profile_update on storage.objects
  for update to authenticated using (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  ) with check (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
create policy splituai_images_profile_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy splituai_images_group_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  );
create policy splituai_images_group_update on storage.objects
  for update to authenticated using (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  ) with check (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  );
create policy splituai_images_group_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'splituai-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_current_user_group_admin(((storage.foldername(name))[2])::uuid)
  );
