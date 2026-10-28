import { execFileSync } from 'node:child_process'
import { createECDH, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

function readEnv(path) {
  const values = new Map()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values.set(match[1], value)
  }
  return values
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const functionEnv = readEnv('supabase/functions/.env')
const webhookSecret = functionEnv.get('PUSH_WEBHOOK_SECRET')
const vapidPublicKey = functionEnv.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = functionEnv.get('VAPID_PRIVATE_KEY')
if (!webhookSecret || webhookSecret.length < 32 || !vapidPublicKey || !vapidPrivateKey || !functionEnv.get('VAPID_SUBJECT')) {
  throw new Error('Configure PUSH_WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT em supabase/functions/.env.')
}
const publicBytes = Buffer.from(vapidPublicKey, 'base64url')
const privateBytes = Buffer.from(vapidPrivateKey, 'base64url')
const ecdh = createECDH('prime256v1')
ecdh.setPrivateKey(privateBytes)
const derivedPublicKey = ecdh.getPublicKey()
if (publicBytes.length !== 65 || privateBytes.length !== 32 || !timingSafeEqual(publicBytes, derivedPublicKey)) {
  throw new Error('O par VAPID local não é válido. Gere outro par antes de testar Push.')
}

const viteEnvPath = '.env.local'
const currentViteEnv = readFileSync(viteEnvPath, 'utf8')
const publicKeyLine = `VITE_VAPID_PUBLIC_KEY=${vapidPublicKey}`
const nextViteEnv = /^VITE_VAPID_PUBLIC_KEY=.*$/m.test(currentViteEnv)
  ? currentViteEnv.replace(/^VITE_VAPID_PUBLIC_KEY=.*$/m, publicKeyLine)
  : `${currentViteEnv.trimEnd()}\n${publicKeyLine}\n`
writeFileSync(viteEnvPath, nextViteEnv)

const sql = `insert into private.push_delivery_settings(singleton, webhook_secret)
values (true, ${sqlLiteral(webhookSecret)})
on conflict (singleton) do update set webhook_secret = excluded.webhook_secret;\n`
execFileSync('docker', [
  'exec', '-i', 'supabase_db_splituai', 'psql', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', 'postgres', '-f', '-',
], { input: sql, stdio: ['pipe', 'ignore', 'pipe'] })

console.log('Push local configurado. Reinicie iniciar-teste-local.bat para carregar a chave no app e iniciar a função.')
