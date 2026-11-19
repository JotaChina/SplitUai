import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'

function load(path, globals = {}, dependencies = {}) {
  const source = readFileSync(path, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/SplitUai/'").replaceAll('import.meta.env.VITE_VAPID_PUBLIC_KEY', "'AQID'")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => dependencies[name], console, setTimeout, clearTimeout, clearInterval, Uint8Array, URL, Date, atob, ...globals }, { filename: path })
  return exports
}
const { createRecovery } = load('src/lib/notificationRecovery.ts')
const { deliveryOutcome, allowedEndpoint } = load('supabase/functions/send-web-push/policy.ts')
const tick = () => new Promise(resolve => setTimeout(resolve, 15))

test('Recovery coalesces reconnect bursts and preserves a trailing refresh', async () => {
  let calls = 0, release
  const recovery = createRecovery(async () => { calls++; if (calls === 1) await new Promise(r => { release = r }) }, 0)
  recovery.request(); recovery.request(); recovery.request(); await tick()
  assert.equal(calls, 1)
  recovery.request(); recovery.request(); await tick(); assert.equal(calls, 1)
  release(); await tick(); assert.equal(calls, 2)
  recovery.dispose(); recovery.request(); await tick(); assert.equal(calls, 2)
})
test('Recovery cleanup cancels scheduled work', async () => {
  let calls = 0
  const recovery = createRecovery(async () => { calls++ }, 0)
  recovery.request(); recovery.dispose(); await tick(); assert.equal(calls, 0)
})
for (const status of [undefined, 408, 425, 429, 500, 503]) test(`Temporary failure ${status} retries with increasing delay`, () => {
  const first = deliveryOutcome(status, 1, 86400000, 0)
  const second = deliveryOutcome(status, 2, 86400000, 0)
  assert.equal(first.status, 'pending'); assert.equal(Date.parse(first.next_attempt_at), 30000)
  assert.equal(Date.parse(second.next_attempt_at), 60000)
})
test('Retry-After, expiry and attempt limits are honored', () => {
  assert.equal(Date.parse(deliveryOutcome(429, 1, 86400000, 0, 120).next_attempt_at), 120000)
  assert.equal(deliveryOutcome(503, 6, 86400000, 0).status, 'expired')
  assert.equal(deliveryOutcome(503, 1, 10000, 0).status, 'expired')
})
test('Revoked subscriptions are invalidated; authentication errors are not retried', () => {
  for (const status of [404, 410]) assert.equal(deliveryOutcome(status, 1, 86400000, 0).revoke, true)
  for (const status of [400, 401, 403, 413]) assert.equal(deliveryOutcome(status, 1, 86400000, 0).status, 'failed')
})
test('Push URLs reject arbitrary services and private network targets', () => {
  assert.equal(allowedEndpoint('https://fcm.googleapis.com/fcm/send/test'), true)
  for (const url of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x']) assert.equal(allowedEndpoint(url), false)
})

function hooks() {
  const states = [], effects = [], deps = []
  let cursor = 0
  return {
    react: {
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
      useEffect(effect, values) { const i = cursor++; if (!deps[i] || values.some((v, n) => v !== deps[i][n])) { effects[i]?.(); deps[i] = values; effects[i] = effect() } },
    },
    render(work) { cursor = 0; return work() },
    cleanup() { for (const effect of effects) effect?.() },
  }
}
function device({ existing = true, disabled = false, permission = 'granted', wrongKey = false, invalidated = false } = {}) {
  const h = hooks(), storage = new Map(disabled ? [['splituai-push-disabled', 'true']] : [])
  const window = new EventTarget(), document = new EventTarget()
  Object.assign(window, { isSecureContext: true, Notification: true, PushManager: true, setInterval, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) })
  document.visibilityState = 'visible'
  let currentUser = 'A', registered = [], requests = 0, subscribes = 0, unsubscribes = 0
  const makeSub = () => ({ endpoint: 'https://fcm.googleapis.com/test', options: { applicationServerKey: new Uint8Array(wrongKey ? [4, 5, 6] : [1, 2, 3]).buffer }, toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: async () => { unsubscribes++; sub = null; return true } })
  let sub = existing ? makeSub() : null
  const reg = { active: true, pushManager: { getSubscription: async () => sub, subscribe: async () => { subscribes++; wrongKey = false; sub = makeSub(); return sub } } }
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: currentUser } } } }) },
    from(table) { const query = { select() { return query }, eq() { return query }, order() { return query }, limit() { return query }, delete() { return query }, then(resolve) { return Promise.resolve({ error: null }).then(resolve) }, async maybeSingle() { return { data: table === 'web_push_subscriptions' && invalidated ? { invalidated_at: 'now' } : null, error: null } } }; return query },
    rpc: async (_name, args) => { registered.push({ user: currentUser, args }); return { data: 'device-id', error: null } },
  }
  const api = load('src/lib/useDevicePush.ts', { window, document, navigator: { serviceWorker: { getRegistration: async () => reg } }, Notification: { permission, requestPermission: async () => { requests++; return 'granted' } }, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) } }, { react: h.react, './notificationRecovery': { createRecovery: work => createRecovery(work, 0) } })
  return { render: () => h.render(() => api.useDevicePush(client, currentUser)), cleanup: h.cleanup, switchAccount: id => { currentUser = id }, counts: () => ({ registered, requests, subscribes, unsubscribes }), window, document }
}
for (const existing of [true, false]) test(`Authorized device reconciles ${existing ? 'existing' : 'missing'} subscription without permission prompt`, async () => {
  const d = device({ existing }); try { d.render(); await tick(); const state = d.render(); assert.equal(state.subscriptionId, 'device-id'); assert.equal(d.counts().requests, 0); assert.equal(d.counts().subscribes, existing ? 0 : 1) } finally { d.cleanup() }
})
test('Voluntary disable and denied permission do not re-enable Push', async () => {
  for (const options of [{ disabled: true }, { permission: 'denied' }]) {
    const d = device(options); try { d.render(); await tick(); assert.equal(d.render().subscriptionId, null); assert.equal(d.counts().registered.length, 0); assert.equal(d.counts().subscribes, 0) } finally { d.cleanup() }
  }
})
for (const options of [{ wrongKey: true }, { invalidated: true }]) test(`Unusable subscription is renewed (${JSON.stringify(options)})`, async () => {
  const d = device(options); try { d.render(); await tick(); assert.equal(d.counts().unsubscribes, 1); assert.equal(d.counts().subscribes, 1); assert.equal(d.render().subscriptionId, 'device-id') } finally { d.cleanup() }
})
test('Account switch reconciles to the new authenticated owner', async () => {
  const d = device(); try { d.render(); await tick(); d.switchAccount('B'); d.render(); await tick(); assert.equal(d.counts().registered.at(-1).user, 'B'); assert.equal(d.counts().requests, 0) } finally { d.cleanup() }
})
test('Online and foreground recovery rerun device verification', async () => {
  const d = device(); try { d.render(); await tick(); const before = d.counts().registered.length; d.window.dispatchEvent(new Event('online')); d.document.dispatchEvent(new Event('visibilitychange')); await tick(); assert.equal(d.counts().registered.length, before + 1) } finally { d.cleanup() }
})

