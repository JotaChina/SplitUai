import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const project = 'yzxeyqutmvjmrglmpcbb'
const version = '20261118000100'
const url = `https://${project}.supabase.co`
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token || process.env.VITE_SUPABASE_URL !== url) throw new Error('Missing credential or unexpected production project')
async function api(path, options = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(90000),
  })
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]}: HTTP ${res.status}`)
  return res
}
async function query(sql) { return (await api('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) })).json() }
const secrets = await (await api('/secrets')).json()
for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  if (!secrets.some(s => s.name === name)) throw new Error(`Production secret missing: ${name}`)
}
const publicDigest = createHash('sha256').update(process.env.VITE_VAPID_PUBLIC_KEY ?? '').digest('hex')
if (secrets.find(s => s.name === 'VAPID_PUBLIC_KEY')?.value !== publicDigest) throw new Error('Frontend and backend VAPID public keys do not match')
const [before] = await query(`select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied,
  to_regclass('public.push_deliveries') is not null as queue_exists,
  exists(select 1 from pg_available_extensions where name='pg_cron') as cron_available,
  exists(select 1 from pg_extension where extname='pg_net') as network_ready,
  exists(select 1 from supabase_migrations.schema_migrations where version='20261118000300') as detailed_ready;`)
console.log('Production preflight:', JSON.stringify(before))
if (!before.cron_available || !before.network_ready || !before.detailed_ready) throw new Error('Production prerequisites missing')
if (before.queue_exists !== before.applied) throw new Error('Untracked queue schema; refusing migration')
if (process.argv.includes('--check')) process.exit(0)
const backup = process.env.RUNNER_TEMP ?? '.production-backups'
mkdirSync(join(backup, 'push-release'), { recursive: true })
writeFileSync(join(backup, 'push-release', 'preflight.json'), JSON.stringify(before))
const oldFunction = await api('/functions/send-web-push/body', { headers: { Accept: '*/*' } })
writeFileSync(join(backup, 'push-release', 'previous-function.bin'), Buffer.from(await oldFunction.arrayBuffer()))
if (!before.applied) {
  const sql = readFileSync(new URL('../supabase/migrations/20261118000100_reliable_push.sql', import.meta.url), 'utf8')
  const quote = s => `'${s.replaceAll("'", "''")}'`
  await query(`begin; set local lock_timeout='5s'; set local statement_timeout='60s';
    select pg_advisory_xact_lock(hashtextextended('SplitUai:reliable-push',0));
    ${sql}
    update private.push_delivery_settings set function_url='${url}/functions/v1/send-web-push';
    select cron.alter_job((select jobid from cron.job where jobname='splituai-push-recovery'),active:=false);
    insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','reliable_push',array[${quote(sql)}]); commit;`)
}
// Preserve production's VAPID pair and synchronize only the private worker secret.
const [settings] = await query('select webhook_secret from private.push_delivery_settings where singleton')
const hook = settings?.webhook_secret || randomBytes(32).toString('hex')
await api('/secrets', { method: 'POST', body: JSON.stringify([{ name: 'PUSH_WEBHOOK_SECRET', value: hook }]) })
await query(`insert into private.push_delivery_settings(singleton,webhook_secret,function_url)
  values(true,'${hook.replaceAll("'", "''")}','${url}/functions/v1/send-web-push')
  on conflict(singleton) do update set function_url=excluded.function_url;`)
execFileSync('npx', ['supabase', 'functions', 'deploy', 'send-web-push', '--project-ref', project, '--no-verify-jwt', '--use-api'], { stdio: 'inherit' })
const anonymous = await fetch(`${url}/functions/v1/send-web-push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
if (anonymous.status !== 401) throw new Error(`Anonymous request must be refused: ${anonymous.status}`)
const worker = await fetch(`${url}/functions/v1/send-web-push`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-push-webhook-secret': hook }, body: '{}' })
if (worker.status !== 200) throw new Error(`Worker verification failed: HTTP ${worker.status}`)
const [verified] = await query(`select
  (select relrowsecurity from pg_class where oid='public.push_deliveries'::regclass) as queue_rls,
  not has_table_privilege('authenticated','public.push_deliveries','INSERT') as writes_blocked,
  not has_column_privilege('authenticated','public.web_push_subscriptions','user_id','UPDATE') as ownership_protected,
  to_regprocedure('public.register_push_device(text,text,text)') is not null as registration_ready,
  exists(select 1 from pg_trigger where tgrelid='public.notifications'::regclass and tgfoid='private.dispatch_notification_push()'::regprocedure and not tgisinternal) as enqueue_ready;`)
if (!Object.values(verified).every(v => v === true)) throw new Error('Post-deployment database checks failed')
await query(`select cron.alter_job((select jobid from cron.job where jobname='splituai-push-recovery'),active:=true); select private.recover_push_queue();`)
console.log('Production Push updated: anonymous 401, authenticated worker 200, RLS and ownership verified, recovery enabled. No test financial data created.')
