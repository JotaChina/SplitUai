-- Registros manuais de acerto guardam a forma de pagamento e são criados
-- em nome do usuário autenticado, sem permitir gravação direta na tabela.
alter table public.group_settlements
  add column payment_method text not null default 'splitwise';

alter table public.group_settlements
  add constraint group_settlements_payment_method_check
  check (payment_method in ('pix', 'dinheiro', 'transferencia', 'cartao', 'outro', 'splitwise'));

create or replace function public.create_group_settlement(
  p_group_id uuid,
  p_received_by uuid,
  p_amount_cents bigint,
  p_settlement_date date,
  p_payment_method text
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
  if p_received_by is null or p_received_by = v_user_id then
    raise exception 'Choose another group participant as the recipient' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_received_by
  ) then
    raise exception 'Recipient must belong to this group' using errcode = '22023';
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

  insert into public.group_settlements(
    group_id, created_by, paid_by, received_by, amount_cents,
    settlement_date, description, payment_method
  ) values (
    p_group_id, v_user_id, v_user_id, p_received_by, p_amount_cents,
    p_settlement_date, 'Acerto manual', p_payment_method
  ) returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;

revoke all on function public.create_group_settlement(uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.create_group_settlement(uuid, uuid, bigint, date, text) to authenticated;
