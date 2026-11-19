import { readFileSync } from 'node:fs'
const project = 'yzxeyqutmvjmrglmpcbb'
const version = '20261118000300'
const sql = readFileSync(new URL('../supabase/migrations/20261118000300_detailed_direct_charges.sql', import.meta.url), 'utf8')
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token || process.env.VITE_SUPABASE_URL !== `https://${project}.supabase.co`) throw new Error('Credencial ausente ou projeto inesperado')
const query = async statement => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: statement }), signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new Error(`Consulta SQL retornou HTTP ${response.status}`)
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Resposta SQL inesperada')
  return rows
}
const before = await query(`select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied,
  to_regclass('public.direct_charges') is not null as charges_ready,
  to_regprocedure('public.get_friend_profile(uuid)') is not null as social_ready;`)
if (!before[0]?.charges_ready) throw new Error('Migração de cobranças anterior ausente')
if (!before[0].applied && before[0].social_ready) throw new Error('Esquema sem registro da migração; revisão manual necessária')
if (!before[0].applied) {
  const quote = value => `'${value.replaceAll("'", "''")}'`
  await query(`begin;
    set local lock_timeout='5s';
    set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('SplitUai:direct-charges:${version}',0));
    do $deploy$ begin
      if not exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
        execute $migration$${sql}$migration$;
        insert into supabase_migrations.schema_migrations(version,name,statements)
        values ('${version}','detailed_direct_charges',array[${quote(sql)}]);
      end if;
    end $deploy$;
    commit;`)
}
const after = await query(`select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied,
  to_regprocedure('public.create_detailed_direct_charge(uuid,uuid,text,integer,date,integer,text,date,text,text,integer)') is not null as create_ready,
  to_regprocedure('public.get_friend_profile(uuid)') is not null as social_ready,
  (select relrowsecurity from pg_class where oid='public.direct_charges'::regclass) as charges_rls,
  not has_function_privilege('anon','public.get_friend_profile(uuid)','execute') as anonymous_blocked;`)
if (!after[0] || !Object.values(after[0]).every(Boolean)) throw new Error('Verificação da migração falhou')
console.log(`Migração ${version} confirmada no projeto ${project}.`)
