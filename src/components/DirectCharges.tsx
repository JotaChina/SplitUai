import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listMyFriendships, type FriendshipView } from '../lib/friendships'
import { formatBrlCents, parseBrlCents } from '../lib/expenses'
import { availableChargeActions, chargeActionLabels, chargeError, chargeStatusLabels, createDirectCharge, directChargeAmount, listDirectCharges, manageDirectCharge, receiptUrl, uploadChargeReceipt, type ChargeAction, type ChargeEvent, type DirectCharge } from '../lib/directCharges'
import './directCharges.css'

export function DirectCharges({ client, userId, initialFriendId, targetId }: {
  client: SupabaseClient; userId: string; initialFriendId?: string; targetId?: string | null
}) {
  const [rows, setRows] = useState<DirectCharge[]>([])
  const [friends, setFriends] = useState<FriendshipView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(Boolean(initialFriendId))
  const [friendId, setFriendId] = useState(initialFriendId ?? '')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [split, setSplit] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [filter, setFilter] = useState<'pay' | 'receive' | 'history'>(targetId ? 'history' : 'pay')
  const requestId = useRef(crypto.randomUUID())
  const inFlight = useRef(false)
  const active = useRef(true)
  const version = useRef(0)

  async function refresh() {
    const current = ++version.current
    try {
      const [charges, friendships] = await Promise.all([listDirectCharges(client), listMyFriendships(client)])
      if (!active.current || current !== version.current) return
      setRows(charges); setFriends(friendships.filter(f => f.status === 'accepted')); setLoadError('')
    } catch (reason) { if (active.current && current === version.current) setLoadError(chargeError(reason)) }
    finally { if (active.current && current === version.current) setLoading(false) }
  }

  useEffect(() => {
    active.current = true
    void refresh()
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    const channel = client.channel(`direct-charges:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'direct_charges' }, () => void refresh()).subscribe()
    const timer = window.setInterval(visible, 30000)
    window.addEventListener('focus', visible); window.addEventListener('online', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active.current = false; ++version.current; clearInterval(timer); void client.removeChannel(channel)
      window.removeEventListener('focus', visible); window.removeEventListener('online', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [client, userId])

  useEffect(() => {
    if (!loading && targetId) document.getElementById(`charge-${targetId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [loading, targetId, rows.length])

  // A retry after a lost response reuses the same ID for the same form values.
  function changeForm(change: () => void) { requestId.current = crypto.randomUUID(); change() }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await createDirectCharge(client, { id: requestId.current, friendId, description, cents: parseBrlCents(amount), split, dueDate })
      setNotice('Cobrança enviada. A outra pessoa poderá reconhecer ou contestar o valor.')
      setDescription(''); setAmount(''); setDueDate(''); setShowForm(false); setFilter('receive'); requestId.current = crypto.randomUUID()
      await refresh()
    } catch (reason) { setError(chargeError(reason)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const open = rows.filter(r => r.status !== 'paid' && r.status !== 'cancelled')
  const confirmed = open.filter(r => r.status === 'accepted' || r.status === 'payment_reported')
  const total = (creditor: boolean) => confirmed.filter(r => (r.creditor_id === userId) === creditor).reduce((sum, r) => sum + r.amount_cents, 0)
  const displayed = filter === 'history' ? rows : open.filter(r => filter === 'receive' ? r.creditor_id === userId : r.debtor_id === userId)
  let preview = 0
  try { preview = directChargeAmount(parseBrlCents(amount), split) } catch { /* Form validates on submit. */ }
  return <section className="page-wrap direct-charges" aria-busy={loading}>
    <div className="page-heading"><div><div className="eyebrow">SEM GRUPO</div><h1>Entre amigos<span className="heading-dot">.</span></h1><p>Cobranças diretas entre amizades aceitas.</p></div><button type="button" className="button button-dark" onClick={() => setShowForm(v => !v)}>{showForm ? 'Fechar formulário' : 'Criar cobrança'}</button></div>
    <p className="form-note">Reconheça o valor antes de informar o pagamento. A quitação depende da confirmação de quem recebe. O pagamento é feito pelo seu banco.</p>
    <div className="charge-summary"><article className="settlement-panel"><small>A RECEBER · RECONHECIDAS</small><strong>{loading || loadError ? '—' : formatBrlCents(total(true))}</strong></article><article className="settlement-panel"><small>A PAGAR · RECONHECIDAS</small><strong>{loading || loadError ? '—' : formatBrlCents(total(false))}</strong></article></div>
    {loadError && <p className="auth-error" role="alert">{loadError} <button type="button" className="text-button" onClick={() => void refresh()}>Tentar novamente</button></p>}
    {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}
    {showForm && <form className="charge-form settlement-panel" onSubmit={e => void create(e)}><h2>Nova cobrança</h2>
      <label>Amizade<select required disabled={busy || loading} value={friendId} onChange={e => changeForm(() => setFriendId(e.target.value))}><option value="">Selecione uma amizade aceita</option>{friends.map(f => <option key={f.other_user_id} value={f.other_user_id}>{f.username ? `@${f.username}` : f.display_name || 'Amizade'}</option>)}</select></label>
      {!loading && !friends.length && <p>Você precisa de uma amizade aceita para criar uma cobrança.</p>}
      <label>Tipo<select disabled={busy} value={split ? 'split' : 'charge'} onChange={e => changeForm(() => setSplit(e.target.value === 'split'))}><option value="charge">Cobrar um valor</option><option value="split">Dividir uma despesa igualmente</option></select></label>
      <label>Descrição<input required maxLength={200} disabled={busy} value={description} onChange={e => changeForm(() => setDescription(e.target.value))} placeholder="Ex.: lanche de ontem" /></label>
      <div className="form-two"><label>{split ? 'Total pago por você (R$)' : 'Valor a cobrar (R$)'}<input required inputMode="decimal" disabled={busy} value={amount} onChange={e => changeForm(() => setAmount(e.target.value))} placeholder="0,00" /></label><label>Vencimento (opcional)<input type="date" disabled={busy} value={dueDate} onChange={e => changeForm(() => setDueDate(e.target.value))} /></label></div>
      {preview > 0 && <p>A outra pessoa recebe uma cobrança de <strong>{formatBrlCents(preview)}</strong>.{split && ' Se sobrar um centavo, ele fica na sua parte.'}</p>}
      <button className="button button-dark" disabled={busy || loading || Boolean(loadError) || !friends.some(f => f.other_user_id === friendId)}>{busy ? 'Enviando…' : 'Enviar cobrança'}</button>
    </form>}
    <div className="charge-tabs" role="group" aria-label="Filtrar cobranças">{([['pay', 'A pagar'], ['receive', 'A receber'], ['history', 'Histórico']] as const).map(([value, label]) => <button type="button" className={`button ${filter === value ? 'button-dark' : 'button-light'}`} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}<button type="button" className="text-button" onClick={() => void refresh()}>Atualizar</button></div>
    {loading ? <p role="status">Carregando cobranças…</p> : displayed.length ? <div className="charge-list">{displayed.map(row => <ChargeCard key={row.id} client={client} row={row} userId={userId} highlighted={targetId === row.id} onSaved={refresh} />)}</div> : <div className="empty-expenses"><strong>Nenhuma cobrança nesta lista.</strong></div>}
    {targetId && !loading && !loadError && !rows.some(r => r.id === targetId) && <p role="status">Esta cobrança não está disponível para sua conta.</p>}
  </section>
}

const buttonLabels: Record<ChargeAction, string> = { accept: 'Reconhecer valor', dispute: 'Contestar', reopen: 'Solicitar reconhecimento novamente', report_payment: 'Informar pagamento', confirm_payment: 'Confirmar recebimento', reject_payment: 'Pagamento não localizado', cancel: 'Cancelar cobrança', attach_expense: 'Anexar comprovante da despesa' }
function ChargeCard({ client, row, userId, highlighted, onSaved }: {
  client: SupabaseClient; row: DirectCharge; userId: string; highlighted: boolean; onSaved: () => Promise<void>
}) {
  const [action, setAction] = useState<ChargeAction | null>(null)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [events, setEvents] = useState<ChargeEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const inFlight = useRef(false)
  const actions = availableChargeActions(row, userId)
  const outgoing = row.creditor_id === userId
  async function history() {
    setHistoryLoading(true)
    const { data, error: reason } = await client.from('direct_charge_events').select('id,actor_id,action,note,attachment,created_at').eq('charge_id', row.id).order('created_at')
    if (reason) setError(chargeError(reason)); else setEvents((data ?? []) as ChargeEvent[])
    setHistoryLoading(false)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const attachment = file ? await uploadChargeReceipt(client, row.id, userId, file) : null
      await manageDirectCharge(client, row.id, action, note, attachment)
      setNotice(chargeActionLabels[action]); setAction(null); setFile(null); setNote(''); setEvents([])
      await onSaved(); await history()
    } catch (reason) { setError(chargeError(reason)); await onSaved() }
    finally { setBusy(false); inFlight.current = false }
  }
  async function openReceipt(path: string) {
    setError('')
    try {
      const url = await receiptUrl(client, path)
      // Use an anchor to avoid popup blockers after the signing request.
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click()
    } catch (reason) { setError(chargeError(reason)) }
  }
  async function copyPix() {
    try { await navigator.clipboard.writeText(row.creditor_pix_key ?? ''); setNotice('Chave Pix copiada. Confira o destinatário no banco.') }
    catch { setError('Não foi possível copiar. Selecione a chave Pix exibida abaixo.') }
  }
  const due = row.due_date ? new Date(`${row.due_date}T23:59:59`) : null
  const overdue = due && due < new Date() && row.status !== 'paid' && row.status !== 'cancelled'
  return <article id={`charge-${row.id}`} className={`settlement-panel charge-card${highlighted ? ' charge-highlight' : ''}`}>
    <div className="charge-heading"><div><h2>{row.description}</h2><p>{outgoing ? 'A receber de' : 'A pagar para'} <strong>{row.other_name}</strong></p></div><strong className="charge-value">{formatBrlCents(row.amount_cents)}</strong></div>
    <p><span className="role-badge">{chargeStatusLabels[row.status]}</span> {due && <span>{overdue ? 'Vencida em' : 'Vencimento:'} {due.toLocaleDateString('pt-BR')}</span>}</p>
    {row.total_cents !== null && <p>Despesa de {formatBrlCents(row.total_cents)} dividida entre duas pessoas.</p>}
    {!outgoing && row.creditor_pix_key && row.status !== 'paid' && row.status !== 'cancelled' && <div className="charge-pix"><span>Pix de {row.other_name}: <strong>{row.creditor_pix_key}</strong></span><button className="text-button" type="button" onClick={() => void copyPix()}>Copiar chave Pix</button></div>}
    <div className="charge-actions">{row.expense_attachment && <button type="button" className="text-button" onClick={() => void openReceipt(row.expense_attachment!)}>Ver comprovante da despesa</button>}{row.payment_attachment && <button type="button" className="text-button" onClick={() => void openReceipt(row.payment_attachment!)}>Ver comprovante do pagamento</button>}</div>
    {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}
    <div className="charge-actions">{actions.map(kind => <button type="button" key={kind} disabled={busy} className="button button-light" onClick={() => { setAction(kind); setNote(''); setFile(null); setError(''); setNotice('') }}>{buttonLabels[kind]}</button>)}</div>
    {action && actions.includes(action) && <form className="charge-form charge-action-form" onSubmit={e => void submit(e)}>
      <strong>{buttonLabels[action]}</strong>
      <p>{action === 'confirm_payment' ? 'Confirme somente após conferir o recebimento no seu banco. Isso quitará a cobrança.' : action === 'report_payment' ? 'Informe somente após efetuar o pagamento. A outra pessoa confirmará o recebimento.' : action === 'cancel' ? 'A cobrança será encerrada e continuará no histórico.' : action === 'accept' ? 'Você reconhece o valor solicitado nesta cobrança.' : 'Esta ação será registrada no histórico para as duas pessoas.'}</p>
      <label>{action === 'dispute' || action === 'reject_payment' ? 'Motivo (obrigatório)' : 'Observação (opcional)'}<textarea maxLength={500} required={action === 'dispute' || action === 'reject_payment'} disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></label>
      {(action === 'report_payment' || action === 'attach_expense') && <label>Comprovante {action === 'report_payment' ? '(opcional)' : ''}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required={action === 'attach_expense'} disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /><small>Até 5 MB. Disponível apenas para vocês dois.</small></label>}
      <div className="charge-actions"><button className="button button-dark" disabled={busy}>{busy ? 'Salvando…' : 'Confirmar'}</button><button type="button" className="button button-light" disabled={busy} onClick={() => setAction(null)}>Voltar</button></div>
    </form>}
    <details onToggle={e => { if (e.currentTarget.open) void history() }}><summary>Histórico da cobrança</summary>{historyLoading ? <p role="status">Carregando histórico…</p> : <ol className="charge-history">{events.map(item => <li key={item.id}><strong>{chargeActionLabels[item.action] ?? item.action}</strong><small>{item.actor_id === userId ? 'Você' : row.other_name} · {new Date(item.created_at).toLocaleString('pt-BR')}</small>{item.note && <p>{item.note}</p>}{item.attachment && <button type="button" className="text-button" onClick={() => void openReceipt(item.attachment!)}>Ver comprovante deste registro</button>}</li>)}</ol>}</details>
  </article>
}
