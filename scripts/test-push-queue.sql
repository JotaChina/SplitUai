-- LOCAL ONLY. Run through psql against localhost:54322 or the local Docker DB.
-- Everything, including pg_net wakeups, is rolled back. Uses two existing users.
-- This does NOT validate delivery by a real Push service.
begin;
do $$
declare
  a uuid; b uuid; sub uuid; job uuid; notification uuid; first_token uuid; affected integer;
  endpoint text := 'https://fcm.googleapis.com/splituai-sql-test-'||gen_random_uuid();
begin
  select id into a from auth.users order by created_at,id limit 1;
  select id into b from auth.users where id<>a order by created_at,id limit 1;
  if a is null or b is null then raise exception 'Prepare two LOCAL test accounts first'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  sub := public.register_push_device(endpoint,repeat('a',87),repeat('b',22));
  job := public.enqueue_push_test(sub);
  begin
    perform public.enqueue_push_test(sub);
    raise exception 'Rate limit failed' using errcode='XX000';
  exception when sqlstate 'P0001' then null; end;
  perform public.claim_push_deliveries();
  select lease_token into first_token from public.push_deliveries where id=job;
  if first_token is null then raise exception 'Job was not claimed'; end if;
  perform public.claim_push_deliveries();
  if (select attempts from public.push_deliveries where id=job)<>1 then raise exception 'Duplicate claim while leased'; end if;
  update public.push_deliveries set lease_until=now()-interval '1 second' where id=job;
  perform public.claim_push_deliveries();
  if (select attempts from public.push_deliveries where id=job)<>2 then raise exception 'Expired lease not reclaimed'; end if;
  update public.push_deliveries set status='accepted' where id=job and lease_token=first_token;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Stale worker overwrote current lease'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  begin
    perform public.register_push_device(endpoint,repeat('c',87),repeat('d',22));
    raise exception 'Wrong keys took ownership' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.enqueue_push_test(sub);
    raise exception 'Test reached another account device' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  perform public.register_push_device(endpoint,repeat('a',87),repeat('b',22));
  if (select user_id from public.web_push_subscriptions where id=sub)<>b then raise exception 'Account transfer failed'; end if;
  if exists(select 1 from public.push_deliveries where subscription_id=sub and user_id=a) then raise exception 'Previous account jobs retained'; end if;
  insert into public.notifications(user_id,event_key,kind,title,message,destination)
    values(b,'sql-push-test:'||gen_random_uuid(),'friend_request_received','Teste','Teste','/SplitUai/?tab=friends') returning id into notification;
  perform private.recover_push_queue(); perform private.recover_push_queue();
  if (select count(*) from public.push_deliveries where notification_id=notification and subscription_id=sub)<>1 then raise exception 'Enqueue deduplication failed'; end if;
  update public.web_push_subscriptions set invalidated_at=now() where id=sub;
  perform public.claim_push_deliveries();
  if exists(select 1 from public.push_deliveries where notification_id=notification and subscription_id=sub and status='processing') then raise exception 'Revoked device claimed'; end if;
  if has_table_privilege('authenticated','public.push_deliveries','INSERT') or has_column_privilege('authenticated','public.web_push_subscriptions','user_id','UPDATE') then raise exception 'Unsafe client grants'; end if;
  raise notice 'Queue assertions passed (transaction will be rolled back)';
end $$;
rollback;
