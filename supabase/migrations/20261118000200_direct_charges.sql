-- Direct charges have no group and never participate in group balances.
create table public.direct_charges (
  id uuid primary key,
  creditor_id uuid not null references auth.users(id),
  debtor_id uuid not null references auth.users(id),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  total_cents integer check (total_cents between 2 and 200000000),
  due_date date,
  status text not null default 'pending' check (status in ('pending','accepted','disputed','payment_reported','paid','cancelled')),
  expense_attachment text,
  payment_attachment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (creditor_id <> debtor_id),
  check (total_cents is null or amount_cents = total_cents / 2)
);
create index direct_charges_creditor on public.direct_charges(creditor_id, created_at desc);
create index direct_charges_debtor on public.direct_charges(debtor_id, created_at desc);
alter table public.direct_charges enable row level security;
revoke all on public.direct_charges from public, anon, authenticated;
grant select on public.direct_charges to authenticated;
create policy direct_charges_participants on public.direct_charges for select to authenticated
  using ((select auth.uid()) in (creditor_id, debtor_id));

create table public.direct_charge_events (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.direct_charges(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  attachment text,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index direct_charge_events_charge on public.direct_charge_events(charge_id, created_at);
alter table public.direct_charge_events enable row level security;
revoke all on public.direct_charge_events from public, anon, authenticated;
grant select on public.direct_charge_events to authenticated;
create policy direct_charge_events_participants on public.direct_charge_events for select to authenticated
  using (exists (select 1 from public.direct_charges c where c.id = charge_id));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'expense_added','expense_changed','expense_removed','invitation_received','invitation_accepted',
  'invitation_declined','invitation_expired','settlement_partial','settlement_total',
  'friend_request_received','friend_request_accepted','friend_request_declined','direct_charge_updated'
));

