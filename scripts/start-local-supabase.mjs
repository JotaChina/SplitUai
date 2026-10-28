import { execSync } from 'node:child_process'

const network = process.argv[2]
if (!network || !/^[a-z0-9_-]+$/.test(network)) {
  console.error('Nome de rede Docker local invalido.')
  process.exit(2)
}

function redact(text) {
  return text
    .replace(/"(DB_URL|PUBLISHABLE_KEY|SECRET_KEY|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/postgresql:\/\/postgres:[^@\s]+@/g, 'postgresql://postgres:[redacted]@')
}

try {
  execSync(`npx --no-install supabase start --network-id ${network}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  console.log('Supabase local iniciado.')
} catch (error) {
  const details = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
  if (details) console.error(redact(details))
  process.exitCode = error.status ?? 1
}
