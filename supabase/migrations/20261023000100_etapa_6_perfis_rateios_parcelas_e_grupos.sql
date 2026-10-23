-- Etapa 6: identificadores, arquivos de grupo, rateios e cronogramas mensais.
-- Rodar/validar somente no Supabase local. Nenhuma aplicação remota nesta etapa.

alter table public.profiles add column username text;
create unique index profiles_username_ci_uidx on public.profiles (lower(username)) where username is not null;

create or replace function private.normalize_profile_username()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text;
begin
  if new.username is null or btrim(new.username) = '' then
    new.username := null;
    return new;
  end if;
  v_username := lower(btrim(new.username));
  if char_length(v_username) not between 3 and 24 or v_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username must contain 3 to 24 letters, numbers or underscores' using errcode = '22023';
  end if;
  if v_username = any (array['admin','administrator','root','support','ajuda','splituai','system','null','undefined','api','auth','login','signup','settings','account','groups','group','expense','expenses','profile','profiles','user','users','www','me']) then
    raise exception 'Username is reserved' using errcode = '22023';
  end if;
  new.username := v_username;
  return new;
end;
$$;
create trigger profiles_normalize_username before insert or update of username on public.profiles
for each row execute function private.normalize_profile_username();
revoke all on function private.normalize_profile_username() from public, anon, authenticated;
grant update (username) on public.profiles to authenticated;

alter table public.groups add column archived_at timestamptz;
alter table public.expenses add column split_mode text not null default 'equal'
  check (split_mode in ('equal','percentage','custom'));
alter table public.expenses add column rounding_remainder_cents bigint not null default 0
  check (rounding_remainder_cents between 0 and amount_cents);

alter table public.expense_shares drop constraint if exists expense_shares_amount_cents_check;
alter table public.expense_shares add constraint expense_shares_amount_cents_check check (amount_cents >= 0);
alter table public.expense_shares add column split_percentage numeric(7,2)
  check (split_percentage is null or split_percentage between 0 and 100);

create table public.expense_installments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  installment_number integer not null check (installment_number between 1 and 60),
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null,
  unique (expense_id, installment_number),
  unique (id, expense_id)
);
create table public.expense_installment_shares (
  installment_id uuid not null,
  expense_id uuid not null,
  user_id uuid not null,
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (installment_id, user_id),
  foreign key (installment_id, expense_id) references public.expense_installments(id, expense_id) on delete cascade,
  foreign key (expense_id, user_id) references public.expense_shares(expense_id, user_id) on delete cascade
);
create index expense_installments_due_date_idx on public.expense_installments (due_date, expense_id);

alter table public.expense_installments enable row level security;
alter table public.expense_installment_shares enable row level security;
create policy expense_installments_select_members on public.expense_installments
  for select to authenticated using (exists (
    select 1 from public.expenses e where e.id = expense_id and private.is_current_user_group_member(e.group_id)
  ));
create policy expense_installment_shares_select_members on public.expense_installment_shares
  for select to authenticated using (exists (
    select 1 from public.expenses e where e.id = expense_id and private.is_current_user_group_member(e.group_id)
  ));
revoke all on public.expense_installments, public.expense_installment_shares from anon, authenticated;
grant select on public.expense_installments, public.expense_installment_shares to authenticated;

-- Backfill existing expenses as one installment due on the original expense date.
insert into public.expense_installments (expense_id, installment_number, amount_cents, due_date)
select id, 1, amount_cents, expense_date from public.expenses;
insert into public.expense_installment_shares (installment_id, expense_id, user_id, amount_cents)
select i.id, s.expense_id, s.user_id, s.amount_cents
from public.expense_installments i join public.expense_shares s on s.expense_id = i.expense_id;

