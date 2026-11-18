import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listMyFriendships, manageFriendship, type FriendshipView } from '../lib/friendships'

type FriendshipAction = 'send' | 'accept' | 'decline' | 'cancel'

function errorMessage(reason: unknown) {
  return reason && typeof reason === 'object' && 'message' in reason
    ? String(reason.message)
    : 'Não foi possível consultar ou atualizar a amizade. Tente novamente.'
}

// The parent keys this component by viewer and target to isolate profile state.
export function ProfileFriendshipActions({ client, userId, hasUsername }: {
  client: SupabaseClient
  userId: string
  hasUsername: boolean
}) {
  const [relationship, setRelationship] = useState<FriendshipView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const active = useRef(false)
  const inFlight = useRef(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listMyFriendships(client)
      if (active.current) setRelationship(rows.find((row) => row.other_user_id === userId) ?? null)
    } catch (reason) {
      if (active.current) setError(errorMessage(reason))
    } finally {
      if (active.current) setLoading(false)
    }
  }

  useEffect(() => {
    active.current = true
    void refresh()
    return () => { active.current = false }
  }, [client, userId])

  async function action(kind: FriendshipAction) {
    if (inFlight.current || loading || error) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    try {
      await manageFriendship(client, userId, kind)
      if (!active.current) return
      setNotice(kind === 'send' ? 'Convite de amizade enviado.'
        : kind === 'accept' ? 'Amizade aceita.'
          : kind === 'decline' ? 'Convite de amizade recusado.' : 'Convite de amizade cancelado.')
      await refresh()
    } catch (reason) {
      if (active.current) setError(errorMessage(reason))
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }

  return <section className="settlement-panel profile-friendship" aria-label="Amizade" aria-busy={loading || busy}>
    <h2>Amizade</h2>
    {notice && <p className="auth-message" role="status">{notice}</p>}
    {loading ? <p role="status">Carregando amizade...</p> : error ? <>
      <p className="auth-error" role="alert">{error}</p>
      <button className="button button-light" type="button" disabled={busy} onClick={() => void refresh()}>Tentar novamente</button>
    </> : <div className="profile-friendship-actions">
      {!relationship && (hasUsername
        ? <button className="button button-dark" type="button" disabled={busy} onClick={() => void action('send')}>Enviar convite de amizade</button>
        : <p>Esta pessoa precisa definir um identificador público para receber convites de amizade.</p>)}
      {relationship?.status === 'accepted' && <span className="role-badge" role="status">Vocês já são amigos</span>}
      {relationship?.status === 'pending' && relationship.direction === 'outgoing' && <>
        <span className="invite-status status-pending">Convite enviado · aguardando resposta</span>
        <button className="button button-light" type="button" disabled={busy} onClick={() => void action('cancel')}>Cancelar convite</button>
      </>}
      {relationship?.status === 'pending' && relationship.direction === 'incoming' && <>
        <span className="invite-status status-pending">Convite de amizade recebido</span>
        <button className="button button-dark" type="button" disabled={busy} onClick={() => void action('accept')}>Aceitar convite</button>
        <button className="button button-light" type="button" disabled={busy} onClick={() => void action('decline')}>Recusar convite</button>
      </>}
      {busy && <span role="status">Atualizando amizade...</span>}
    </div>}
  </section>
}
