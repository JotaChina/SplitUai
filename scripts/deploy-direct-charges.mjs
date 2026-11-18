import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const project = 'yzxeyqutmvjmrglmpcbb'
const version = '20261118000200'
const migration = readFileSync(new URL('../supabase/migrations/20261118000200_direct_charges.sql', import.meta.url), 'utf8')
const quote = value => `'${value.replaceAll("'", "''")}'`

export async function checkDirectChargesAccess({ token, projectUrl, query }) {
  if (!token) throw new Error('Configure SUPABASE_ACCESS_TOKEN no Environment SplitUai.')
  if (projectUrl !== `https://${project}.supabase.co`) throw new Error('Projeto Supabase inesperado. Nenhuma alteração foi enviada.')
  const before = await query(`select
    exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied,
    to_regclass('public.direct_charges') is not null as charges_exist,
    to_regprocedure('private.add_notification(uuid,text,text,text,text,text)') is not null as notifications_ready,
    to_regclass('public.friendships') is not null as friendships_ready,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check') as previous_notification_constraint;`)
  if (!before[0]?.friendships_ready || !before[0]?.notifications_ready) throw new Error('Estrutura de amizades/avisos não está pronta. Nenhuma migração foi enviada.')
  if (before[0].charges_exist && !before[0].applied) throw new Error('Já existe uma tabela de cobranças sem registro da migração. Revisão necessária.')
  return before[0]
}

export async function deployDirectCharges({ token, projectUrl, query, backupPath }) {
  const before = [await checkDirectChargesAccess({ token, projectUrl, query })]
  if (backupPath) writeFileSync(backupPath, JSON.stringify({ project, version, schemaBefore: before[0] }, null, 2))
  if (!before[0].applied) {
    // Apply only this feature. Do not push the unrelated, pending Push migration.
    // The lock and ledger check inside the transaction make concurrent retries safe.
    if (migration.includes('$direct_migration$')) throw new Error('Delimitador SQL inesperado.')
    await query(`begin;
      set local lock_timeout='5s';
      set local statement_timeout='60s';
      select pg_advisory_xact_lock(hashtextextended('SplitUai:direct-charges:${version}',0));
      do $deploy$ begin
        if not exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
          if to_regclass('public.direct_charges') is not null or to_regclass('public.direct_charge_events') is not null then
            raise exception 'Untracked direct charge schema; refusing to modify';
          end if;
          execute $direct_migration$${migration}$direct_migration$;
          insert into supabase_migrations.schema_migrations(version,name,statements)
            values('${version}','direct_charges',array[${quote(migration)}]);
        end if;
      end $deploy$;
      commit;`)
  }
  const after = await query(`select
    exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied,
    (select relrowsecurity from pg_class where oid='public.direct_charges'::regclass) as charges_rls,
    (select relrowsecurity from pg_class where oid='public.direct_charge_events'::regclass) as history_rls,
    exists(select 1 from storage.buckets where id='direct-charge-receipts' and not public and file_size_limit=5242880) as private_receipts,
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='direct_charges') as realtime,
    to_regprocedure('public.create_direct_charge(uuid,uuid,text,integer,date,integer)') is not null as create_rpc,
    to_regprocedure('public.list_my_direct_charges()') is not null as list_rpc,
    to_regprocedure('public.manage_direct_charge(uuid,text,text,text)') is not null as manage_rpc,
    not has_function_privilege('anon','public.list_my_direct_charges()','execute') as anon_blocked,
    not has_table_privilege('authenticated','public.direct_charges','update') as direct_updates_blocked;`)
  if (!after[0] || !Object.values(after[0]).every(value => value === true)) throw new Error('Verificação pós-migração falhou. Não publique a interface; revise a estrutura do projeto.')
  return { applied: true, alreadyApplied: before[0].applied, project, version }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const query = async sql => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(90000),
    })
    // Never log the response body: a server error can contain SQL or private data.
    if (!response.ok) throw new Error(`Supabase Management API retornou HTTP ${response.status}. Verifique a validade e as permissões do token.`)
    const rows = await response.json()
    if (!Array.isArray(rows)) throw new Error('Resposta inesperada da Management API.')
    return rows
  }
  try {
    if (process.argv.includes('--check')) {
      await checkDirectChargesAccess({ token, projectUrl: process.env.VITE_SUPABASE_URL, query })
      console.log(`Credencial validada por consulta somente de leitura no projeto ${project}. Nenhuma migração foi aplicada.`)
      process.exit(0)
    }
    const result = await deployDirectCharges({ token, projectUrl: process.env.VITE_SUPABASE_URL, query, backupPath: process.env.DIRECT_CHARGES_BACKUP_PATH })
    console.log(`Migração ${result.version} confirmada no projeto ${result.project}.`)
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, 'applied=true\n', { flag:'a' })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
