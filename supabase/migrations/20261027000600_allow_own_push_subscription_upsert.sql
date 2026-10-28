-- The client upserts its own browser subscription. PostgreSQL requires UPDATE
-- privileges for ON CONFLICT DO UPDATE, so limit those privileges and updates
-- to the authenticated user's own subscription row.
create policy push_subscriptions_update_own
  on public.web_push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant update (user_id, endpoint, p256dh, auth)
  on public.web_push_subscriptions to authenticated;