-- Archive/restore is available to every member. Permanent deletion is limited to the
-- creator or a group administrator, and only while the group has no expenses.
create or replace function public.set_group_archived(p_group_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not private.is_current_user_group_member(p_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;
  update public.groups set archived_at = case when p_archived then now() else null end, updated_at = now()
  where id = p_group_id;
end;
$$;

create or replace function public.delete_empty_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creator uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select created_by into v_creator from public.groups where id = p_group_id for update;
  if not found then raise exception 'Group not found' using errcode = 'P0002'; end if;
  if v_creator is distinct from (select auth.uid()) and not private.is_current_user_group_admin(p_group_id) then
    raise exception 'Group administrator or creator required' using errcode = '42501';
  end if;
  if exists (select 1 from public.expenses where group_id = p_group_id) then
    raise exception 'Groups with expenses cannot be deleted; archive this group instead' using errcode = '23503';
  end if;
  delete from public.groups where id = p_group_id;
end;
$$;

-- Shared save routine; all checks and writes, including the installment schedule,
-- run atomically. Each installment's participant shares must reconcile to its amount
-- less the final rounding adjustment borne by the payer.
create or replace function private.save_expense_with_schedule(
  p_expense_id uuid, p_group_id uuid, p_description text, p_category text, p_amount_cents bigint,
  p_paid_by uuid, p_expense_date date, p_notes text, p_split_mode text,
  p_rounding_remainder_cents bigint, p_shares jsonb, p_installments jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_group_id uuid := p_group_id;
  v_expense_id uuid := p_expense_id;
  v_count bigint;
  v_distinct bigint;
  v_sum numeric;
  v_installment_count bigint;
  v_last_number integer;
  v_last_amount bigint;
  v_installment_id uuid;
  v_due date;
  v_json jsonb;
  v_installment_row record;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expense_id is not null then
    select group_id into v_group_id from public.expenses where id = p_expense_id for update;
    if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
    if not private.is_current_user_group_admin(v_group_id) then
      raise exception 'Group administrator required' using errcode = '42501';
    end if;
  elsif not private.is_current_user_group_member(v_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 999999999999
    or p_description is null or char_length(btrim(p_description)) not between 1 and 200
    or p_category is null or p_category not in ('hospedagem','alimentacao','transporte','atividades','outros')
    or p_split_mode is null or p_split_mode not in ('equal','percentage','custom')
    or p_rounding_remainder_cents is null or p_rounding_remainder_cents < 0
    or p_rounding_remainder_cents > p_amount_cents then
    raise exception 'Invalid expense fields' using errcode = '22023';
  end if;
  if p_split_mode = 'custom' and p_rounding_remainder_cents <> 0 then
    raise exception 'Custom shares must total the expense amount exactly' using errcode = '22023';
  end if;
  if p_paid_by is null or not exists (select 1 from public.group_members where group_id = v_group_id and user_id = p_paid_by) then
    raise exception 'Payer must belong to the group' using errcode = '22023';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'At least one expense share is required' using errcode = '22023';
  end if;
  select count(*), count(distinct x.user_id), coalesce(sum(x.amount_cents),0)
    into v_count, v_distinct, v_sum
  from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint);
  if v_count <> v_distinct or v_sum + p_rounding_remainder_cents <> p_amount_cents then
    raise exception 'Shares and payer rounding adjustment must total the expense amount' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint)
    left join public.group_members m on m.group_id = v_group_id and m.user_id = x.user_id
    where x.user_id is null or x.amount_cents is null or x.amount_cents < 0 or m.user_id is null
  ) then raise exception 'Every share must belong to a group member and be nonnegative' using errcode = '22023'; end if;
  if p_split_mode = 'equal' then
    if p_rounding_remainder_cents <> mod(p_amount_cents, v_count)
      or exists (select 1 from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint)
        where x.amount_cents <> (p_amount_cents / v_count)) then
      raise exception 'Equal shares and payer adjustment are inconsistent' using errcode = '22023';
    end if;
  elsif p_split_mode = 'percentage' then
    if p_rounding_remainder_cents <> 0 or exists (
      with raw_shares as (
        select x.user_id, x.amount_cents, x.percentage,
          (p_amount_cents * x.percentage / 100) as raw_amount,
          floor(p_amount_cents * x.percentage / 100)::bigint as floor_amount
        from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint, percentage numeric)
      ), ranked as (
        select *, row_number() over (order by raw_amount - floor_amount desc, user_id) as remainder_rank,
          p_amount_cents - sum(floor_amount) over () as remainder_count
        from raw_shares
      )
      select 1 from ranked where percentage is null or percentage < 0 or percentage > 100
        or round(percentage,2) <> percentage
        or amount_cents <> floor_amount + case when remainder_rank <= remainder_count then 1 else 0 end
    ) or (select coalesce(sum(x.percentage),0) from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint, percentage numeric)) <> 100 then
      raise exception 'Percentages must total 100 and match the deterministic cent allocation' using errcode = '22023';
    end if;
  elsif p_split_mode = 'custom' and p_rounding_remainder_cents <> 0 then
    raise exception 'Custom shares must total the expense amount exactly' using errcode = '22023';
  end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' then
    raise exception 'Installment schedule is required' using errcode = '22023';
  end if;
  select count(*), count(distinct x.installment_number), coalesce(sum(x.amount_cents),0), max(x.installment_number)
    into v_installment_count, v_distinct, v_sum, v_last_number
  from jsonb_to_recordset(p_installments) as x(installment_number integer, amount_cents bigint, due_date date, shares jsonb);
  if v_installment_count < 1 or v_installment_count > 60 or v_distinct <> v_installment_count or v_sum <> p_amount_cents or v_last_number <> v_installment_count then
    raise exception 'Installments must be numbered 1..N, up to 60, and total the expense amount' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_installments) as x(installment_number integer, amount_cents bigint, due_date date, shares jsonb)
    where x.installment_number < 1 or x.installment_number > v_installment_count
      or x.amount_cents is null or x.amount_cents < 1 or x.due_date is null
      or jsonb_typeof(x.shares) <> 'array'
      or (select coalesce(sum(s.amount_cents),0) from jsonb_to_recordset(x.shares) as s(user_id uuid, amount_cents bigint))
        <> x.amount_cents - case when x.installment_number = v_installment_count then p_rounding_remainder_cents else 0 end
  ) then raise exception 'Invalid installment shares, dates, or amounts' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_installments) as x(installment_number integer, amount_cents bigint, due_date date, shares jsonb)
    cross join lateral jsonb_to_recordset(x.shares) as s(user_id uuid, amount_cents bigint)
    left join public.group_members m on m.group_id = v_group_id and m.user_id = s.user_id
    where s.user_id is null or s.amount_cents is null or s.amount_cents < 0 or m.user_id is null
  ) then raise exception 'Installment share contains a non-member or invalid amount' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_shares) as s(user_id uuid, amount_cents bigint)
    where s.amount_cents <> coalesce((
      select sum(part.amount_cents) from jsonb_to_recordset(p_installments) as x(installment_number integer, amount_cents bigint, due_date date, shares jsonb)
      cross join lateral jsonb_to_recordset(x.shares) as part(user_id uuid, amount_cents bigint)
      where part.user_id = s.user_id
    ),0)
  ) or exists (
    select 1 from jsonb_to_recordset(p_installments) as x(installment_number integer, amount_cents bigint, due_date date, shares jsonb)
    cross join lateral jsonb_to_recordset(x.shares) as part(user_id uuid, amount_cents bigint)
    where not exists (select 1 from jsonb_to_recordset(p_shares) as s(user_id uuid, amount_cents bigint) where s.user_id = part.user_id)
  ) then raise exception 'Installment shares must match the total expense shares' using errcode = '22023'; end if;

  if p_expense_id is null then
    insert into public.expenses(group_id,created_by,paid_by,description,category,amount_cents,expense_date,notes,split_mode,rounding_remainder_cents)
    values(v_group_id,(select auth.uid()),p_paid_by,btrim(p_description),p_category,p_amount_cents,coalesce(p_expense_date,current_date),nullif(btrim(p_notes),''),p_split_mode,p_rounding_remainder_cents)
    returning id into v_expense_id;
  else
    update public.expenses set paid_by=p_paid_by, description=btrim(p_description), category=p_category,
      amount_cents=p_amount_cents, expense_date=coalesce(p_expense_date,current_date), notes=nullif(btrim(p_notes),''),
      split_mode=p_split_mode, rounding_remainder_cents=p_rounding_remainder_cents, updated_at=now()
    where id=v_expense_id;
    delete from public.expense_installments where expense_id=v_expense_id;
    delete from public.expense_shares where expense_id=v_expense_id;
  end if;
  insert into public.expense_shares(expense_id,group_id,user_id,amount_cents,split_percentage)
  select v_expense_id,v_group_id,s.user_id,s.amount_cents,s.percentage
  from jsonb_to_recordset(p_shares) as s(user_id uuid, amount_cents bigint, percentage numeric);
  for v_installment_row in
    select x.installment_number,x.amount_cents,x.due_date,x.shares
    from jsonb_to_recordset(p_installments) as x(installment_number integer, amount_cents bigint, due_date date, shares jsonb)
    order by x.installment_number
  loop
    v_last_number := v_installment_row.installment_number;
    v_last_amount := v_installment_row.amount_cents;
    v_due := v_installment_row.due_date;
    v_json := v_installment_row.shares;
    insert into public.expense_installments(expense_id,installment_number,amount_cents,due_date)
    values(v_expense_id,v_last_number,v_last_amount,v_due) returning id into v_installment_id;
    insert into public.expense_installment_shares(installment_id,expense_id,user_id,amount_cents)
    select v_installment_id,v_expense_id,s.user_id,s.amount_cents from jsonb_to_recordset(v_json) as s(user_id uuid, amount_cents bigint);
  end loop;
  return v_expense_id;
