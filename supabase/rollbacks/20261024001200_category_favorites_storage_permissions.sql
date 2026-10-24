-- Rollback for 20261024001200. Storage policies intentionally keep calling
-- the private helper: restoring the old public helper call would reintroduce
-- the upload permission failure this migration fixes.
begin;

drop policy if exists group_expense_favorites_select_members on public.group_expense_favorites;
drop policy if exists group_expense_favorites_insert_members on public.group_expense_favorites;
drop policy if exists group_expense_favorites_update_owners_admins on public.group_expense_favorites;
drop policy if exists group_expense_favorites_delete_owners_admins on public.group_expense_favorites;

do $rollback$
begin
  if exists (select 1 from public.group_expense_favorites) then
    raise exception 'Rollback blocked: export or resolve group favorites before dropping them';
  end if;
end
$rollback$;

drop table public.group_expense_favorites;
drop function private.favorite_participants_are_active(uuid,jsonb);

commit;