test('Service worker preserves destinations and rejects cross-origin navigation', async () => {
  const listeners = {}, shown = [], opened = []
  const self = { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { listeners[name] = fn }, registration: { showNotification: async (_title, options) => shown.push(options) }, clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL })
  for (const destination of ['/SplitUai/?tab=friends', 'https://evil.example/']) {
    let completion
    listeners.push({ data: { json: () => ({ url: destination, tag: 'stable-job-id' }) }, waitUntil: p => { completion = p } }); await completion
    listeners.notificationclick({ notification: { data: shown.at(-1).data, close() {} }, waitUntil: p => { completion = p } }); await completion
  }
  assert.equal(opened[0], 'https://example.test/SplitUai/?tab=friends'); assert.equal(opened[1], 'https://example.test/SplitUai/')
  assert.equal(shown[0].tag, shown[1].tag)
})

test('Inbox recovers missed events on reconnect/foreground and keeps data on query errors', async () => {
  const h = hooks(), window = new EventTarget(), document = new EventTarget()
  Object.assign(window, { setInterval }); document.visibilityState = 'visible'
  let rowCount = 1, fail = false, channels = 0, removed = 0, queries = 0, subscriptionCallback
  const client = {
    from() { let count = false; const query = { select(_columns, options) { count = Boolean(options?.head); return query }, eq() { return query }, is() { return query }, order() { return query }, limit() { return query }, then(resolve) { queries++; return Promise.resolve(fail ? { error: { message: 'offline' } } : { data: count ? null : Array.from({ length: rowCount }, (_, i) => ({ id: String(i), read_at: null })), count: rowCount }).then(resolve) } }; return query },
    channel() { channels++; const channel = { on() { return channel }, subscribe(callback) { subscriptionCallback = callback; return channel } }; return channel },
    removeChannel: async () => { removed++ },
  }
  const { useNotifications } = load('src/lib/useNotifications.ts', { window, document }, { react: h.react, './notificationRecovery': { createRecovery: work => createRecovery(work, 0) } })
  const render = () => h.render(() => useNotifications(client, 'A'))
  try {
    render(); await tick(); assert.equal(render().unread, 1)
    rowCount = 2; window.dispatchEvent(new Event('online')); subscriptionCallback('SUBSCRIBED'); document.dispatchEvent(new Event('visibilitychange')); await tick()
    assert.equal(render().rows.length, 2); assert.equal(render().unread, 2); assert.equal(channels, 1)
    fail = true; window.dispatchEvent(new Event('online')); await tick()
    assert.equal(render().unread, 2); assert.equal(render().rows.length, 2); assert.match(render().error, /últimos dados/)
    fail = false; rowCount = 3; subscriptionCallback('SUBSCRIBED'); await tick(); assert.equal(render().unread, 3); assert.equal(render().error, '')
  } finally { h.cleanup() }
  const after = queries; window.dispatchEvent(new Event('online')); await tick(); assert.equal(queries, after); assert.equal(removed, 1)
})

