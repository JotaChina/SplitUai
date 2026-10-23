alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('hospedagem', 'alimentacao', 'transporte', 'corrida', 'atividades', 'outros'));

do $migration$
declare
  v_definition text;
  v_old text := $old$p_category not in ('hospedagem','alimentacao','transporte','atividades','outros')$old$;
  v_new text := $new$p_category not in ('hospedagem','alimentacao','transporte','corrida','atividades','outros')$new$;
begin
  select pg_get_functiondef(
    'private.save_expense_with_schedule(uuid,uuid,text,text,bigint,uuid,date,text,text,bigint,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif position('''corrida''' in v_definition) = 0 then
    raise exception 'Could not extend the expense category validation for corrida';
  end if;
end
$migration$;

-- Bring existing ride fares into the dedicated category. This changes only
-- categorization; expense amounts, splits, dates, and balances remain intact.
update public.expenses
set category = 'corrida', updated_at = now()
where category <> 'corrida'
  and (
    description ~* '(corrida|uber|garupa|99[[:space:]]?(pop|app)?|t[aá]xi)'
    or coalesce(notes, '') ~* '(corrida|uber|garupa|99[[:space:]]?(pop|app)?|t[aá]xi)'
  );
