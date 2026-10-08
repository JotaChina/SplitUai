-- Admin invites can reach auth.users before invited_at is populated.
-- The invitation allowlist remains the authorization check; public signup stays blocked.
create or replace function public.handle_invited_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_has_bootstrap boolean;
  v_has_group_invite boolean;
  v_invite record;
begin
  v_email := lower(btrim(new.email));
  if v_email is null or v_email = '' then
    raise exception 'SplitUai accounts are invitation-only' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.bootstrap_invites bi
    where bi.email = v_email and bi.consumed_at is null and bi.expires_at > now()
  ) into v_has_bootstrap;

  select exists (
    select 1 from public.group_invitations gi
    where gi.invited_email = v_email and gi.status = 'pending' and gi.expires_at > now()
  ) into v_has_group_invite;

  if not v_has_bootstrap and not v_has_group_invite then
    raise exception 'A valid SplitUai invitation is required' using errcode = '42501';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, nullif(btrim(new.raw_user_meta_data ->> 'name'), ''));

  if v_has_bootstrap then
    update public.bootstrap_invites
    set consumed_at = now()
    where email = v_email and consumed_at is null;
  end if;

  for v_invite in
    select gi.id, gi.group_id
    from public.group_invitations gi
    where gi.invited_email = v_email and gi.status = 'pending' and gi.expires_at > now()
    for update
  loop
    insert into public.group_members (group_id, user_id, role)
    values (v_invite.group_id, new.id, 'member')
    on conflict (group_id, user_id) do nothing;

    update public.group_invitations
    set status = 'sent', sent_at = now()
    where id = v_invite.id;
  end loop;

  return new;
end;
$$;
