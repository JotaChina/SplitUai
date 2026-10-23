-- Recorded payments are separate from expenses so they reduce balances without
-- inflating expense totals or charts. Splitwise source keys make re-imports safe.
alter table public.expenses add column splitwise_source_key text;
create unique index expenses_splitwise_source_uidx
  on public.expenses (group_id, splitwise_source_key) where splitwise_source_key is not null;

create table public.group_settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  paid_by uuid not null,
  received_by uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  settlement_date date not null,
  description text not null default 'Acerto',
  splitwise_source_key text,
  created_at timestamptz not null default now(),
  check (paid_by <> received_by),
  check (char_length(btrim(description)) between 1 and 200),
  foreign key (group_id, paid_by) references public.group_members(group_id, user_id) on delete restrict,
  foreign key (group_id, received_by) references public.group_members(group_id, user_id) on delete restrict
);
create index group_settlements_group_date_idx on public.group_settlements(group_id, settlement_date desc);
create unique index group_settlements_splitwise_source_uidx
  on public.group_settlements(group_id, splitwise_source_key) where splitwise_source_key is not null;

create or replace function public.delete_empty_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creator uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select created_by into v_creator from public.groups where id=p_group_id for update;
  if not found then raise exception 'Group not found' using errcode = 'P0002'; end if;
  if v_creator is distinct from (select auth.uid()) and not private.is_current_user_group_admin(p_group_id) then
    raise exception 'Group administrator or creator required' using errcode = '42501';
  end if;
  if exists(select 1 from public.expenses where group_id=p_group_id)
    or exists(select 1 from public.group_settlements where group_id=p_group_id) then
    raise exception 'Groups with financial records cannot be deleted; archive this group instead' using errcode = '23503';
  end if;
  delete from public.groups where id=p_group_id;
end $$;
revoke all on function public.delete_empty_group(uuid) from public, anon;
grant execute on function public.delete_empty_group(uuid) to authenticated;

alter table public.group_settlements enable row level security;
create policy group_settlements_select_members on public.group_settlements
  for select to authenticated using (private.is_current_user_group_member(group_id));
revoke all on public.group_settlements from anon, authenticated;
grant select on public.group_settlements to authenticated;

create or replace function public.import_splitwise_history(
  p_group_id uuid, p_expenses jsonb, p_settlements jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_id uuid;
  v_expenses_added integer := 0;
  v_settlements_added integer := 0;
  v_expense_count integer;
  v_settlement_count integer;
  v_installments jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not private.is_current_user_group_admin(p_group_id) then
    raise exception 'Group administrator required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_expenses) <> 'array' or jsonb_typeof(p_settlements) <> 'array' then
    raise exception 'Import payload must contain expense and settlement arrays' using errcode = '22023';
  end if;
  v_expense_count := jsonb_array_length(p_expenses);
  v_settlement_count := jsonb_array_length(p_settlements);
  if v_expense_count > 2000 or v_settlement_count > 2000 then
    raise exception 'Import is limited to 2000 expenses and 2000 settlements per request' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_to_recordset(p_expenses) as x(
    source_key text, description text, category text, amount_cents bigint,
    paid_by uuid, expense_date date, notes text, shares jsonb
  ) loop
    if v_row.source_key is null or char_length(v_row.source_key) not between 1 and 160 then raise exception 'Invalid expense source key' using errcode = '22023'; end if;
    if exists(select 1 from public.expenses where group_id=p_group_id and splitwise_source_key=v_row.source_key) then continue; end if;
    v_installments := jsonb_build_array(jsonb_build_object(
      'installment_number', 1, 'amount_cents', v_row.amount_cents,
      'due_date', v_row.expense_date, 'shares', v_row.shares
    ));
    v_id := private.save_expense_with_schedule(
      null, p_group_id, v_row.description, v_row.category, v_row.amount_cents,
      v_row.paid_by, v_row.expense_date, v_row.notes, 'custom', 0,
      v_row.shares, v_installments
    );
    update public.expenses set splitwise_source_key=v_row.source_key where id=v_id;
    v_expenses_added := v_expenses_added + 1;
  end loop;

  for v_row in select * from jsonb_to_recordset(p_settlements) as x(
    source_key text, paid_by uuid, received_by uuid, amount_cents bigint,
    settlement_date date, description text
  ) loop
    if v_row.source_key is null or char_length(v_row.source_key) not between 1 and 160 then raise exception 'Invalid settlement source key' using errcode = '22023'; end if;
    insert into public.group_settlements(group_id,created_by,paid_by,received_by,amount_cents,settlement_date,description,splitwise_source_key)
    values(p_group_id,(select auth.uid()),v_row.paid_by,v_row.received_by,v_row.amount_cents,v_row.settlement_date,
      coalesce(nullif(btrim(v_row.description),''),'Acerto'),v_row.source_key)
    on conflict (group_id,splitwise_source_key) where splitwise_source_key is not null do nothing;
    if found then v_settlements_added := v_settlements_added + 1; end if;
  end loop;
  return jsonb_build_object('expenses_added',v_expenses_added,'settlements_added',v_settlements_added,
    'expenses_existing',v_expense_count-v_expenses_added,'settlements_existing',v_settlement_count-v_settlements_added);
end $$;

revoke all on function public.import_splitwise_history(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.import_splitwise_history(uuid,jsonb,jsonb) to authenticated;
