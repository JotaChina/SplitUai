-- Etapa 4: edição e exclusão de despesas com escrita transacional controlada.
-- Aplicar somente no Supabase local nesta etapa. Escrita direta nas tabelas segue negada.

create or replace function public.update_expense_with_shares(
  p_expense_id uuid,
  p_description text,
  p_category text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_expense_date date,
  p_notes text,
  p_shares jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_share_count bigint;
  v_distinct_users bigint;
  v_share_total numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select e.group_id into v_group_id
  from public.expenses e
  where e.id = p_expense_id
  for update;

  if v_group_id is null then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
  if not public.is_current_user_group_member(v_group_id) then
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
    where gm.group_id = v_group_id and gm.user_id = p_paid_by
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
      on gm.group_id = v_group_id and gm.user_id = x.user_id
    where x.user_id is null or x.amount_cents is null or x.amount_cents <= 0
      or gm.user_id is null
  ) then
    raise exception 'Every share must belong to a group member and be positive' using errcode = '22023';
  end if;

  update public.expenses
  set paid_by = p_paid_by,
      description = btrim(p_description),
      category = p_category,
      amount_cents = p_amount_cents,
      expense_date = coalesce(p_expense_date, current_date),
      notes = nullif(btrim(p_notes), ''),
      updated_at = now()
  where id = p_expense_id;

  delete from public.expense_shares where expense_id = p_expense_id;
  insert into public.expense_shares (expense_id, group_id, user_id, amount_cents)
  select p_expense_id, v_group_id, x.user_id, x.amount_cents
  from jsonb_to_recordset(p_shares) as x(user_id uuid, amount_cents bigint);
end;
$$;

create or replace function public.delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select e.group_id into v_group_id
  from public.expenses e
  where e.id = p_expense_id
  for update;

  if v_group_id is null then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
  if not public.is_current_user_group_member(v_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;

  delete from public.expenses where id = p_expense_id;
end;
$$;

revoke all on function public.update_expense_with_shares(uuid, text, text, bigint, uuid, date, text, jsonb)
  from public, anon;
revoke all on function public.delete_expense(uuid) from public, anon;
grant execute on function public.update_expense_with_shares(uuid, text, text, bigint, uuid, date, text, jsonb)
  to authenticated;
grant execute on function public.delete_expense(uuid) to authenticated;
