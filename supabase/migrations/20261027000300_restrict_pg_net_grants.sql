-- Supabase's pg_net extension grants HTTP execution to browser roles by
-- default. Notifications call it only from the private definer trigger.
do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_extension e on e.extnamespace=n.oid
    where e.extname='pg_net' and p.proname in ('http_post','http_get')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_function);
  end loop;
end;
$$;
