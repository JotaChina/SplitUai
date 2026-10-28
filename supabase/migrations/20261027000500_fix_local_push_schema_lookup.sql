create or replace function private.dispatch_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_net_schema text; v_request_id bigint;
begin
  select webhook_secret into v_secret from private.push_delivery_settings where singleton;
  if v_secret is not null then
    select n.nspname into v_net_schema
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      join pg_catalog.pg_depend d on d.objid=p.oid and d.deptype='e'
      join pg_catalog.pg_extension e on e.oid=d.refobjid
      where e.extname='pg_net' and p.proname='http_post'
      limit 1;
    if v_net_schema is null then raise exception 'A extensão pg_net não está disponível.'; end if;
    execute format('select %I.http_post($1,$2,$3,$4,$5)',v_net_schema) into v_request_id
      using 'http://kong:8000/functions/v1/send-web-push', jsonb_build_object('record',to_jsonb(new)),
        '{}'::jsonb, jsonb_build_object('Content-Type','application/json','x-push-webhook-secret',v_secret), 5000;
  end if;
  return new;
end;
$$;
