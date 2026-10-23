import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedOrigins = new Set([
  'https://jotachina.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4174',
])

function configuredKey(explicitName: string, injectedName: string) {
  const explicit = Deno.env.get(explicitName)
  if (explicit) return explicit
  try {
    const keys = JSON.parse(Deno.env.get(injectedName) ?? '{}') as Record<string, string>
    return keys.default
  } catch {
    return undefined
  }
}

function response(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get('origin') ?? ''
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return new Response(JSON.stringify(body), { status, headers })
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
  if (origin && !allowedOrigins.has(origin)) return response(req, { error: 'Origem não permitida.' }, 403)

  const authorization = req.headers.get('authorization')
  const apiKey = req.headers.get('apikey')
  const projectUrl = Deno.env.get('SUPABASE_URL')
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? configuredKey('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEYS')
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? configuredKey('SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS')
  if (!authorization?.startsWith('Bearer ') || !apiKey || !projectUrl || !publicKey || !secretKey) {
    return response(req, { error: 'Sessão inválida ou função sem configuração server-side.' }, 401)
  }

  const token = authorization.slice('Bearer '.length)
  const caller = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: authorization, apikey: apiKey } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data: authData, error: authError } = await caller.auth.getUser(token)
  if (authError || !authData.user || !authData.user.email_confirmed_at) {
    return response(req, { error: 'Entre com uma conta autenticada e confirmada para enviar o convite.' }, 401)
  }

  let payload: { group_id?: string; invitation_id?: string }
  try { payload = await req.json() } catch { return response(req, { error: 'Requisição inválida.' }, 400) }
  if (!payload.group_id || !payload.invitation_id) {
    return response(req, { error: 'Informe o grupo e o convite.' }, 400)
  }

  // This RPC validates the active admin against the caller's JWT and takes a
  // two-minute per-invitation lease before any privileged Auth operation.
  const { data: claim, error: claimError } = await caller.rpc('claim_group_invitation_email', {
    p_group_id: payload.group_id,
    p_invitation_id: payload.invitation_id,
  }).maybeSingle()
  if (claimError || !claim) {
    return response(req, { error: claimError?.message ?? 'Convite indisponível para envio.' }, 409)
  }

  const admin = createClient(projectUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const mailer = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const authHost = new URL(projectUrl).hostname
  const isLocalSupabase = ['kong', 'localhost', '127.0.0.1'].includes(authHost)
  const redirectTo = Deno.env.get('INVITATION_REDIRECT_URL')
    ?? (isLocalSupabase ? 'http://127.0.0.1:5173/SplitUai/' : 'https://jotachina.github.io/SplitUai/')
  let sendError: Error | null = null

  try {
    let existingUser = false
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      const users = data.users ?? []
      if (users.some((user) => user.email?.toLowerCase() === claim.invited_email)) {
        existingUser = true
        break
      }
      if (users.length < 1000 || page >= 20) break
    }

    if (existingUser) {
      const { error } = await mailer.auth.signInWithOtp({
        email: claim.invited_email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      })
      if (error) throw error
    } else {
      const { error } = await admin.auth.admin.inviteUserByEmail(claim.invited_email, { redirectTo })
      if (error) throw error
    }
  } catch (error) {
    sendError = error instanceof Error ? error : new Error('Falha ao solicitar o envio de e-mail.')
  }

  const { error: finishError } = await admin.rpc('finish_group_invitation_email', {
    p_invitation_id: payload.invitation_id,
    p_claim_token: claim.claim_token,
    p_sent: !sendError,
  })
  if (sendError) {
    console.error('group invitation email failed', sendError.message)
    return response(req, { error: 'O Supabase Auth não conseguiu enviar o e-mail. Confira a configuração de entrega e tente novamente.' }, 502)
  }
  if (finishError) {
    console.error('group invitation state update failed', finishError.message)
    return response(req, { error: 'O e-mail foi solicitado, mas não foi possível confirmar o estado. Atualize a lista antes de tentar novamente.' }, 500)
  }
  return response(req, { ok: true })
})
