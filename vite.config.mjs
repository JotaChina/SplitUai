import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const lanIp = process.env.SPLITUAI_LAN_IP || '127.0.0.1'
const httpsEnabled = process.env.SPLITUAI_LOCAL_HTTPS === '1'
const localCertDir = resolve('.local-dev/certs')
const supabaseProxy = {
  target: 'http://127.0.0.1:54321',
  changeOrigin: true,
}

export default defineConfig({
  plugins: [react()],
  base: '/SplitUai/',
  server: {
    host: lanIp,
    strictPort: true,
    allowedHosts: [lanIp],
    ...(httpsEnabled
      ? {
          https: {
            cert: readFileSync(resolve(localCertDir, 'server-cert.pem')),
            key: readFileSync(resolve(localCertDir, 'server-key.pem')),
          },
        }
      : {}),
    proxy: {
      '/auth/v1': supabaseProxy,
      '/rest/v1': supabaseProxy,
      '/functions/v1': supabaseProxy,
      '/storage/v1': supabaseProxy,
      '/graphql/v1': supabaseProxy,
      '/realtime/v1': { ...supabaseProxy, ws: true },
    },
  },
})
