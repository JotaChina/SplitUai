-- Novas categorias são valores simples para preservar o modelo e o histórico.
-- A hierarquia (Contas da Casa e Transporte) é apresentada pela aplicação.
alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in (
  'hospedagem','alimentacao','transporte','corrida','atividades','outros',
  'aluguel','luz','agua','iptu','internet','viagens','streaming','fitness',
  'fatura_cartao','acerto_outros_grupos','transporte_gasolina',
  'transporte_aluguel_veiculo','transporte_onibus','transporte_aviao',
  'transporte_corrida_app','transporte_pedagio','transporte_multas',
  'transporte_ipva','transporte_manutencao'
));

do $migration$
declare
  v_definition text;
  v_old text := $old$p_category not in ('hospedagem','alimentacao','transporte','corrida','atividades','outros','aluguel','luz','agua','iptu')$old$;
  v_new text := $new$p_category not in ('hospedagem','alimentacao','transporte','corrida','atividades','outros','aluguel','luz','agua','iptu','internet','viagens','streaming','fitness','fatura_cartao','acerto_outros_grupos','transporte_gasolina','transporte_aluguel_veiculo','transporte_onibus','transporte_aviao','transporte_corrida_app','transporte_pedagio','transporte_multas','transporte_ipva','transporte_manutencao')$new$;
begin
  select pg_get_functiondef('private.save_expense_with_schedule(uuid,uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb)'::regprocedure)
    into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'Could not extend expense category validation';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

-- A série guarda um único modelo mensal. Despesas materializadas são registros
-- normais, com uma chave única série/competência para idempotência.
create table public.expense_recurring_series (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  starts_on date not null,
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, group_id)
);
alter table public.expenses add column recurring_series_id uuid;
alter table public.expenses add column recurring_month date;
alter table public.expenses add constraint expenses_recurring_series_fk
  foreign key (recurring_series_id, group_id) references public.expense_recurring_series(id, group_id);
alter table public.expenses add constraint expenses_recurring_month_check
  check ((recurring_series_id is null and recurring_month is null) or
         (recurring_series_id is not null and recurring_month is not null and recurring_month = date_trunc('month', recurring_month)::date));
create unique index expenses_recurring_occurrence_uidx
  on public.expenses(recurring_series_id, recurring_month) where recurring_series_id is not null;
create index expense_recurring_series_group_idx on public.expense_recurring_series(group_id, starts_on) where active;
create table public.expense_recurring_exceptions (
  series_id uuid not null references public.expense_recurring_series(id) on delete cascade,
  occurrence_month date not null check (occurrence_month = date_trunc('month',occurrence_month)::date),
  skipped_at timestamptz not null default now(),
  primary key(series_id,occurrence_month)
);
alter table public.expense_recurring_exceptions enable row level security;
revoke all on public.expense_recurring_exceptions from public,anon,authenticated;

create or replace function private.remember_deleted_recurring_occurrence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.recurring_series_id is not null and old.recurring_month is not null then
    insert into public.expense_recurring_exceptions(series_id,occurrence_month)
      values(old.recurring_series_id,old.recurring_month) on conflict do nothing;
  end if;
  return old;
end
$$;
create trigger expenses_remember_recurring_delete after delete on public.expenses
  for each row execute function private.remember_deleted_recurring_occurrence();
revoke all on function private.remember_deleted_recurring_occurrence() from public,anon,authenticated;

alter table public.expense_recurring_series enable row level security;
create policy expense_recurring_series_select_members on public.expense_recurring_series
  for select to authenticated using (private.is_current_user_group_member(group_id));
revoke all on public.expense_recurring_series from anon, authenticated;
grant select on public.expense_recurring_series to authenticated;
revoke all on public.expenses from anon, authenticated;
grant select on public.expenses to authenticated;

