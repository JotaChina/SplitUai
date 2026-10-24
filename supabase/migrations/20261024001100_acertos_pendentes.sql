-- Pending settlements are expectations, not completed transfers. Existing
-- Splitwise and manual records remain paid and keep reducing the balance.
alter table public.group_settlements
  add column status text not null default 'paid',
  add column paid_at timestamptz;

update public.group_settlements
set paid_at = created_at
where status = 'paid';

alter table public.group_settlements
  add constraint group_settlements_status_check
    check (status in ('pending', 'paid')),
  add constraint group_settlements_paid_at_check
    check ((status = 'pending' and paid_at is null) or (status = 'paid' and paid_at is not null));

create or replace function private.set_group_settlement_paid_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' then
    new.paid_at := coalesce(new.paid_at, new.created_at, now());
  else
    new.paid_at := null;
  end if;
  return new;
end
$$;
create trigger group_settlements_paid_at_before_write
  before insert or update of status, paid_at on public.group_settlements
  for each row execute function private.set_group_settlement_paid_at();
revoke all on function private.set_group_settlement_paid_at() from public, anon, authenticated;

create or replace function public.create_group_settlement(
  p_group_id uuid,
  p_received_by uuid,
  p_amount_cents bigint,
  p_settlement_date date,
  p_payment_method text,
  p_status text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_settlement_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.is_current_user_group_member(p_group_id) then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;
  if p_received_by is null or p_received_by = v_user_id
    or not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_received_by) then
    raise exception 'Recipient must be another group participant' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 999999999999 then
    raise exception 'Settlement amount is invalid' using errcode = '22023';
  end if;
  if p_settlement_date is null then
    raise exception 'Settlement date is required' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('pix', 'dinheiro', 'transferencia', 'cartao', 'outro') then
    raise exception 'Settlement payment method is invalid' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('pending', 'paid') then
    raise exception 'Settlement status is invalid' using errcode = '22023';
  end if;

  insert into public.group_settlements(
    group_id, created_by, paid_by, received_by, amount_cents,
    settlement_date, description, payment_method, status, paid_at
  ) values (
    p_group_id, v_user_id, v_user_id, p_received_by, p_amount_cents,
    p_settlement_date, case when p_status = 'paid' then 'Acerto manual' else 'Acerto previsto' end,
    p_payment_method, p_status, case when p_status = 'paid' then now() else null end
  ) returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;
revoke all on function public.create_group_settlement(uuid, uuid, bigint, date, text, text) from public, anon;
grant execute on function public.create_group_settlement(uuid, uuid, bigint, date, text, text) to authenticated;

-- Keep older clients able to record completed payments during a staged rollout.
create or replace function public.create_group_settlement(
  p_group_id uuid, p_received_by uuid, p_amount_cents bigint, p_settlement_date date, p_payment_method text
) returns uuid language sql security definer set search_path = '' as $$
  select public.create_group_settlement(p_group_id, p_received_by, p_amount_cents, p_settlement_date, p_payment_method, 'paid');
$$;
revoke all on function public.create_group_settlement(uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.create_group_settlement(uuid, uuid, bigint, date, text) to authenticated;

create or replace function public.mark_group_settlement_paid(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_paid_by uuid;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select group_id, paid_by, status into v_group_id, v_paid_by, v_status
    from public.group_settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;
  if not private.is_current_user_group_member(v_group_id) then
    raise exception 'Active group membership required' using errcode = '42501';
  end if;
  if v_paid_by <> (select auth.uid()) and not private.is_current_user_group_admin(v_group_id) then
    raise exception 'Only the payer or an active group administrator can confirm payment' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending settlements can be confirmed' using errcode = '23514';
  end if;
  update public.group_settlements
    set status = 'paid', paid_at = now(), settlement_date = current_date
    where id = p_settlement_id;
end;
$$;
revoke all on function public.mark_group_settlement_paid(uuid) from public, anon;
grant execute on function public.mark_group_settlement_paid(uuid) to authenticated;