test('Inbox first-load failure never claims an empty successful result', async () => {
  const h = hooks(), window = new EventTarget(), document = new EventTarget(); Object.assign(window, { setInterval })
  const client = { from() { const q = { select() { return q }, eq() { return q }, is() { return q }, order() { return q }, limit() { return q }, then(resolve) { return Promise.resolve({ error: {} }).then(resolve) } }; return q }, channel() { const q = { on() { return q }, subscribe() { return q } }; return q }, removeChannel: async () => {} }
  const { useNotifications } = load('src/lib/useNotifications.ts', { window, document }, { react: h.react, './notificationRecovery': { createRecovery: work => createRecovery(work, 0) } })
  try { h.render(() => useNotifications(client, 'A')); await tick(); const state = h.render(() => useNotifications(client, 'A')); assert.equal(state.unread, null); assert.equal(state.loaded, false); assert.ok(state.error) } finally { h.cleanup() }
})

function edge({ authenticated = true, rateLimited = false, failure, configured = true } = {}) {
  let handler, sends = 0
  const updates = [], rpcCalls = []
  const job = { id: 'job', subscription_id: 'device', notification_id: 'notice', user_id: 'A', attempts: 1, expires_at: new Date(Date.now() + 86400000).toISOString(), lease_token: 'lease' }
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'A' } : null } }) },
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return name === 'claim_push_deliveries' ? { data: [job], error: null } : rateLimited ? { error: { code: 'P0001' } } : { data: 'test-job', error: null } },
    from(table) {
      let patch
      const q = { select() { return q }, eq() { return q }, is() { return q }, update(values) { patch = values; updates.push({ table, values }); return q }, async maybeSingle() { return { data: table === 'notifications' ? { destination: '/SplitUai/?tab=friends' } : { id: 'device', endpoint: 'https://fcm.googleapis.com/test', p256dh: 'key', auth: 'auth' }, error: null } }, then(resolve) { return Promise.resolve({ error: null, data: patch }).then(resolve) } }
      return q
    },
  }
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'dummy-anon', SUPABASE_SERVICE_ROLE_KEY: 'dummy-service', PUSH_WEBHOOK_SECRET: 'dummy-hook', ...(configured ? { VAPID_PUBLIC_KEY: 'dummy-public', VAPID_PRIVATE_KEY: 'dummy-private', VAPID_SUBJECT: 'mailto:test@example.test' } : {}) }
  load('supabase/functions/send-web-push/index.ts', { Request, Response, TextEncoder, Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } }, console: { warn() {}, error() {} } }, {
    'npm:@supabase/supabase-js@2': { createClient: () => client },
    'npm:web-push@3.6.7': { default: { setVapidDetails() {}, async sendNotification() { sends++; if (failure) throw failure; return { statusCode: 202 } } } },
    './policy.ts': { deliveryOutcome, allowedEndpoint },
  })
  return { call: (body, headers = {}) => handler(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })), updates, rpcCalls, sends: () => sends }
}
test('Edge test requires a valid session and refuses arbitrary replay payloads', async () => {
  const anonymous = edge({ authenticated: false }); assert.equal((await anonymous.call({ action: 'test', subscription_id: 'device' }, { Authorization: 'Bearer dummy' })).status, 401); assert.equal(anonymous.rpcCalls.length, 0)
  const authenticated = edge(); assert.equal((await authenticated.call({ notification_id: 'arbitrary' }, { Authorization: 'Bearer dummy' })).status, 400)
})
test('Edge test queues only the requested device and reports queued rather than displayed', async () => {
  const e = edge(); const result = await e.call({ action: 'test', subscription_id: 'device' }, { Authorization: 'Bearer dummy' })
  assert.equal(result.status, 202); assert.equal((await result.json()).displayed, 'unknown'); assert.equal(e.rpcCalls[0].args.p_subscription_id, 'device'); assert.equal(e.sends(), 0)
})
test('Edge preserves persistent test rate limit rejection', async () => {
  const e = edge({ rateLimited: true }); assert.equal((await e.call({ action: 'test', subscription_id: 'device' }, { Authorization: 'Bearer dummy' })).status, 429)
})
test('Worker configuration failure leaves jobs unclaimed', async () => {
  const e = edge({ configured: false }); assert.equal((await e.call({}, { 'x-push-webhook-secret': 'dummy-hook' })).status, 503); assert.equal(e.rpcCalls.length, 0)
})
test('Worker persists accepted service status without claiming display confirmation', async () => {
  const e = edge(); const result = await e.call({}, { 'x-push-webhook-secret': 'dummy-hook' }); assert.equal((await result.json()).displayed, 'unknown'); assert.equal(e.sends(), 1)
  const finish = e.updates.find(u => u.table === 'push_deliveries').values; assert.equal(finish.status, 'accepted'); assert.equal(finish.last_status, 202); assert.equal(finish.lease_token, null)
})
for (const statusCode of [503, 410]) test(`Worker handles service ${statusCode} through persistent state`, async () => {
  const e = edge({ failure: { statusCode } }); await e.call({}, { 'x-push-webhook-secret': 'dummy-hook' })
  const finish = e.updates.find(u => u.table === 'push_deliveries').values; assert.equal(finish.status, statusCode === 503 ? 'pending' : 'failed')
  if (statusCode === 410) assert.ok(e.updates.find(u => u.table === 'web_push_subscriptions' && u.values.invalidated_at))
  else assert.ok(Date.parse(finish.next_attempt_at) > Date.now())
})