create or replace function public.create_recurring_expense(p_group_id uuid, p_template jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_series_id uuid;
  v_expense_id uuid;
  v_date date;
begin
  if (select auth.uid()) is null or not private.is_current_user_group_member(p_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;
  if p_template is null or jsonb_typeof(p_template) <> 'object' then
    raise exception 'Invalid recurring expense template' using errcode = '22023';
  end if;
  if jsonb_typeof(p_template->'p_installments') <> 'array'
    or jsonb_array_length(p_template->'p_installments') <> 1 then
    raise exception 'A monthly recurring expense must contain exactly one monthly occurrence' using errcode = '22023';
  end if;
  v_date := (p_template->>'p_expense_date')::date;
  insert into public.expense_recurring_series(group_id,created_by,starts_on,template)
  values(p_group_id,(select auth.uid()),v_date,p_template) returning id into v_series_id;
  v_expense_id := private.save_expense_with_schedule(null,p_group_id,
    p_template->>'p_description',p_template->>'p_category',(p_template->>'p_amount_cents')::bigint,
    (p_template->>'p_paid_by')::uuid,v_date,p_template->>'p_notes',p_template->>'p_split_mode',
    (p_template->>'p_rounding_remainder_cents')::bigint,p_template->'p_shares',p_template->'p_installments');
  update public.expenses set recurring_series_id=v_series_id, recurring_month=date_trunc('month',v_date)::date
    where id=v_expense_id;
  return v_expense_id;
end
$$;
revoke all on function public.create_recurring_expense(uuid,jsonb) from public,anon;
grant execute on function public.create_recurring_expense(uuid,jsonb) to authenticated;

create or replace function public.ensure_recurring_expenses_through(p_group_id uuid,p_through_month date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_series record;
  v_month date;
  v_occurrence_date date;
  v_last_day integer;
  v_original_day integer;
  v_template jsonb;
  v_installments jsonb;
  v_count integer := 0;
  v_id uuid;
begin
  if (select auth.uid()) is null or not private.is_current_user_group_member(p_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;
  if p_through_month is null or p_through_month <> date_trunc('month',p_through_month)::date
    or p_through_month > date_trunc('month',current_date)::date then
    raise exception 'Requested month must be a valid current or past month' using errcode = '22023';
  end if;
  for v_series in select * from public.expense_recurring_series
    where group_id=p_group_id and active and starts_on <= (p_through_month + interval '1 month - 1 day')::date
    order by starts_on,id
  loop
    v_month := date_trunc('month',v_series.starts_on)::date;
    v_original_day := extract(day from v_series.starts_on)::integer;
    while v_month <= p_through_month loop
      if not exists (select 1 from public.expenses where recurring_series_id=v_series.id and recurring_month=v_month)
        and not exists (select 1 from public.expense_recurring_exceptions where series_id=v_series.id and occurrence_month=v_month) then
        v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::integer;
        v_occurrence_date := v_month + (least(v_original_day,v_last_day)-1);
        v_template := jsonb_set(v_series.template,'{p_expense_date}',to_jsonb(v_occurrence_date::text));
        v_installments := jsonb_set(v_template->'p_installments','{0,due_date}',to_jsonb(v_occurrence_date::text));
        v_template := jsonb_set(v_template,'{p_installments}',v_installments);
        begin
          v_id := private.save_expense_with_schedule(null,p_group_id,v_template->>'p_description',
            v_template->>'p_category',(v_template->>'p_amount_cents')::bigint,(v_template->>'p_paid_by')::uuid,
            v_occurrence_date,v_template->>'p_notes',v_template->>'p_split_mode',
            (v_template->>'p_rounding_remainder_cents')::bigint,v_template->'p_shares',v_template->'p_installments');
          update public.expenses set recurring_series_id=v_series.id,recurring_month=v_month where id=v_id;
          v_count := v_count + 1;
        exception when unique_violation then
          -- Outra consulta materializou a mesma competência ao mesmo tempo.
          null;
        end;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
  return v_count;
end
$$;
revoke all on function public.ensure_recurring_expenses_through(uuid,date) from public,anon;
grant execute on function public.ensure_recurring_expenses_through(uuid,date) to authenticated;
