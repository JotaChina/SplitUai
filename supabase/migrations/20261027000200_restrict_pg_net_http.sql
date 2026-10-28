-- pg_net is installed into the extension's configured schema. Its HTTP
-- functions must not be callable through PostgREST by browser roles.
do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_extension e on e.extname = 'pg_net'
    join pg_catalog.pg_depend d on d.objid = p.oid and d.refobjid = e.oid and d.deptype = 'e'
    where p.proname in ('http_post','http_get')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
  end loop;
end;
$$;
