import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createRecovery } from './notificationRecovery'

export type InboxRow = { id: string; title: string; message: string; destination: string; created_at: string; read_at: string | null }
export function useNotifications(client: SupabaseClient | null, userId?: string) {
  const [state, setState] = useState<{ owner?: string; rows: InboxRow[]; unread: number | null; error: string; loaded: boolean }>({ rows: [], unread: null, error: '', loaded: false })
  useEffect(() => {
    setState({ owner: userId, rows: [], unread: null, error: '', loaded: false })
    if (!client || !userId) return
    let active = true
    const recovery = createRecovery(async () => {
      try {
        const [inbox, count] = await Promise.all([
          client.from('notifications').select('id,title,message,destination,created_at,read_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
          client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
        ])
        if (inbox.error || count.error) throw new Error('query failed')
        if (active) setState({ owner: userId, rows: inbox.data ?? [], unread: count.count, error: '', loaded: true })
      } catch {
        if (active) setState(s => ({ ...s, error: 'Não foi possível atualizar os avisos. Os últimos dados foram mantidos; tentaremos novamente.' }))
      }
    })
    const visible = () => { if (document.visibilityState === 'visible') recovery.request() }
    const channel = client.channel(`inbox:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, recovery.request)
      .subscribe(status => { if (status === 'SUBSCRIBED') recovery.request() })
    window.addEventListener('online', recovery.request)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('splituai-inbox-refresh', recovery.request)
    const interval = window.setInterval(visible, 60_000)
    recovery.request()
    return () => {
      active = false; recovery.dispose(); clearInterval(interval)
      window.removeEventListener('online', recovery.request); window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('splituai-inbox-refresh', recovery.request)
      void client.removeChannel(channel)
    }
  }, [client, userId])
  return state.owner === userId ? state : { rows: [], unread: null, error: '', loaded: false }
}
