-- Run after the fixture, both charge migrations and direct-charges-security.sql.
\set ON_ERROR_STOP on
do $$ begin if current_database()<>'charges_ci' then raise exception 'Requires disposable charges_ci database'; end if; end $$;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
end $$;
create function pg_temp.denied(command text, expected_state text default '42501') returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then if sqlstate=expected_state then return; end if; raise; end;
  raise exception 'FAIL: unexpectedly permitted %',command;
end $$;
insert into public.friendships(requester_id,addressee_id,status) values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','accepted');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Jantar',2400,null,8001,'alimentacao','2026-11-18','Detalhes','percentage',3000);
select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Jantar',2400,null,8001,'alimentacao','2026-11-18','Detalhes','percentage',3000);
select pg_temp.assert((select count(*)=1 from public.direct_charge_events where charge_id='20000000-0000-0000-0000-000000000001'),'retry is idempotent');
select pg_temp.assert((select notes='Detalhes' and category='alimentacao' and debtor_percentage=3000 from public.list_my_direct_charges() where id='20000000-0000-0000-0000-000000000001'),'metadata round trip');
select pg_temp.denied($q$select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Jantar',2400,null,8001,'outros','2026-11-18','Detalhes','percentage',3000)$q$,'22023');
select pg_temp.denied($q$select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Invalido',2401,null,8001,'alimentacao','2026-11-18',null,'percentage',3000)$q$,'23514');
select pg_temp.denied($q$select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Invalido',9000,null,8001,'alimentacao','2026-11-18',null,'custom',null)$q$,'23514');
select pg_temp.denied($q$select public.create_direct_charge('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Legacy unequal',3000,null,8001)$q$,'23514');
select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Centavo',1,null,1,'outros','2026-11-18',null,'custom',null);
select pg_temp.assert((select count(*)=1 and bool_and(pix_key is null) from public.get_friend_profile('00000000-0000-0000-0000-000000000002')),'basic friend profile hides Pix');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select pg_temp.assert((select count(*)=0 from public.get_friend_profile('00000000-0000-0000-0000-000000000002')),'unrelated profile hidden');
select pg_temp.assert((select count(*)=0 from public.list_my_direct_charges()),'unrelated expenses hidden');
select pg_temp.denied($q$select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','Sem amizade',1,null,1,'outros','2026-11-18',null,'custom',null)$q$);
reset role;
set role anon;
select pg_temp.denied($q$select public.get_friend_profile('00000000-0000-0000-0000-000000000002')$q$);
select pg_temp.denied($q$select public.create_detailed_direct_charge('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','Anon',1,null,1,'outros','2026-11-18',null,'custom',null)$q$);
reset role;
