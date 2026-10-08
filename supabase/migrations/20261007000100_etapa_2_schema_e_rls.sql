-- SplitUai — Etapa 2: schema, acesso por convite e RLS.
-- Aplicar somente ao novo projeto confirmado em sa-east-1 (São Paulo).
-- Nunca vincular/aplicar ao projeto ipbnqofmggytdkgmadtc (us-east-1).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  invited_email text not null check (
    invited_email = lower(btrim(invited_email))
    and invited_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  invited_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'sent', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  sent_at timestamptz
);

-- Permite ao titular inicial receber um convite Auth sem habilitar cadastro público.
-- Inserções nesta tabela são feitas somente pelo proprietário via SQL Editor.
create table public.bootstrap_invites (
  email text primary key check (
    email = lower(btrim(email))
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  consumed_at timestamptz
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null,
  paid_by uuid not null,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  category text not null default 'outros'
    check (category in ('hospedagem', 'alimentacao', 'transporte', 'atividades', 'outros')),
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  currency text not null default 'BRL' check (currency = 'BRL'),
  expense_date date not null default current_date,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, group_id),
  foreign key (group_id, created_by) references public.group_members (group_id, user_id) on delete restrict,
  foreign key (group_id, paid_by) references public.group_members (group_id, user_id) on delete restrict
);

create table public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (expense_id, user_id),
  foreign key (expense_id, group_id) references public.expenses (id, group_id) on delete cascade,
  foreign key (group_id, user_id) references public.group_members (group_id, user_id) on delete restrict
);

create index groups_created_by_idx on public.groups (created_by);
create index group_members_user_group_idx on public.group_members (user_id, group_id);
create index group_invitations_group_status_idx on public.group_invitations (group_id, status);
create index group_invitations_email_idx on public.group_invitations (invited_email, expires_at)
  where status = 'pending';
create unique index group_invitations_pending_email_uidx
  on public.group_invitations (group_id, invited_email) where status = 'pending';
create index expenses_group_date_idx on public.expenses (group_id, expense_date desc, created_at desc);
create index expenses_paid_by_idx on public.expenses (paid_by, group_id);
create index expense_shares_user_idx on public.expense_shares (user_id, group_id);

create or replace function public.is_current_user_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_current_user_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'admin'
  );
$$;

create or replace function public.can_current_user_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = (select auth.uid()) or exists (
    select 1
    from public.group_members target_member
    join public.group_members current_member
      on current_member.group_id = target_member.group_id
    where target_member.user_id = p_profile_id
      and current_member.user_id = (select auth.uid())
  );
$$;

create or replace function public.add_group_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger groups_add_creator_as_admin
after insert on public.groups
for each row execute function public.add_group_creator_as_admin();

create or replace function public.create_expense_with_shares(
  p_group_id uuid,
  p_description text,
  p_category text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_expense_date date,
  p_notes text,
  p_shares jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid;
  v_share_count bigint;
  v_distinct_users bigint;
  v_share_total numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_current_user_group_member(p_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 999999999999 then
    raise exception 'Invalid expense amount' using errcode = '22023';
  end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 200 then
    raise exception 'Invalid expense description' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('hospedagem', 'alimentacao', 'transporte', 'atividades', 'outros') then
    raise exception 'Invalid expense category' using errcode = '22023';
  end if;
  if p_paid_by is null or not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_paid_by
  ) then
    raise exception 'Payer must belong to the group' using errcode = '22023';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) is distinct from 'array'
    or jsonb_array_length(p_shares) = 0 then
    raise exception 'At least one expense share is required' using errcode = '22023';
  end if;

  select count(*), count(distinct x.user_id), coalesce(sum(x.amount_cents), 0)
  into v_share_count, v_distinct_users, v_share_total
  from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint);

  if v_share_count <> v_distinct_users then
    raise exception 'Each participant may appear only once' using errcode = '22023';
  end if;
  if v_share_total <> p_amount_cents then
    raise exception 'Expense shares must total the expense amount' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint)
    left join public.group_members gm
      on gm.group_id = p_group_id and gm.user_id = x.user_id
    where x.user_id is null or x.amount_cents is null or x.amount_cents <= 0
      or gm.user_id is null
  ) then
    raise exception 'Every share must belong to a group member and be positive' using errcode = '22023';
  end if;

  insert into public.expenses (
    group_id, created_by, paid_by, description, category, amount_cents, expense_date, notes
  ) values (
    p_group_id, (select auth.uid()), p_paid_by, btrim(p_description), p_category,
    p_amount_cents, coalesce(p_expense_date, current_date), nullif(btrim(p_notes), '')
  ) returning id into v_expense_id;

  insert into public.expense_shares (expense_id, group_id, user_id, amount_cents)
  select v_expense_id, p_group_id, x.user_id, x.amount_cents
  from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint);

  return v_expense_id;
