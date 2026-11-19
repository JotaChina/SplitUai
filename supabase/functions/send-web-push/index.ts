import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { allowedEndpoint, deliveryOutcome } from './policy.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-webhook-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  const projectUrl = Deno.env.get('SUPABASE_URL')!
  const hookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET')
  const hook = req.headers.get('x-push-webhook-secret')
  if (!hookSecret || !hook || !constantTimeEqual(hookSecret, hook)) {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return response({ error: 'Unauthorized' }, 401)
    const caller = createClient(projectUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error } = await caller.auth.getUser()
    if (error || !user) return response({ error: 'Unauthorized' }, 401)
    let body
    try { body = await req.json() } catch { return response({ error: 'Invalid payload' }, 400) }
    if (!body || body.action !== 'test' || typeof body.subscription_id !== 'string') return response({ error: 'Invalid test request' }, 400)
    const { data: deliveryId, error: enqueueError } = await caller.rpc('enqueue_push_test', { p_subscription_id: body.subscription_id })
    if (enqueueError) return response({ error: 'Test refused: check device ownership or wait one minute' }, enqueueError.code === 'P0001' ? 429 : 403)
    return response({ delivery_id: deliveryId, status: 'queued', displayed: 'unknown' }, 202)
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return response({ error: 'Push is not configured; jobs remain queued' }, 503)
  const admin = createClient(projectUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  try { webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate) }
  catch { return response({ error: 'Invalid Push configuration; jobs remain queued' }, 503) }
  const { data: jobs, error: claimError } = await admin.rpc('claim_push_deliveries')
  if (claimError) return response({ error: 'Queue unavailable' }, 503)
  let accepted = 0
  await Promise.all((jobs ?? []).map(async (job: { id: string; subscription_id: string; notification_id: string | null; user_id: string; attempts: number; expires_at: string; lease_token: string }) => {
    const { data: sub, error: subError } = await admin.from('web_push_subscriptions').select('id,endpoint,p256dh,auth').eq('id', job.subscription_id).eq('user_id', job.user_id).is('invalidated_at', null).maybeSingle()
    if (subError) return // The lease expires; scheduled recovery retries safely.
    const finish = async (values: Record<string, unknown>) => {
      const { error } = await admin.from('push_deliveries').update({ ...values, lease_until: null, lease_token: null }).eq('id', job.id).eq('lease_token', job.lease_token).eq('status', 'processing')
      if (error) console.error('Push state persistence failed', { delivery_id: job.id })
    }
    if (!sub || !allowedEndpoint(sub.endpoint)) { await finish({ status: 'failed', last_error: 'device_unavailable' }); return }
    let destination = '/SplitUai/?tab=notifications'
    if (job.notification_id) {
      const { data: notification, error } = await admin.from('notifications').select('destination').eq('id', job.notification_id).eq('user_id', job.user_id).maybeSingle()
      if (error) return
      if (!notification) { await finish({ status: 'failed', last_error: 'notification_unavailable' }); return }
      if (notification.destination.startsWith('/SplitUai/') && !notification.destination.startsWith('//')) destination = notification.destination
    }
    try {
      const result = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: 'SplitUai', body: job.notification_id ? 'Você tem uma atualização no SplitUai.' : 'Notificação de teste deste dispositivo.', url: destination, tag: `splituai-${job.id}` }), { TTL: Math.max(0, Math.min(86400, Math.floor((Date.parse(job.expires_at) - Date.now()) / 1000))), timeout: 10_000 })
      await finish({ status: 'accepted', accepted_at: new Date().toISOString(), last_status: result.statusCode, last_error: null })
      await admin.from('web_push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', sub.id).eq('user_id', job.user_id)
      accepted++
    } catch (error) {
      const failure = error as { statusCode?: number; headers?: Record<string, string> }
      const rawRetry = failure.headers?.['retry-after']
      const seconds = rawRetry ? (/^\d+$/.test(rawRetry) ? Number(rawRetry) : (Date.parse(rawRetry) - Date.now()) / 1000) : 0
      const outcome = deliveryOutcome(failure.statusCode, job.attempts, Date.parse(job.expires_at), Date.now(), Number.isFinite(seconds) ? seconds : 0)
      await finish({ status: outcome.status, next_attempt_at: outcome.next_attempt_at ?? new Date().toISOString(), last_status: failure.statusCode ?? null, last_error: outcome.error })
      if (outcome.revoke) {
        await admin.from('web_push_subscriptions').update({ invalidated_at: new Date().toISOString() }).eq('id', sub.id).eq('user_id', job.user_id)
        await admin.from('push_deliveries').update({ status: 'failed', last_error: 'subscription_revoked' }).eq('subscription_id', sub.id).eq('status', 'pending')
      }
      // Do not log exception bodies, endpoints, keys, authorization or private text.
      console.warn('Push attempt failed', { delivery_id: job.id, status: failure.statusCode ?? null, result: outcome.status })
    }
  }))
  return response({ processed: jobs?.length ?? 0, accepted, displayed: 'unknown' })
})

function constantTimeEqual(expected: string, received: string) {
  const a = new TextEncoder().encode(expected), b = new TextEncoder().encode(received)
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
