-- Preserve existing charges and participant-only access. Amounts are integer cents.
alter table public.direct_charges
  add column category text not null default 'outros',
  add column expense_date date,
  add column notes text check (char_length(notes) <= 2000),
  add column split_mode text,
  add column debtor_percentage integer;
update public.direct_charges set expense_date=(created_at at time zone 'America/Sao_Paulo')::date,
  split_mode=case when total_cents is null then 'charge' else 'equal' end;
alter table public.direct_charges alter column expense_date set not null;
alter table public.direct_charges alter column expense_date set default current_date;
-- NULL mode is reserved for the original RPC, which continues to enforce equal splitting.
-- PostgreSQL may derive the unnamed CHECK name from its column names.
do $$ declare constraint_name text; begin
  select c.conname into strict constraint_name from pg_constraint c
  where c.conrelid='public.direct_charges'::regclass and c.contype='c'
    and c.conkey @> array[
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='amount_cents'),
      (select attnum from pg_attribute where attrelid=c.conrelid and attname='total_cents')
    ]::smallint[];
  execute format('alter table public.direct_charges drop constraint %I',constraint_name);
end $$;
alter table public.direct_charges drop constraint direct_charges_total_cents_check;
alter table public.direct_charges add constraint direct_charges_total_cents_check check (total_cents between 1 and 200000000);
alter table public.direct_charges add constraint direct_charge_split_valid check ((
  (coalesce(split_mode, case when total_cents is null then 'charge' else 'equal' end) = 'charge' and total_cents is null and debtor_percentage is null)
  or (total_cents is not null and amount_cents <= total_cents and total_cents - amount_cents <= 100000000 and (
    (coalesce(split_mode,'equal')='equal' and amount_cents=total_cents/2 and debtor_percentage is null)
    or (split_mode='custom' and debtor_percentage is null)
    or (split_mode='percentage' and debtor_percentage is not null and debtor_percentage between 1 and 10000
      and amount_cents=round(total_cents::numeric*debtor_percentage/10000))
  ))
) is true);
alter table public.direct_charges add constraint direct_charge_category_valid check (category in ('alimentacao','hospedagem','transporte','corrida','atividades','outros','aluguel','luz','agua','iptu','internet','viagens','streaming','fitness','fatura_cartao','acerto_outros_grupos','transporte_gasolina','transporte_aluguel_veiculo','transporte_onibus','transporte_aviao','transporte_corrida_app','transporte_pedagio','transporte_multas','transporte_ipva','transporte_manutencao'));
create function public.create_detailed_direct_charge(p_id uuid, p_friend_id uuid, p_description text,
  p_amount_cents integer, p_due_date date, p_total_cents integer,
  p_category text, p_expense_date date, p_notes text, p_split_mode text, p_debtor_percentage integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_existing public.direct_charges%rowtype;
begin
  if v_actor is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  if p_id is null or p_friend_id is null or p_friend_id = v_actor then
    raise exception 'Escolha uma amizade aceita.' using errcode='22023'; end if;
  if p_split_mode is null or p_split_mode not in ('charge','equal','percentage','custom') then raise exception 'Rateio inválido.' using errcode='22023'; end if;
  -- Same pair lock as manage_friendship: creation cannot race with unfriend.
  perform pg_advisory_xact_lock(hashtextextended(least(v_actor::text,p_friend_id::text)||':'||greatest(v_actor::text,p_friend_id::text),0));
  select * into v_existing from public.direct_charges where id=p_id;
  if found then
    if v_existing.creditor_id=v_actor and v_existing.debtor_id=p_friend_id
      and v_existing.description=btrim(p_description) and v_existing.amount_cents=p_amount_cents
      and v_existing.due_date is not distinct from p_due_date
      and v_existing.total_cents is not distinct from p_total_cents and v_existing.category=p_category and v_existing.expense_date=p_expense_date
      and v_existing.notes is not distinct from nullif(btrim(p_notes),'')
      and v_existing.split_mode=p_split_mode
      and v_existing.debtor_percentage is not distinct from p_debtor_percentage then return p_id; end if;
    raise exception 'Identificador de cobrança já utilizado.' using errcode='22023';
  end if;
  if not exists (select 1 from public.friendships f where f.status='accepted' and
    ((f.requester_id=v_actor and f.addressee_id=p_friend_id) or (f.addressee_id=v_actor and f.requester_id=p_friend_id))) then
    raise exception 'Só é possível cobrar amizades aceitas.' using errcode='42501'; end if;
  insert into public.direct_charges(id,creditor_id,debtor_id,description,amount_cents,due_date,total_cents,category,expense_date,notes,split_mode,debtor_percentage)
    values(p_id,v_actor,p_friend_id,btrim(p_description),p_amount_cents,p_due_date,p_total_cents,p_category,p_expense_date,nullif(btrim(p_notes),''),p_split_mode,p_debtor_percentage);
  insert into public.direct_charge_events(charge_id,actor_id,action) values(p_id,v_actor,'created');
  perform private.add_notification(p_friend_id,'direct:'||p_id||':created','direct_charge_updated',
    'Nova cobrança entre amigos','Você recebeu uma solicitação de pagamento.','/SplitUai/?tab=charges&charge='||p_id);
  return p_id;
end $$;

drop function public.list_my_direct_charges();
create function public.list_my_direct_charges()
returns table(id uuid, creditor_id uuid, debtor_id uuid, description text, amount_cents integer,
  total_cents integer, due_date date, status text, expense_attachment text, payment_attachment text,
  created_at timestamptz, updated_at timestamptz, other_name text, creditor_pix_key text, category text, expense_date date, notes text, split_mode text, debtor_percentage integer)
language sql stable security definer set search_path = '' as $$
  select c.id,c.creditor_id,c.debtor_id,c.description,c.amount_cents,c.total_cents,c.due_date,c.status,
    c.expense_attachment,c.payment_attachment,c.created_at,c.updated_at,
    coalesce('@'||p.username,p.display_name,'Pessoa usuária'), cp.pix_key,c.category,c.expense_date,c.notes,coalesce(c.split_mode,case when c.total_cents is null then 'charge' else 'equal' end),c.debtor_percentage
  from public.direct_charges c
  join public.profiles p on p.id=case when c.creditor_id=auth.uid() then c.debtor_id else c.creditor_id end
  join public.profiles cp on cp.id=c.creditor_id
  where auth.uid() in (c.creditor_id,c.debtor_id) order by c.created_at desc;
$$;

revoke all on function public.create_detailed_direct_charge(uuid,uuid,text,integer,date,integer,text,date,text,text,integer) from public,anon;
grant execute on function public.create_detailed_direct_charge(uuid,uuid,text,integer,date,integer,text,date,text,text,integer) to authenticated;
revoke all on function public.list_my_direct_charges() from public,anon;
grant execute on function public.list_my_direct_charges() to authenticated;
notify pgrst, 'reload schema';

-- Basic social profile only; Pix and email are not exposed through this endpoint.
create function public.get_friend_profile(p_user_id uuid)
returns table(id uuid, display_name text, username text, avatar_url text, pix_key text)
language sql stable security definer set search_path='' as $$
  select p.id,p.display_name,p.username,p.avatar_url,null::text from public.profiles p
  where p.id=p_user_id and auth.uid() is not null and (
    exists(select 1 from public.friendships f where f.status in ('pending','accepted')
      and ((f.requester_id=auth.uid() and f.addressee_id=p.id) or (f.addressee_id=auth.uid() and f.requester_id=p.id)))
    or exists(select 1 from public.direct_charges c where
      (c.creditor_id=auth.uid() and c.debtor_id=p.id) or (c.debtor_id=auth.uid() and c.creditor_id=p.id))
  );
$$;
revoke all on function public.get_friend_profile(uuid) from public,anon;
grant execute on function public.get_friend_profile(uuid) to authenticated;
