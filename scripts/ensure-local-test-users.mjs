import { execFileSync, execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const statusOutput = execSync('npx --no-install supabase status --output json', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const jsonMatch = statusOutput.match(/\{[\s\S]*\}/)
if (!jsonMatch) throw new Error('O Supabase local nao retornou status em JSON.')

const status = JSON.parse(jsonMatch[0])
const apiUrl = status.API_URL
const serviceKey = status.SERVICE_ROLE_KEY
if (!apiUrl || !serviceKey) throw new Error('URL ou chave admin local indisponivel.')
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(apiUrl).hostname)) {
  throw new Error('Recusando preparar contas: o Supabase nao parece ser local.')
}

const dbContainer = 'supabase_db_splituai'
const accounts = [
  { email: 'teste@example.test', username: 'teste', name: 'Usuario de teste', password: 'SplitUaiLocalTeste!2026' },
  { email: 'teste2@example.test', username: 'teste2', name: 'Usuario de teste 2', password: 'SplitUaiLocalTeste2!2026' },
  { email: 'teste3@example.test', username: 'teste3', name: 'Usuario de teste 3', password: 'SplitUaiLocalTeste3!2026' },
]
const admin = createClient(apiUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function addBootstrapInvite(email) {
  const sql = `insert into public.bootstrap_invites (email, expires_at, consumed_at) values ('${email}', now() + interval '1 year', null) on conflict (email) do update set expires_at = excluded.expires_at, consumed_at = null;`
  execFileSync('docker', [
    'exec', dbContainer, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', sql,
  ], { stdio: 'ignore' })
}

async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < 1000) return null
  }
  throw new Error('Busca de usuarios excedeu o limite de paginas.')
}

for (const account of accounts) {
  let user = await findUser(account.email)
  if (!user) {
    addBootstrapInvite(account.email)
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { name: account.name },
    })
    if (error) throw error
    user = data.user
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: account.password,
      email_confirm: true,
      user_metadata: { name: account.name },
    })
    if (error) throw error
  }

  const { error: profileError } = await admin.from('profiles')
    .update({ username: account.username, display_name: account.name })
    .eq('id', user.id)
  if (profileError) throw profileError
  console.log(`Conta local pronta: @${account.username} (${account.email})`)
}
