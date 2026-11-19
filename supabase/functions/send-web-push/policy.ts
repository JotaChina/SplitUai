export function deliveryOutcome(status: number | undefined, attempts: number, expires: number, now: number, retryAfterSeconds = 0) {
  if (status === 404 || status === 410) return { status: 'failed', error: 'subscription_revoked', revoke: true }
  const temporary = status === undefined || status === 408 || status === 425 || status === 429 || status >= 500
  if (!temporary) return { status: 'failed', error: 'push_rejected', revoke: false }
  const delay = Math.max(Math.min(3600, 30 * 2 ** (attempts - 1)), Math.min(86400, Math.max(0, retryAfterSeconds)))
  const next = now + delay * 1000
  if (attempts >= 6 || next >= expires) return { status: 'expired', error: 'retry_exhausted', revoke: false }
  return { status: 'pending', error: 'temporary_failure', next_attempt_at: new Date(next).toISOString(), revoke: false }
}

// Only known browser Push services. Never fetch an arbitrary user-controlled URL.
export function allowedEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.(com|org)|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(url.hostname)
  } catch { return false }
}