create function public.create_direct_charge(p_id uuid, p_friend_id uuid, p_description text,
  p_amount_cents integer, p_due_date date default null, p_total_cents integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_existing public.direct_charges%rowtype;
begin
  if v_actor is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  if p_id is null or p_friend_id is null or p_friend_id = v_actor then
    raise exception 'Escolha uma amizade aceita.' using errcode='22023'; end if;
  -- Same pair lock as manage_friendship: creation cannot race with unfriend.
  perform pg_advisory_xact_lock(hashtextextended(least(v_actor::text,p_friend_id::text)||':'||greatest(v_actor::text,p_friend_id::text),0));
  select * into v_existing from public.direct_charges where id=p_id;
  if found then
    if v_existing.creditor_id=v_actor and v_existing.debtor_id=p_friend_id
      and v_existing.description=btrim(p_description) and v_existing.amount_cents=p_amount_cents
      and v_existing.due_date is not distinct from p_due_date
      and v_existing.total_cents is not distinct from p_total_cents then return p_id; end if;
    raise exception 'Identificador de cobrança já utilizado.' using errcode='22023';
  end if;
  if not exists (select 1 from public.friendships f where f.status='accepted' and
    ((f.requester_id=v_actor and f.addressee_id=p_friend_id) or (f.addressee_id=v_actor and f.requester_id=p_friend_id))) then
    raise exception 'Só é possível cobrar amizades aceitas.' using errcode='42501'; end if;
  insert into public.direct_charges(id,creditor_id,debtor_id,description,amount_cents,due_date,total_cents)
    values(p_id,v_actor,p_friend_id,btrim(p_description),p_amount_cents,p_due_date,p_total_cents);
  insert into public.direct_charge_events(charge_id,actor_id,action) values(p_id,v_actor,'created');
  perform private.add_notification(p_friend_id,'direct:'||p_id||':created','direct_charge_updated',
    'Nova cobrança entre amigos','Você recebeu uma solicitação de pagamento.','/SplitUai/?tab=charges&charge='||p_id);
  return p_id;
end $$;

-- Dedicated RPC exposes only participant identity and creditor Pix, never email.
create function public.list_my_direct_charges()
returns table(id uuid, creditor_id uuid, debtor_id uuid, description text, amount_cents integer,
  total_cents integer, due_date date, status text, expense_attachment text, payment_attachment text,
  created_at timestamptz, updated_at timestamptz, other_name text, creditor_pix_key text)
language sql stable security definer set search_path = '' as $$
  select c.id,c.creditor_id,c.debtor_id,c.description,c.amount_cents,c.total_cents,c.due_date,c.status,
    c.expense_attachment,c.payment_attachment,c.created_at,c.updated_at,
    coalesce('@'||p.username,p.display_name,'Pessoa usuária'), cp.pix_key
  from public.direct_charges c
  join public.profiles p on p.id=case when c.creditor_id=auth.uid() then c.debtor_id else c.creditor_id end
  join public.profiles cp on cp.id=c.creditor_id
  where auth.uid() in (c.creditor_id,c.debtor_id) order by c.created_at desc;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('direct-charge-receipts','direct-charge-receipts',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy direct_receipts_read on storage.objects for select to authenticated using (
  bucket_id='direct-charge-receipts' and exists (
    select 1 from public.direct_charges c where c.id::text=split_part(name,'/',1)
      and (select auth.uid()) in (c.creditor_id,c.debtor_id)));
create policy direct_receipts_upload on storage.objects for insert to authenticated with check (
  bucket_id='direct-charge-receipts' and split_part(name,'/',2)=(select auth.uid())::text
  and exists (select 1 from public.direct_charges c where c.id::text=split_part(name,'/',1)
    and ((c.creditor_id=(select auth.uid()) and c.status='pending')
      or (c.debtor_id=(select auth.uid()) and c.status='accepted'))));

create function public.manage_direct_charge(p_id uuid, p_action text, p_note text default null, p_attachment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); c public.direct_charges%rowtype; v_status text; v_target uuid;
begin
  if v_actor is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  select * into c from public.direct_charges where id=p_id for update;
  if not found or v_actor not in (c.creditor_id,c.debtor_id) then
    raise exception 'Cobrança indisponível.' using errcode='42501'; end if;
  if p_action is null then raise exception 'Ação inválida.' using errcode='22023'; end if;
  if p_attachment is not null and (p_action not in ('report_payment','attach_expense')
    or split_part(p_attachment,'/',1)<>p_id::text or split_part(p_attachment,'/',2)<>v_actor::text
    or not exists(select 1 from storage.objects where bucket_id='direct-charge-receipts' and name=p_attachment)) then
    raise exception 'Comprovante inválido.' using errcode='22023'; end if;
  v_status:=case
    when p_action='accept' and v_actor=c.debtor_id and c.status='pending' then 'accepted'
    when p_action='dispute' and v_actor=c.debtor_id and c.status in ('pending','accepted') then 'disputed'
    when p_action='reopen' and v_actor=c.creditor_id and c.status='disputed' then 'pending'
    when p_action='report_payment' and v_actor=c.debtor_id and c.status='accepted' then 'payment_reported'
    when p_action='confirm_payment' and v_actor=c.creditor_id and c.status='payment_reported' then 'paid'
    when p_action='reject_payment' and v_actor=c.creditor_id and c.status='payment_reported' then 'accepted'
    when p_action='cancel' and v_actor=c.creditor_id and c.status in ('pending','accepted','disputed') then 'cancelled'
    when p_action='attach_expense' and v_actor=c.creditor_id and c.status='pending' and p_attachment is not null then 'pending'
    else null end;
  if v_status is null then raise exception 'Ação não permitida para a situação atual. Atualize a lista.' using errcode='42501'; end if;
  if p_action in ('dispute','reject_payment') and coalesce(char_length(btrim(p_note)),0)=0 then
    raise exception 'Informe o motivo.' using errcode='22023'; end if;
  update public.direct_charges set status=v_status,updated_at=clock_timestamp(),
    expense_attachment=case when p_action='attach_expense' then p_attachment else expense_attachment end,
    payment_attachment=case when p_action='report_payment' then p_attachment else payment_attachment end
    where id=p_id;
  insert into public.direct_charge_events(charge_id,actor_id,action,note,attachment)
    values(p_id,v_actor,p_action,nullif(btrim(p_note),''),p_attachment);
  v_target:=case when v_actor=c.creditor_id then c.debtor_id else c.creditor_id end;
  perform private.add_notification(v_target,'direct:'||p_id||':'||p_action||':'||txid_current(),
    'direct_charge_updated',case when p_action='report_payment' then 'Pagamento informado'
      when p_action='confirm_payment' then 'Recebimento confirmado' else 'Cobrança atualizada' end,
    'Há uma atualização em uma cobrança entre amigos.','/SplitUai/?tab=charges&charge='||p_id);
end $$;

revoke all on function public.create_direct_charge(uuid,uuid,text,integer,date,integer) from public,anon;
revoke all on function public.list_my_direct_charges() from public,anon;
revoke all on function public.manage_direct_charge(uuid,text,text,text) from public,anon;
grant execute on function public.create_direct_charge(uuid,uuid,text,integer,date,integer) to authenticated;
grant execute on function public.list_my_direct_charges() to authenticated;
grant execute on function public.manage_direct_charge(uuid,text,text,text) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.direct_charges;
  end if;
end $$;