end;
$$;

create or replace function public.create_expense_with_schedule(
  p_group_id uuid,p_description text,p_category text,p_amount_cents bigint,p_paid_by uuid,p_expense_date date,
  p_notes text,p_split_mode text,p_rounding_remainder_cents bigint,p_shares jsonb,p_installments jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.save_expense_with_schedule(null,p_group_id,p_description,p_category,p_amount_cents,p_paid_by,p_expense_date,p_notes,p_split_mode,p_rounding_remainder_cents,p_shares,p_installments);
end;
$$;

create or replace function public.update_expense_with_schedule(
  p_expense_id uuid,p_description text,p_category text,p_amount_cents bigint,p_paid_by uuid,p_expense_date date,
  p_notes text,p_split_mode text,p_rounding_remainder_cents bigint,p_shares jsonb,p_installments jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.save_expense_with_schedule(p_expense_id,null,p_description,p_category,p_amount_cents,p_paid_by,p_expense_date,p_notes,p_split_mode,p_rounding_remainder_cents,p_shares,p_installments);
end;
$$;

revoke all on function private.save_expense_with_schedule(uuid,uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.create_expense_with_schedule(uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb) from public,anon;
revoke all on function public.update_expense_with_schedule(uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.create_expense_with_schedule(uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb) to authenticated;
grant execute on function public.update_expense_with_schedule(uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb) to authenticated;
revoke all on function public.create_expense_with_shares(uuid,text,text,bigint,uuid,date,text,jsonb) from public,anon,authenticated;
revoke all on function public.update_expense_with_shares(uuid,text,text,bigint,uuid,date,text,jsonb) from public,anon,authenticated;

revoke all on function public.set_group_archived(uuid,boolean) from public,anon;
revoke all on function public.delete_empty_group(uuid) from public,anon;
grant execute on function public.set_group_archived(uuid,boolean) to authenticated;
grant execute on function public.delete_empty_group(uuid) to authenticated;

create or replace function public.set_my_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_username text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_username := lower(btrim(coalesce(p_username,'')));
  if char_length(v_username) not between 3 and 24 or v_username !~ '^[a-z0-9_]+$' then
    raise exception 'Use 3 a 24 letras, números ou sublinhados.' using errcode = '22023';
  end if;
  update public.profiles set username=v_username,updated_at=now() where id=(select auth.uid());
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  return v_username;
end;
$$;
revoke all on function public.set_my_username(text) from public,anon;
grant execute on function public.set_my_username(text) to authenticated;

