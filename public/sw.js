/* SplitUai Web Push service worker. Published under /SplitUai/. */
const notificationLogo = '/SplitUai/brand/splituai-graffiti.png'
function safeDestination(value) {
  try {
    const url = new URL(value || '/SplitUai/', self.location.origin)
    if (url.origin === self.location.origin && url.pathname.startsWith('/SplitUai/')) return url.href
  } catch { /* Use app root for invalid destinations. */ }
  return new URL('/SplitUai/', self.location.origin).href
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('splituai-shell-') && key !== 'splituai-shell-v1').map((key) => caches.delete(key)))),
  ]))
})

// Keep a network-first copy of the app shell and static files so Chrome can
// treat this as an installable app and previously visited pages can open offline.
// Never cache Supabase/API traffic or cross-origin requests.
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.get('upgrade') === 'websocket') return
  if (/\/(?:auth|rest|functions|storage|graphql|realtime)\/v1\//.test(url.pathname)) return

  event.respondWith((async () => {
    const cache = await caches.open('splituai-shell-v1')
    try {
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
      return response
    } catch {
      const cached = await cache.match(request)
      if (cached) return cached
      if (request.mode === 'navigate') {
        const appRoot = new URL('./', self.location.href)
        const shell = await cache.match(appRoot.href)
        if (shell) return shell
      }
      return Response.error()
    }
  })())
})

self.addEventListener('push', (event) => {
  let payload = { title: 'SplitUai', body: 'Você tem uma atualização no SplitUai.', url: '/SplitUai/' }
  try { if (event.data) payload = { ...payload, ...event.data.json() } } catch { /* Keep the generic fallback. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'SplitUai', {
    body: payload.body || 'Você tem uma atualização no SplitUai.',
    icon: notificationLogo,
    image: notificationLogo,
    badge: '/SplitUai/notification-badge.png',
    data: { url: safeDestination(payload.url) },
    tag: payload.tag || undefined,
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destination = safeDestination(event.notification.data?.url)
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith('/SplitUai/'))
    if (existing) return existing.navigate(destination).then(() => existing.focus())
    return self.clients.openWindow(destination)
  }))
})