end;
$$;

-- Somente convites criados pelo painel/Auth e anotados no bootstrap/grupo
-- podem originar usuários. Cadastro público é recusado também no banco.
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
  if new.invited_at is null or v_email is null or v_email = '' then
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

create trigger auth_user_requires_splituai_invitation
after insert on auth.users
for each row execute function public.handle_invited_auth_user();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.bootstrap_invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;

create policy profiles_select_self_or_group_peers on public.profiles
  for select to authenticated using (public.can_current_user_view_profile(id));
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy profiles_insert_denied on public.profiles
  for insert to authenticated with check (false);
create policy profiles_delete_denied on public.profiles
  for delete to authenticated using (false);

create policy groups_select_members on public.groups
  for select to authenticated using (public.is_current_user_group_member(id));
create policy groups_insert_self_as_creator on public.groups
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy groups_update_admins on public.groups
  for update to authenticated using (public.is_current_user_group_admin(id))
  with check (public.is_current_user_group_admin(id));
create policy groups_delete_denied on public.groups
  for delete to authenticated using (false);

create policy group_members_select_group_peers on public.group_members
  for select to authenticated using (public.is_current_user_group_member(group_id));
create policy group_members_insert_denied on public.group_members
  for insert to authenticated with check (false);
create policy group_members_update_denied on public.group_members
  for update to authenticated using (false) with check (false);
create policy group_members_delete_denied on public.group_members
  for delete to authenticated using (false);

create policy group_invitations_select_admins on public.group_invitations
  for select to authenticated using (public.is_current_user_group_admin(group_id));
create policy group_invitations_insert_admins on public.group_invitations
  for insert to authenticated with check (
    invited_by = (select auth.uid())
    and public.is_current_user_group_admin(group_id)
    and status = 'pending'
    and expires_at > now()
  );
create policy group_invitations_update_denied on public.group_invitations
  for update to authenticated using (false) with check (false);
create policy group_invitations_delete_denied on public.group_invitations
  for delete to authenticated using (false);

create policy bootstrap_invites_select_denied on public.bootstrap_invites
  for select to authenticated using (false);
create policy bootstrap_invites_insert_denied on public.bootstrap_invites
  for insert to authenticated with check (false);
create policy bootstrap_invites_update_denied on public.bootstrap_invites
  for update to authenticated using (false) with check (false);
create policy bootstrap_invites_delete_denied on public.bootstrap_invites
  for delete to authenticated using (false);

create policy expenses_select_group_members on public.expenses
  for select to authenticated using (public.is_current_user_group_member(group_id));
create policy expenses_insert_denied on public.expenses
  for insert to authenticated with check (false);
create policy expenses_update_denied on public.expenses
  for update to authenticated using (false) with check (false);
create policy expenses_delete_denied on public.expenses
  for delete to authenticated using (false);

create policy expense_shares_select_group_members on public.expense_shares
  for select to authenticated using (public.is_current_user_group_member(group_id));
create policy expense_shares_insert_denied on public.expense_shares
  for insert to authenticated with check (false);
create policy expense_shares_update_denied on public.expense_shares
  for update to authenticated using (false) with check (false);
create policy expense_shares_delete_denied on public.expense_shares
  for delete to authenticated using (false);

revoke all on public.profiles, public.groups, public.group_members,
  public.group_invitations, public.bootstrap_invites, public.expenses,
  public.expense_shares from anon, authenticated;
grant select on public.profiles, public.groups, public.group_members,
  public.group_invitations, public.expenses, public.expense_shares to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert (name, description, created_by) on public.groups to authenticated;
grant update (name, description) on public.groups to authenticated;
grant insert (group_id, invited_email, invited_by, status, expires_at)
  on public.group_invitations to authenticated;

revoke all on function public.is_current_user_group_member(uuid) from public, anon;
revoke all on function public.is_current_user_group_admin(uuid) from public, anon;
revoke all on function public.can_current_user_view_profile(uuid) from public, anon;
revoke all on function public.add_group_creator_as_admin() from public, anon, authenticated;
revoke all on function public.handle_invited_auth_user() from public, anon, authenticated;
revoke all on function public.create_expense_with_shares(uuid, text, text, bigint, uuid, date, text, jsonb)
  from public, anon;
grant execute on function public.is_current_user_group_member(uuid) to authenticated;
grant execute on function public.is_current_user_group_admin(uuid) to authenticated;
grant execute on function public.can_current_user_view_profile(uuid) to authenticated;
grant execute on function public.create_expense_with_shares(uuid, text, text, bigint, uuid, date, text, jsonb)
  to authenticated;
