import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createRecovery } from './notificationRecovery'

const preference = 'splituai-push-disabled'
const supported = () => window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
const keyBytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0))
// Also serializes StrictMode effects, account changes and explicit device actions.
let queue = Promise.resolve()
let signingOutUser: string | undefined
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.then(() => {}, () => {})
  return next
}
async function registration() {
  const result = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (!result?.active) throw new Error('Abra o app novamente para concluir a preparação das notificações.')
  return result
}
export async function detachDevice(client: SupabaseClient, signingOut?: string) {
  if (signingOut) signingOutUser = signingOut
  return serial(async () => {
    if (!supported()) return
    const sub = await (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL))?.pushManager.getSubscription()
    if (!sub) return
    // Unsubscribe first: even a network failure must stop delivery in this browser.
    if (!await sub.unsubscribe()) throw new Error('Não foi possível cancelar a inscrição no navegador. Tente novamente.')
    const { error } = await client.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint)
    if (error) throw new Error('Não foi possível desvincular este dispositivo. Recupere a internet e tente sair novamente.')
  })
}
export function useDevicePush(client: SupabaseClient | null, userId?: string) {
  const [status, setStatus] = useState('Verificando este dispositivo…')
  const [busy, setBusy] = useState(false)
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [delivery, setDelivery] = useState('Nenhum resultado de envio consultado.')
  async function reconcile(active: () => boolean = () => true) {
    if (!client || !userId || signingOutUser === userId || !active()) return
    setSubscriptionId(null)
    if (!supported()) { setStatus('Push indisponível. No iPhone/iPad, instale na Tela de Início e abra por lá. Use HTTPS.'); return }
    const permission = Notification.permission
    if (permission !== 'granted') { setStatus(permission === 'denied' ? 'Permissão bloqueada no navegador. Altere nas configurações do dispositivo.' : 'Permissão ainda não concedida.'); return }
    if (localStorage.getItem(preference) === 'true') {
      const sub = await (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL))?.pushManager.getSubscription()
      if (sub) {
        if (!await sub.unsubscribe()) throw new Error('O cancelamento local está pendente. Tente desativar novamente.')
        const { error } = await client.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint)
        if (error) throw new Error('Push cancelado no navegador; a remoção no servidor não foi confirmada.')
      }
      setStatus('Push desativado por você neste navegador.'); return
    }
    const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!vapid) throw new Error('A chave pública de Push não foi configurada neste ambiente.')
    const reg = await registration()
    let sub = await reg.pushManager.getSubscription()
    if (sub) {
      const { data: saved, error } = await client.from('web_push_subscriptions').select('invalidated_at').eq('endpoint', sub.endpoint).maybeSingle()
      if (error) throw new Error('Não foi possível consultar o vínculo do dispositivo no servidor.')
      if (saved?.invalidated_at) {
        if (!await sub.unsubscribe()) throw new Error('A inscrição foi revogada. Tente ativar novamente.')
        sub = null
      }
    }
    const expected = keyBytes(vapid)
    const actual = sub?.options.applicationServerKey
    if (sub && (sub.expirationTime && sub.expirationTime <= Date.now() || !actual || new Uint8Array(actual).some((b, i) => b !== expected[i]) || actual.byteLength !== expected.length)) {
      if (!await sub.unsubscribe()) throw new Error('Não foi possível renovar a inscrição antiga.')
      sub = null
    }
    if (!active()) return
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected })
    const { data: session } = await client.auth.getSession()
    if (!active() || session.session?.user.id !== userId) return
    const json = sub.toJSON()
    const { data, error } = await client.rpc('register_push_device', { p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth })
    if (error) throw new Error('Inscrição local encontrada, mas o vínculo no servidor não pôde ser confirmado. Verifique a conexão e as migrations.')
    if (active()) { setSubscriptionId(data); setStatus('Permissão concedida · inscrição no navegador e vínculo com sua conta confirmados.') }
    const { data: last, error: lastError } = await client.from('push_deliveries').select('status,attempts,last_status,created_at').eq('subscription_id', data).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (active()) {
      const labels: Record<string, string> = { pending: 'Na fila para envio ou nova tentativa', processing: 'Tentativa em andamento', accepted: 'Aceito pelo serviço Push; exibição e leitura desconhecidas', failed: 'Envio recusado ou dispositivo indisponível', expired: 'Prazo ou tentativas esgotados' }
      setDelivery(lastError ? 'Não foi possível consultar a última tentativa.' : last ? `${labels[last.status] ?? last.status} · ${last.attempts} tentativa(s)${last.last_status ? ` · HTTP ${last.last_status}` : ''}.` : 'Nenhum envio registrado para este dispositivo.')
    }
  }
  useEffect(() => {
    let active = true
    if (!userId) signingOutUser = undefined
    setSubscriptionId(null); setNotice(''); setDelivery('Nenhum resultado de envio consultado.')
    const recovery = createRecovery(async () => {
      try {
        await serial(async () => {
          if (!active) return
          if (!userId) {
            if (supported()) await (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL))?.pushManager.getSubscription().then(s => s?.unsubscribe())
            return
          }
          await reconcile(() => active)
        })
      } catch (error) { if (active) setStatus(error instanceof Error ? error.message : 'Não foi possível verificar o dispositivo.') }
    })
    const visible = () => { if (document.visibilityState === 'visible') recovery.request() }
    recovery.request()
    const interval = window.setInterval(visible, 30_000)
    window.addEventListener('online', recovery.request); window.addEventListener('focus', visible)
    window.addEventListener('storage', recovery.request); document.addEventListener('visibilitychange', visible)
    return () => { active = false; recovery.dispose(); clearInterval(interval); window.removeEventListener('online', recovery.request); window.removeEventListener('focus', visible); window.removeEventListener('storage', recovery.request); document.removeEventListener('visibilitychange', visible) }
  }, [client, userId])
  async function action(kind: 'enable' | 'disable' | 'test') {
    if (!client || !userId || busy) return
    setBusy(true); setNotice('')
    try {
      if (kind === 'enable') {
        if (!supported()) throw new Error('Push indisponível. No iPhone/iPad, abra o app instalado na Tela de Início.')
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
        if (permission !== 'granted') throw new Error('Permissão não concedida. Seus avisos continuam na central.')
        localStorage.removeItem(preference)
        signingOutUser = undefined
        await serial(() => reconcile())
      } else if (kind === 'disable') {
        localStorage.setItem(preference, 'true'); setSubscriptionId(null)
        await detachDevice(client)
        setStatus('Push desativado neste dispositivo. Os avisos continuam na central.')
      } else {
        if (!subscriptionId) throw new Error('Ative e confirme o vínculo deste dispositivo antes do teste.')
        const { data, error } = await client.functions.invoke('send-web-push', { body: { action: 'test', subscription_id: subscriptionId } })
        if (error) throw new Error('Não foi possível solicitar o teste. Aguarde um minuto e verifique a conexão/configuração.')
        setNotice(`Teste registrado (${data.delivery_id}). A fila fará o envio somente a este dispositivo. Isso não confirma exibição ou leitura.`)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'A operação falhou. Tente novamente com internet.') }
    finally { setBusy(false) }
  }
  return { status, busy, notice, subscriptionId, delivery, action }
}
