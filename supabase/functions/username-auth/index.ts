import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedOrigins = new Set([
  'https://jotachina.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://192.168.3.140:5173',
  'https://192.168.3.140:5173',
  'http://127.0.0.1:4174',
])
const genericFailure = 'Não foi possível entrar. Confira seus dados ou tente novamente mais tarde.'
const recoveryMessage = 'Se a conta puder ser recuperada, você receberá instruções no e-mail cadastrado.'

function configuredKey(explicitName: string, injectedName: string) {
  const explicit = Deno.env.get(explicitName)
  if (explicit) return explicit
  try {
    return (JSON.parse(Deno.env.get(injectedName) ?? '{}') as Record<string, string>).default
  } catch {
    return undefined
  }
}

function response(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get('origin') ?? ''
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  if (allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return new Response(JSON.stringify(body), { status, headers })
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeRedirect(value: string | undefined) {
  if (!value) return undefined
  try { return allowedOrigins.has(new URL(value).origin) ? value : undefined } catch { return undefined }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const result = response(req, {})
    result.headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info')
    result.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    result.headers.set('Access-Control-Max-Age', '86400')
    return result
  }
  if (req.method !== 'POST') return response(req, { error: 'Método não permitido.' }, 405)
  const origin = req.headers.get('origin')
  if (origin && !allowedOrigins.has(origin)) return response(req, { error: genericFailure }, 400)

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const publishableKey = configuredKey('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEYS')
  const publicKey = anonKey ?? publishableKey
  const acceptedApiKeys = [anonKey, publishableKey].filter((key): key is string => Boolean(key))
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? configuredKey('SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS')
  if (!projectUrl || !publicKey || !secretKey || !acceptedApiKeys.includes(req.headers.get('apikey') ?? '')) {
    return response(req, { error: genericFailure }, 503)
  }

  let payload: { action?: string; identifier?: string; password?: string; redirect_to?: string }
  try { payload = await req.json() } catch { return response(req, { error: genericFailure }, 400) }
  const action = payload.action
  const rawIdentifier = payload.identifier?.trim() ?? ''
  if (!['sign_in', 'recover'].includes(action ?? '') || !rawIdentifier || rawIdentifier.length > 320) {
    return response(req, { error: genericFailure }, 400)
  }
  if (action === 'sign_in' && (!payload.password || payload.password.length > 1024)) {
    return response(req, { error: genericFailure }, 400)
  }

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawIdentifier)
  const username = rawIdentifier.replace(/^@/, '').toLowerCase()
  if (!isEmail && !/^[a-z0-9_]{3,24}$/.test(username)) return response(req, { error: genericFailure }, 401)

  const admin = createClient(projectUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  const auth = createClient(projectUrl, publicKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('cf-connecting-ip')?.trim()
    ?? 'unknown'
  const identifierKey = await hash(`splituai:${isEmail ? rawIdentifier.toLowerCase() : username}`)
  const addressKey = await hash(`splituai-ip:${forwarded}`)
  const [identifierLimit, addressLimit] = await Promise.all([
    admin.rpc('server_consume_login_attempt', { p_key_hash: identifierKey, p_limit: 8 }),
    admin.rpc('server_consume_login_attempt', { p_key_hash: addressKey, p_limit: 40 }),
  ])
  if (identifierLimit.error || addressLimit.error || identifierLimit.data !== true || addressLimit.data !== true) {
    return response(req, { error: action === 'recover' ? recoveryMessage : genericFailure }, action === 'recover' ? 200 : 429)
  }

  let email = isEmail ? rawIdentifier.toLowerCase() : null
  if (!email) {
    const { data, error } = await admin.rpc('server_resolve_login_username', { p_username: username })
    if (!error && typeof data === 'string') email = data
  }
  if (action === 'recover') {
    // Call Auth even when the identifier did not resolve; Auth suppresses
    // delivery for unknown addresses, keeping the public response uniform.
    const recoveryEmail = email ?? `${username}@invalid.invalid`
    await auth.auth.resetPasswordForEmail(recoveryEmail, { redirectTo: safeRedirect(payload.redirect_to) })
    return response(req, { message: recoveryMessage })
  }
  // Use the same Auth password-verification path for unknown usernames so the
  // response does not become a quick username-existence oracle.
  const authEmail = email ?? `${username}@invalid.invalid`
  const { data, error } = await auth.auth.signInWithPassword({ email: authEmail, password: payload.password! })
  if (error || !data.session) return response(req, { error: genericFailure }, 401)
  return response(req, {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
    },
  })
})
