import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-webhook-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  const projectUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return response({ error: 'Push is not configured' }, 503)

  const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let notificationId: string | undefined
  const hookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET')
  const providedHookSecret = req.headers.get('x-push-webhook-secret')
  if (hookSecret && providedHookSecret && constantTimeEqual(hookSecret, providedHookSecret)) {
    try { const payload = await req.json(); notificationId = payload.record?.id ?? payload.id } catch { return response({ error: 'Invalid webhook payload' }, 400) }
  } else {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return response({ error: 'Unauthorized' }, 401)
    const caller = createClient(projectUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: authError } = await caller.auth.getUser()
    if (authError || !user) return response({ error: 'Unauthorized' }, 401)
    try { const payload = await req.json(); notificationId = payload.notification_id } catch { return response({ error: 'Invalid payload' }, 400) }
    const { data: notification } = await caller.from('notifications').select('id').eq('id', notificationId).maybeSingle()
    if (!notification) return response({ error: 'Notification not found' }, 404)
  }
  if (!notificationId) return response({ error: 'Notification id required' }, 400)

  const { data: notification, error } = await admin.from('notifications').select('id,user_id,title,message,destination,created_at').eq('id', notificationId).maybeSingle()
  if (error || !notification) return response({ error: 'Notification not found' }, 404)
  const { data: subscriptions } = await admin.from('web_push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', notification.user_id)
  if (!subscriptions?.length) return response({ sent: 0, revoked: 0 })

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  let sent = 0, revoked = 0
  const payload = JSON.stringify({ title: 'SplitUai', body: 'Você tem uma atualização no SplitUai.', url: notification.destination, tag: `splituai-${notification.id}` })
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 86400 })
      await admin.from('web_push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', subscription.id)
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await admin.from('web_push_subscriptions').delete().eq('id', subscription.id)
        revoked++
      } else console.error('Web Push delivery failed', status ?? 'unknown')
    }
  }
  return response({ sent, revoked })
})

function constantTimeEqual(expected: string, received: string) {
  const a = new TextEncoder().encode(expected), b = new TextEncoder().encode(received)
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
