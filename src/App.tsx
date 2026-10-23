import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  createGroup,
  createGroupInvitation,
  manageGroupInvitation,
  sendGroupInvitationEmail,
  updateGroupMember,
  removeGroupMember,
  listMyGroupInvitations,
  acceptGroupInvitation,
  deleteEmptyGroup,
  getGroupMembers,
  listGroupInvitations,
  listMyGroups,
  updateGroup,
  setGroupArchived,
  setMyUsername,
  uploadImage,
  imageColumnsMissing,
  type GroupInvitationRecord,
  type GroupMemberView,
  type GroupRecord,
  type MyGroupInvitation,
} from './lib/groups'
import {
  createExpense,
  calculateBalances,
  generateMonthlySchedule,
  deleteExpense,
  formatBrlCents,
  allocatePercentage,
  listGroupExpenses,
  listGroupSettlements,
  createGroupSettlement,
  parseBrlCents,
  splitEvenly,
  type SplitMode,
  suggestSettlements,
  updateExpense,
  type ExpenseCategory,
  type ExpenseRecord,
  type SettlementRecord,
  type SettlementPaymentMethod,
  importSplitwiseHistory,
} from './lib/expenses'
import { parseSplitwiseCsv, type SplitwiseCsvPreview } from './lib/splitwiseCsv'

type Page = 'groups' | 'group' | 'new-group' | 'expense' | 'account' | 'invitations'
const settlementPaymentLabels: Record<SettlementPaymentMethod, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', transferencia: 'Transferência bancária', cartao: 'Cartão', outro: 'Outro', splitwise: 'Importado do Splitwise',
}

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function isoWeekInputValue(date: Date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = utcDate.getUTCDay() || 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day)
  const year = utcDate.getUTCFullYear()
  const firstWeek = new Date(Date.UTC(year, 0, 4))
  const firstWeekDay = firstWeek.getUTCDay() || 7
  firstWeek.setUTCDate(firstWeek.getUTCDate() + 4 - firstWeekDay)
  const week = 1 + Math.round((utcDate.getTime() - firstWeek.getTime()) / 604800000)
  return `${year}-W${String(week).padStart(2, '0')}`
}

function isoWeekBounds(value: string): { start: string; end: string } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1]), week = Number(match[2])
  if (week < 1 || week > 53) return null
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const mondayOffset = (jan4.getUTCDay() + 6) % 7
  const monday = new Date(jan4.getTime() - mondayOffset * 86400000 + (week - 1) * 604800000)
  const sunday = new Date(monday.getTime() + 6 * 86400000)
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) }
}

function App() {
  const [page, setPage] = useState<Page>('groups')
  const [session, setSession] = useState<Session | null>(null)
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [invitePasswordSetup, setInvitePasswordSetup] = useState(false)
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null)
  const [myInvitations, setMyInvitations] = useState<MyGroupInvitation[]>([])

  async function refreshGroups() {
    if (!supabase) return
    setGroupsLoading(true)
    setGroupsError(null)
    try {
      setGroups(await listMyGroups(supabase))
    } catch (error) {
      setGroupsError(error instanceof Error ? error.message : 'Não foi possível carregar seus grupos.')
    } finally {
      setGroupsLoading(false)
    }
  }

  useEffect(() => {
    if (!supabase) return

    let mounted = true
    const inviteLink = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'invite'
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setCheckingSession(false)
      if (inviteLink && nextSession) setInvitePasswordSetup(true)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      setSession(data.session)
      setCheckingSession(false)
      if (error) setAuthError(error.message)
      if (inviteLink && data.session) setInvitePasswordSetup(true)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setGroups([])
      setSelectedGroupId(null)
      return
    }
    void refreshGroups()
    if (supabase) void listMyGroupInvitations(supabase).then((invitations) => {
      setMyInvitations(invitations)
      if (invitations.length > 0) setPage('invitations')
    }).catch(() => setMyInvitations([]))
  }, [session?.user.id])

  async function refreshMyInvitations() {
    if (supabase) setMyInvitations(await listMyGroupInvitations(supabase))
  }

  async function acceptMyInvitation(id: string) {
    if (!supabase) throw new Error('Autenticação não configurada.')
    await acceptGroupInvitation(supabase, id)
    await refreshMyInvitations()
    await refreshGroups()
  }

  async function signIn(email: string, password: string) {
    if (!supabase) return
    setAuthBusy(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    setAuthBusy(false)
  }

  async function signOut() {
    if (!supabase) return
    setAuthBusy(true)
    const { error } = await supabase.auth.signOut()
    setAuthError(error?.message ?? null)
    setInvitePasswordSetup(false)
    setAuthBusy(false)
  }

  async function setInvitedUserPassword(password: string) {
    if (!supabase) return
    setAuthBusy(true)
    setAuthError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setAuthError(error.message)
    } else {
      setInvitePasswordSetup(false)
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
    }
    setAuthBusy(false)
  }

  async function saveNewGroup(values: { name: string; description: string }) {
    if (!supabase || !session) throw new Error('Entre novamente para criar um grupo.')
    setGroupsError(null)
    const created = await createGroup(supabase, session.user.id, values)
    setGroups((current) => [created, ...current])
    setSelectedGroupId(created.id)
    setPage('group')
  }

  if (checkingSession) {
    return <main className="auth-loading" aria-live="polite">Carregando sua sessão…</main>
  }

  if (invitePasswordSetup && session) {
    return <PasswordSetup onSubmit={setInvitedUserPassword} onSignOut={signOut} busy={authBusy} error={authError} />
  }

  if (!session) {
    return <Login configured={Boolean(supabase)} onSignIn={signIn} busy={authBusy} error={authError} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" onClick={(event) => { event.preventDefault(); setPage('groups') }}>
          <span className="brand-mark">s<span>.</span></span>
          <span>split<span className="brand-accent">uai</span></span>
        </a>
        <div className="side-label">MENU</div>
        <nav className="main-nav" aria-label="Navegação principal">
          <button className={page === 'groups' || page === 'group' || page === 'new-group' || page === 'expense' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('groups')}>
            <span className="nav-icon">▦</span> Meus grupos
          </button>
          <button className={page === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('account')}>
            <span className="nav-icon">◎</span> Minha conta
          </button>
          <button className={page === 'invitations' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('invitations')}>
            <span className="nav-icon">✉</span> Convites recebidos{myInvitations.length > 0 ? ` · ${myInvitations.length}` : ''}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">✳</span><strong>Dividir fica leve.</strong><p>Organize os gastos e aproveite o que importa.</p></div>
          <div className="profile"><div className="avatar avatar-you">U</div><div className="profile-details"><strong>Minha conta</strong><small>Perfil SplitUai</small></div></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Espaço pessoal <span>/</span> <strong>{page === 'account' ? 'Minha conta' : page === 'expense' ? 'Nova despesa' : page === 'group' ? groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo' : page === 'new-group' ? 'Novo grupo' : 'Meus grupos'}</strong></div><div className="topbar-account"><button className="sign-out-button" onClick={() => void signOut()} disabled={authBusy}>Sair</button></div></header>

        {page === 'groups' && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'new-group' && <NewGroup onBack={() => setPage('groups')} onCreate={saveNewGroup} />}
        {page === 'group' && selectedGroupId && supabase && <Group key={selectedGroupId} client={supabase} groupId={selectedGroupId} userId={session.user.id} onBack={() => { void refreshGroups(); setPage('groups') }} onAddExpense={() => { setEditingExpense(null); setPage('expense') }} onEditExpense={(expense) => { setEditingExpense(expense); setPage('expense') }} />}
        {page === 'group' && !selectedGroupId && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'expense' && selectedGroupId && supabase && <Expense client={supabase} groupId={selectedGroupId} groupName={groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo'} userId={session.user.id} expense={editingExpense} onBack={() => { setEditingExpense(null); setPage('group') }} onSaved={() => { setEditingExpense(null); setPage('group') }} />}
        {page === 'account' && supabase && <Account client={supabase} email={session.user.email ?? ''} userId={session.user.id} onSignOut={signOut} busy={authBusy} />}
        {page === 'invitations' && <MyInvitations invitations={myInvitations} onRefresh={() => void refreshMyInvitations()} onAccept={acceptMyInvitation} />}
      </main>
    </div>
  )
}

function Groups({ groups, loading, error, onRefresh, onOpen, onCreate }: {
  groups: GroupRecord[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const visibleGroups = groups.filter((group) => Boolean(group.archived_at) === showArchived)
  return <section className="page-wrap">
    <div className="eyebrow">SEU ESPAÇO COMPARTILHADO</div>
    <div className="page-heading"><div><h1>Seus grupos<span className="heading-dot">.</span></h1><p>Grupos dos quais sua conta participa.</p></div><div className="heading-actions"><button className="button button-light" onClick={onRefresh} disabled={loading}>Atualizar</button><button className="button button-dark" onClick={onCreate}><span>＋</span> Novo grupo</button></div></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>{showArchived ? 'Grupos arquivados' : 'Grupos ativos'}</h2><p>{loading ? 'Carregando…' : `${visibleGroups.length} ${visibleGroups.length === 1 ? 'grupo' : 'grupos'}`}</p></div><div className="heading-actions"><button className="button button-light" onClick={() => setShowArchived(false)} aria-pressed={!showArchived}>Ativos ({groups.filter((group) => !group.archived_at).length})</button><button className="button button-light" onClick={() => setShowArchived(true)} aria-pressed={showArchived}>Arquivados ({groups.filter((group) => group.archived_at).length})</button></div></div>
    <div className="group-grid">
      {visibleGroups.map((group, index) => <button className="group-card" key={group.id} onClick={() => onOpen(group.id)}><div className={`group-cover ${index % 2 === 0 ? 'cover-coast' : 'cover-dinner'} ${group.cover_url ? 'has-custom-cover' : ''}`} style={group.cover_url ? { backgroundImage: `linear-gradient(0deg,rgba(20,30,22,.55),transparent 65%),url("${group.cover_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><span className="cover-tag">{group.archived_at ? 'ARQUIVADO' : 'GRUPO'}</span>{group.icon_url ? <img className="group-card-icon" src={group.icon_url} alt="" /> : <span className="cover-emoji">{index % 2 === 0 ? '✳' : '◌'}</span>}<div className="cover-caption">CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div></div><div className="group-card-body"><div className="group-title-line"><h3>{group.name}</h3><span className="arrow-circle">↗</span></div><p>{group.description || 'Organize as despesas com seus participantes.'}</p><div className="group-meta"><span>{group.created_by ? 'Grupo compartilhado' : 'Grupo'}</span><span className="meta-divider" /><span>{group.archived_at ? 'Arquivado' : 'Despesas compartilhadas'}</span></div></div></button>)}
      {!loading && visibleGroups.length === 0 && <div className="empty-state"><strong>{showArchived ? 'Nenhum grupo arquivado.' : 'Você ainda não participa de um grupo ativo.'}</strong><p>{showArchived ? 'Grupos arquivados continuam disponíveis para consulta.' : 'Crie o primeiro para começar a organizar os participantes.'}</p>{!showArchived && <button className="button button-dark" onClick={onCreate}><span>＋</span> Criar grupo</button>}</div>}
    </div>
    <footer className="page-footer"><span>Feito pra dividir a vida. <b>♡</b></span><span>SplitUai <i>·</i> 2026</span></footer>
  </section>
}

function NewGroup({ onBack, onCreate }: { onBack: () => void; onCreate: (values: { name: string; description: string }) => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onCreate({ name, description })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar o grupo.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="page-wrap form-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><div className="eyebrow">NOVO ESPAÇO COMPARTILHADO</div><h1>Criar grupo<span className="heading-dot">.</span></h1><p className="form-intro">Você será o administrador inicial do grupo.</p><form onSubmit={(event) => void submit(event)}><label>Nome do grupo<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required placeholder="Ex.: Fim de semana em Floripa" disabled={busy} /></label><label>Descrição (opcional)<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={4} placeholder="Um pouco sobre este grupo" disabled={busy} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button button-light" onClick={onBack} disabled={busy}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || !name.trim()}>{busy ? 'Criando…' : 'Criar grupo'} <span>→</span></button></div></form></section>
}

function Group({ client, groupId, userId, onBack, onAddExpense, onEditExpense }: { client: NonNullable<typeof supabase>; groupId: string; userId: string; onBack: () => void; onAddExpense: () => void; onEditExpense: (expense: ExpenseRecord) => void }) {
  const [group, setGroup] = useState<GroupRecord | null>(null)
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const [invitations, setInvitations] = useState<GroupInvitationRecord[]>([])
  const [groupExpenses, setGroupExpenses] = useState<ExpenseRecord[]>([])
  const [groupSettlements, setGroupSettlements] = useState<SettlementRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [settlementFormOpen, setSettlementFormOpen] = useState(false)
  const [settlementNotice, setSettlementNotice] = useState<string | null>(null)
  const [settlementRecipient, setSettlementRecipient] = useState('')
  const [settlementAmount, setSettlementAmount] = useState('')
  const [settlementMethod, setSettlementMethod] = useState<Exclude<SettlementPaymentMethod, 'splitwise'>>('pix')
  const [settlementDate, setSettlementDate] = useState(toDateInputValue(new Date()))
  const [splitwisePreview, setSplitwisePreview] = useState<SplitwiseCsvPreview | null>(null)
  const [splitwiseFileName, setSplitwiseFileName] = useState('')
  const [splitwiseMappings, setSplitwiseMappings] = useState<Record<string, string>>({})
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | 'all'>('all')
  const [chartType, setChartType] = useState<'bars' | 'donut' | 'trend'>('bars')
  const initialToday = new Date()
  const initialDateValue = toDateInputValue(initialToday)
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month' | 'custom' | 'all'>('month')
  const [reportWeek, setReportWeek] = useState(isoWeekInputValue(initialToday))
  const [reportMonth, setReportMonth] = useState(initialDateValue.slice(0, 7))
  const [rangeStart, setRangeStart] = useState(`${initialDateValue.slice(0, 7)}-01`)
  const [rangeEnd, setRangeEnd] = useState(initialDateValue)
  const isAdmin = members.some((member) => member.user_id === userId && member.active && member.role === 'admin')
  const allBalances = calculateBalances(groupExpenses, members.map((member) => member.user_id), undefined, groupSettlements)
  const currentMonth = initialDateValue.slice(0, 7)
  const monthBalances = calculateBalances(groupExpenses, members.map((member) => member.user_id), currentMonth, groupSettlements)
  const settlements = suggestSettlements(allBalances)
  const monthDebtTotal = Math.abs(monthBalances.filter((row) => row.balance_cents < 0).reduce((sum, row) => sum + row.balance_cents, 0))
  const allTimeDebtTotal = Math.abs(allBalances.filter((row) => row.balance_cents < 0).reduce((sum, row) => sum + row.balance_cents, 0))
  const currentUserBalanceOutsideMonth = (allBalances.find((row) => row.user_id === userId)?.balance_cents ?? 0)
    - (monthBalances.find((row) => row.user_id === userId)?.balance_cents ?? 0)
  const weekBounds = reportPeriod === 'week' ? isoWeekBounds(reportWeek) : null
  const expenseDates = groupExpenses.map((expense) => expense.expense_date).sort()
  const periodStart = reportPeriod === 'week' ? weekBounds?.start ?? '' : reportPeriod === 'month' ? `${reportMonth}-01` : reportPeriod === 'custom' ? rangeStart : expenseDates[0] ?? initialDateValue
  const periodEnd = reportPeriod === 'week' ? weekBounds?.end ?? '' : reportPeriod === 'month' && /^\d{4}-\d{2}$/.test(reportMonth)
    ? toDateInputValue(new Date(Number(reportMonth.slice(0, 4)), Number(reportMonth.slice(5, 7)), 0)) : reportPeriod === 'month' ? '' : reportPeriod === 'custom' ? rangeEnd : expenseDates[expenseDates.length - 1] ?? initialDateValue
  const validReportRange = Boolean(periodStart && periodEnd && periodStart <= periodEnd)
  const reportExpenses = validReportRange ? groupExpenses.filter((expense) => expense.expense_date >= periodStart && expense.expense_date <= periodEnd) : []
  const categoryTotals = (['alimentacao','hospedagem','transporte','corrida','atividades','outros'] as ExpenseCategory[]).map((category) => ({
    category,
    all: reportExpenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amount_cents, 0),
  }))
  const visibleExpenses = categoryFilter === 'all' ? groupExpenses : groupExpenses.filter((expense) => expense.category === categoryFilter)
  const expenseMonthGroups = [...new Set(visibleExpenses.map((expense) => expense.expense_date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)).map((month) => {
    const expenses = visibleExpenses.filter((expense) => expense.expense_date.startsWith(month))
    return { month, expenses, total: expenses.reduce((sum, expense) => sum + expense.amount_cents, 0) }
  })

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        let { data: groupData, error: groupError } = await client.from('groups')
          .select('id, name, description, created_by, created_at, archived_at, icon_url, cover_url').eq('id', groupId).maybeSingle()
        if (imageColumnsMissing(groupError)) {
          const fallback = await client.from('groups').select('id, name, description, created_by, created_at, archived_at').eq('id', groupId).maybeSingle()
          groupData = fallback.data as typeof groupData
          groupError = fallback.error
        }
        if (groupError) throw groupError
        if (!groupData) throw new Error('Este grupo não existe ou sua conta não tem acesso.')
        const [memberData, inviteData] = await Promise.all([
          getGroupMembers(client, groupId),
          listGroupInvitations(client, groupId),
        ])
        const [expenseData, settlementData] = await Promise.all([
          listGroupExpenses(client, groupId),
          listGroupSettlements(client, groupId),
        ])
        if (!active) return
        const currentGroup = groupData as GroupRecord
        setGroup(currentGroup)
        setName(currentGroup.name)
        setDescription(currentGroup.description ?? '')
        setMembers(memberData)
        setInvitations(inviteData)
        setGroupExpenses(expenseData)
        setGroupSettlements(settlementData)
      } catch (reason) {
        const code = typeof reason === 'object' && reason !== null && 'code' in reason ? String(reason.code) : ''
        if (active) setError(code === '42501' ? 'Seu acesso a este grupo foi encerrado ou sua conta não tem permissão para esta operação.' : reason instanceof Error ? reason.message : 'Não foi possível carregar o grupo.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [client, groupId])

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const iconUrl = iconFile ? await uploadImage(client, `groups/${groupId}/icon`, iconFile) : group?.icon_url
      const coverUrl = coverFile ? await uploadImage(client, `groups/${groupId}/cover`, coverFile) : group?.cover_url
      const updated = await updateGroup(client, groupId, { name, description, icon_url: iconUrl, cover_url: coverUrl })
      setGroup(updated)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o grupo.')
    } finally {
      setBusy(false)
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const created = await createGroupInvitation(client, groupId, email)
      setInvitations((current) => [created, ...current])
      setEmail('')
      await sendGroupInvitationEmail(client, groupId, created.id)
      setInvitations(await listGroupInvitations(client, groupId))
      setNotice(`E-mail de convite enviado para ${created.invited_email}.`)
    } catch (reason) {
      setInvitations(await listGroupInvitations(client, groupId).catch(() => invitations))
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar ou enviar o convite. Verifique se já há um convite ativo para este e-mail.')
    } finally {
      setBusy(false)
    }
  }

  async function invitationAction(invitation: GroupInvitationRecord, action: 'send' | 'cancel') {
    setBusy(true); setError(null)
    try {
      if (action === 'cancel') await manageGroupInvitation(client, groupId, invitation.id, 'cancel')
      else await sendGroupInvitationEmail(client, groupId, invitation.id)
      setInvitations(await listGroupInvitations(client, groupId))
      setNotice(action === 'cancel' ? 'Convite cancelado.' : `E-mail enviado para ${invitation.invited_email}. A validade foi renovada por 14 dias.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o convite.') }
    finally { setBusy(false) }
  }

  async function memberRole(member: GroupMemberView, role: 'admin' | 'member') {
    setBusy(true); setError(null)
    try { await updateGroupMember(client, groupId, member.user_id, role, member.display_name); setMembers(await getGroupMembers(client, groupId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o papel.') }
    finally { setBusy(false) }
  }

  async function memberRemove(member: GroupMemberView) {
    if (!window.confirm(`Remover ${member.username ? `@${member.username}` : member.display_name || 'este participante'}? O acesso será encerrado e o histórico financeiro será preservado.`)) return
    setBusy(true); setError(null)
    try { await removeGroupMember(client, groupId, member.user_id); setMembers(await getGroupMembers(client, groupId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível remover o participante.') }
    finally { setBusy(false) }
  }

  async function memberName(member: GroupMemberView, displayName: string) {
    setBusy(true); setError(null)
    try { await updateGroupMember(client, groupId, member.user_id, member.role, displayName || null); setMembers(await getGroupMembers(client, groupId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível editar os dados do participante.') }
    finally { setBusy(false) }
  }

  async function chooseSplitwiseFile(file: File | undefined) {
    setError(null); setNotice(null); setSplitwisePreview(null)
    if (!file) return
    try {
      const preview = parseSplitwiseCsv(await file.text(), file.name, {})
      const mappings: Record<string, string> = {}
      for (const name of preview.memberNames) {
        const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR')
        const match = members.find((member) => [member.display_name, member.username].some((label) => label?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/^@/, '').toLocaleLowerCase('pt-BR') === normalized))
        mappings[name] = match?.user_id ?? ''
      }
      setSplitwisePreview(preview); setSplitwiseFileName(file.name); setSplitwiseMappings(mappings)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ler o CSV do Splitwise.') }
  }

  async function importSplitwise() {
    if (!splitwisePreview) return
    const ids = splitwisePreview.memberNames.map((name) => splitwiseMappings[name]).filter(Boolean)
    if (ids.length !== splitwisePreview.memberNames.length || new Set(ids).size !== ids.length) {
      setError('Associe cada pessoa do CSV a um participante diferente do grupo.'); return
    }
    const mapId = (id: string) => splitwiseMappings[id] ?? id
    setBusy(true); setError(null); setNotice(null)
    try {
      const expenseRows = splitwisePreview.expenses.map((expense) => ({ ...expense, paid_by: mapId(expense.paid_by), shares: expense.shares.map((share) => ({ ...share, user_id: mapId(share.user_id) })) }))
      const settlementRows = splitwisePreview.settlements.map((settlement) => ({ ...settlement, paid_by: mapId(settlement.paid_by), received_by: mapId(settlement.received_by) }))
      const result = await importSplitwiseHistory(client, groupId, expenseRows, settlementRows)
      const [expenseData, settlementData] = await Promise.all([listGroupExpenses(client, groupId), listGroupSettlements(client, groupId)])
      setGroupExpenses(expenseData); setGroupSettlements(settlementData); setSplitwisePreview(null)
      setNotice(`Importação concluída: ${result.expenses_added} despesas e ${result.settlements_added} acertos novos. ${result.expenses_existing + result.settlements_existing} registros já existiam.`)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : typeof reason === 'object' && reason !== null && 'message' in reason ? String(reason.message) : 'Não foi possível importar o histórico.'
      setError(detail)
    }
    finally { setBusy(false) }
  }

  async function saveSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(null); setSettlementNotice(null)
    try {
      await createGroupSettlement(client, {
        groupId,
        receivedBy: settlementRecipient,
        amountCents: parseBrlCents(settlementAmount),
        settlementDate,
        paymentMethod: settlementMethod,
      })
      setGroupSettlements(await listGroupSettlements(client, groupId))
      setSettlementFormOpen(false)
      setSettlementRecipient('')
      setSettlementAmount('')
      setSettlementDate(toDateInputValue(new Date()))
      setSettlementNotice('Acerto registrado. Os saldos do grupo foram atualizados.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar o acerto.')
    } finally { setBusy(false) }
  }

  async function removeExpense(expense: ExpenseRecord) {
    if (!window.confirm(`Excluir “${expense.description}”?`)) return
    try {
      await deleteExpense(client, expense.id)
      setGroupExpenses((current) => current.filter((item) => item.id !== expense.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a despesa.')
    }
  }

  async function archiveGroup() {
    const archived = !group?.archived_at
    const verb = archived ? 'arquivar' : 'restaurar'
    if (!window.confirm(`Confirma ${verb} o grupo “${group?.name}”? O histórico e os saldos serão preservados.`)) return
    setBusy(true)
    setError(null)
    try {
      await setGroupArchived(client, groupId, archived)
      onBack()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Não foi possível ${verb} o grupo.`)
    } finally { setBusy(false) }
  }

  async function permanentlyDeleteGroup() {
    if (!group || !window.confirm(`Excluir definitivamente “${group.name}”? Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteEmptyGroup(client, groupId)
      onBack()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o grupo. Grupos com despesas devem ser arquivados.')
    } finally { setBusy(false) }
  }

  if (loading) return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><p className="auth-loading">Carregando grupo…</p></section>
  if (error && !group) return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><p className="auth-error" role="alert">{error}</p></section>
  if (!group) return null

  const canDeleteGroup = (isAdmin || group.created_by === userId) && groupExpenses.length === 0 && groupSettlements.length === 0
  const memberLabel = (userId: string) => {
    const member = members.find((item) => item.user_id === userId)
    return member?.username ? `@${member.username}` : member?.display_name || 'Sem identificador'
  }
  const renderBalances = (rows: typeof allBalances) => <div className="balance-list">{rows.map((balance) => <div className="balance-row" key={balance.user_id}><span>{memberLabel(balance.user_id)}</span><strong className={balance.balance_cents > 0 ? 'balance-positive' : balance.balance_cents < 0 ? 'balance-negative' : ''}>{balance.balance_cents > 0 ? 'Recebe ' : balance.balance_cents < 0 ? 'Deve ' : ''}{formatBrlCents(Math.abs(balance.balance_cents))}</strong></div>)}</div>
  const categoryLabels: Record<ExpenseCategory, string> = { alimentacao: 'Alimentação', hospedagem: 'Hospedagem', transporte: 'Transporte', corrida: 'Corrida', atividades: 'Atividades', outros: 'Outros' }
  const categoryEmojis: Record<ExpenseCategory, string> = { alimentacao: '🍴', hospedagem: '🏡', transporte: '🚗', corrida: '🍁', atividades: '🎟️', outros: '✳' }
  const installmentStatus = (dueDate: string) => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return dueDate < today ? 'Vencimento passado' : 'A vencer'
  }
  const renderExpenseRow = (expense: ExpenseRecord) => {
    const payer = memberLabel(expense.paid_by)
    const schedule = expense.installments.map((part) => `${formatBrlCents(part.amount_cents)} em ${new Date(`${part.due_date}T12:00:00`).toLocaleDateString('pt-BR')} (${installmentStatus(part.due_date)})`).join(' · ')
    return <div className="expense-row" key={expense.id}>
      <span className={`expense-icon category-${expense.category}`}>{categoryEmojis[expense.category]}</span>
      {isAdmin
        ? <button className="expense-name expense-open" onClick={() => onEditExpense(expense)}><strong>{expense.description}</strong><small>{payer} pagou · {categoryLabels[expense.category]} · {expense.installments.length}x · {schedule}</small></button>
        : <div className="expense-name"><strong>{expense.description}</strong><small>{payer} pagou · {categoryLabels[expense.category]} · {expense.installments.length}x · {schedule}</small></div>}
      <strong className="expense-amount">{formatBrlCents(expense.amount_cents)}</strong>
      {expense.rounding_remainder_cents > 0 && <small>Ajuste {formatBrlCents(expense.rounding_remainder_cents)} fica com quem pagou</small>}
      {isAdmin && <><button className="expense-edit" aria-label={`Editar ${expense.description}`} onClick={() => onEditExpense(expense)}>Editar</button><button className="expense-delete" aria-label={`Excluir ${expense.description}`} onClick={() => void removeExpense(expense)}>×</button></>}
    </div>
  }
  return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><div className="detail-hero" style={group.cover_url ? { backgroundImage: `linear-gradient(90deg,rgba(18,28,17,.78),rgba(18,28,17,.2)),url("${group.cover_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><div><div className="eyebrow">{group.archived_at ? 'GRUPO ARQUIVADO' : 'GRUPO'} · CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div>{editing ? <form className="group-edit-form" onSubmit={(event) => void saveDetails(event)}><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></label><div className="group-image-fields"><label>Foto do ícone<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setIconFile(event.target.files?.[0] ?? null)} /></label><label>Foto de capa<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)} /></label></div><small>JPG, PNG ou WebP · até 5 MB por imagem.</small><div className="form-actions"><button type="button" className="button button-light" onClick={() => { setName(group.name); setDescription(group.description ?? ''); setIconFile(null); setCoverFile(null); setEditing(false) }}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div></form> : <><div className="group-hero-title">{group.icon_url && <img className="group-icon-large" src={group.icon_url} alt="" />}<h1>{group.name}<span className="heading-dot">.</span></h1></div><p>{group.description || 'Organize as despesas com seus participantes.'}</p>{isAdmin && <button className="text-button" onClick={() => setEditing(true)}>Editar informações</button>}</>}<div className="detail-people"><span>{members.length} {members.length === 1 ? 'participante' : 'participantes'} · Seu papel: {isAdmin ? 'admin' : 'membro'}</span></div><div className="heading-actions"><button className="button button-light" onClick={() => void archiveGroup()} disabled={busy}>{group.archived_at ? 'Restaurar grupo' : 'Arquivar grupo'}</button>{canDeleteGroup && <button className="button button-light" onClick={() => void permanentlyDeleteGroup()} disabled={busy}>Excluir grupo</button>}</div>{groupExpenses.length > 0 && <small>Grupos com despesas podem ser arquivados; o histórico não pode ser apagado.</small>}</div>{!group.cover_url && <div className="detail-illustration">✳</div>}</div>{error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>Participantes</h2><p>Participantes removidos continuam no histórico das despesas e dos saldos.</p></div></div><div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}>{member.avatar_url ? <img className="avatar avatar-photo" src={member.avatar_url} alt="" /> : <span className="avatar avatar-you">{(member.username?.[0] ?? member.display_name?.[0] ?? 'P').toUpperCase()}</span>}<span className="member-name">{member.username ? `@${member.username}` : member.display_name || 'Sem identificador'}{!member.active && <small> · Acesso encerrado</small>}</span><span className="role-badge">{member.role === 'admin' ? 'Administrador' : 'Membro'}</span>{isAdmin && member.active && member.user_id !== userId && <><input className="member-label-input" aria-label={`Nome neste grupo para ${member.username ?? member.display_name ?? 'participante'}`} placeholder="Nome neste grupo" defaultValue={member.display_name ?? ''} maxLength={80} disabled={busy} onBlur={(event) => { if (event.target.value !== (member.display_name ?? '')) void memberName(member, event.target.value.trim()) }} /><select aria-label={`Papel de ${member.username ?? member.display_name ?? 'participante'}`} value={member.role} disabled={busy} onChange={(event) => void memberRole(member, event.target.value as 'admin' | 'member')}><option value="member">Membro</option><option value="admin">Administrador</option></select><button className="text-button" disabled={busy} onClick={() => void memberRemove(member)}>Remover</button></>}</div>)}</div>
    {isAdmin && <><div className="section-title"><div><h2>Convites</h2><p>Envie e acompanhe convites para este grupo.</p></div></div><div className="invite-panel"><form className="invite-form" onSubmit={(event) => void invite(event)}><label>E-mail da pessoa<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="pessoa@email.com" disabled={busy} /></label><button className="button button-dark" disabled={busy}>{busy ? 'Enviando…' : 'Criar e enviar'}</button></form><p className="invite-help">A pessoa receberá um link seguro para entrar. Contas existentes recebem link de acesso; contas novas recebem convite para criar a senha. O aceite do grupo acontece depois que a pessoa entra e confirma o convite.</p>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}{invitations.length > 0 && <div className="invitation-list">{invitations.map((invitation) => { const expired = ['pending','sent'].includes(invitation.status) && new Date(invitation.expires_at) <= new Date(); const status = expired ? 'expired' : invitation.status; return <div className="invitation-row" key={invitation.id}><div><strong>{invitation.invited_email}</strong><small>Expira em {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}</small></div><span className={`invite-status status-${status}`}>{status === 'pending' ? 'Pendente' : status === 'sent' ? 'Enviado' : status === 'accepted' ? 'Aceito' : status === 'cancelled' ? 'Cancelado' : 'Expirado'}</span>{isAdmin && ['pending','sent'].includes(invitation.status) && !expired && <><button className="text-button" disabled={busy} onClick={() => void invitationAction(invitation,'send')}>{invitation.status === 'sent' ? 'Reenviar' : 'Enviar'}</button><button className="text-button" disabled={busy} onClick={() => void invitationAction(invitation,'cancel')}>Cancelar</button></>}</div> })}</div>}</div></>}
    {isAdmin && <section className="settlement-panel splitwise-import"><div><h3>Importar histórico do Splitwise</h3><p>Despesas entram como despesas e pagamentos entram como acertos, separados dos gráficos. Reimportar o mesmo arquivo não duplica os registros.</p></div><label>Arquivo CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void chooseSplitwiseFile(event.target.files?.[0])} /></label>{splitwisePreview && <><strong>{splitwiseFileName}: {splitwisePreview.expenses.length} despesas · {splitwisePreview.settlements.length} acertos · {splitwisePreview.skipped.length} linhas ignoradas</strong><div className="splitwise-mappings">{splitwisePreview.memberNames.map((person) => <label key={person}>{person}<select value={splitwiseMappings[person] ?? ''} onChange={(event) => setSplitwiseMappings((current) => ({ ...current, [person]: event.target.value }))}><option value="">Selecione participante</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username ? `@${member.username}` : member.display_name || 'Sem identificador'}{!member.active ? ' (acesso encerrado)' : ''}</option>)}</select></label>)}</div>{splitwisePreview.skipped.length > 0 && <details><summary>Ver linhas ignoradas</summary><ul>{splitwisePreview.skipped.map((row) => <li key={row.row}>Linha {row.row} · {row.description}: {row.reason}</li>)}</ul></details>}<div className="form-actions"><button className="button button-light" disabled={busy} onClick={() => setSplitwisePreview(null)}>Cancelar</button><button className="button button-dark" disabled={busy || splitwisePreview.expenses.length + splitwisePreview.settlements.length === 0} onClick={() => void importSplitwise()}>{busy ? 'Importando…' : 'Importar histórico'}</button></div></>}</section>}
    <div className="detail-stats"><div><small>DESPESAS DO GRUPO</small><strong>{groupExpenses.length}</strong></div><div><small>PARTICIPANTES</small><strong>{members.length}</strong></div><div><small>VALOR DEVEDOR TOTAL</small><strong>{formatBrlCents(allTimeDebtTotal)}</strong></div><button className="button button-dark" onClick={onAddExpense}><span>＋</span> Nova despesa</button></div>
    <div className="section-title detail-section-title"><div><h2>Saldos em paralelo</h2><p>O saldo do mês considera apenas parcelas e acertos com data neste mês. O saldo total reúne todo o histórico.</p></div></div>
    <div className="balance-columns"><section className="settlement-panel"><h3>Saldo do mês · {new Date(`${currentMonth}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>{renderBalances(monthBalances)}<strong>Total devedor do mês: {formatBrlCents(monthDebtTotal)}</strong><small className="balance-period-note">{currentUserBalanceOutsideMonth === 0 ? 'Seu saldo dos demais períodos está zerado.' : `Nos demais períodos, ${currentUserBalanceOutsideMonth < 0 ? 'você deve' : 'você recebe'} ${formatBrlCents(Math.abs(currentUserBalanceOutsideMonth))}.`}</small></section><section className="settlement-panel"><h3>Saldo de todo o período</h3>{renderBalances(allBalances)}<strong>Falta acertar: {formatBrlCents(allTimeDebtTotal)}</strong></section></div>
    <div className="settlement-panel"><div className="settlement-panel-heading"><h3>Sugestões de acerto · todo o período</h3><button className="button button-dark" type="button" onClick={() => { setSettlementFormOpen((open) => !open); setError(null); setSettlementNotice(null) }}>{settlementFormOpen ? 'Cancelar acerto' : '＋ Acertar contas'}</button></div>{settlements.length ? <div className="settlement-list">{settlements.map((item, index) => <div className="balance-row" key={`${item.from_user_id}-${item.to_user_id}-${index}`}><span>{memberLabel(item.from_user_id)} paga para {memberLabel(item.to_user_id)}</span><strong>{formatBrlCents(item.amount_cents)}</strong></div>)}</div> : <p>Todos estão em dia. Não há transferências sugeridas.</p>}<small>As sugestões mostram valores para quitar o saldo. Você também pode registrar pagamentos parciais.</small>
      {settlementFormOpen && <form className="settlement-form" onSubmit={(event) => void saveSettlement(event)}><p>Registre um pagamento feito por você. O valor pode ser parcial e não precisa quitar toda a dívida.</p><div className="settlement-form-fields"><label>Quem recebeu?<select required value={settlementRecipient} onChange={(event) => setSettlementRecipient(event.target.value)}><option value="">Escolha uma pessoa</option>{members.filter((member) => member.user_id !== userId).map((member) => <option key={member.user_id} value={member.user_id}>{memberLabel(member.user_id)}{member.active ? '' : ' · sem acesso'}</option>)}</select></label><label>Valor pago<input required type="text" inputMode="decimal" placeholder="0,00" value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} /></label><label>Como foi pago?<select value={settlementMethod} onChange={(event) => setSettlementMethod(event.target.value as Exclude<SettlementPaymentMethod, 'splitwise'>)}><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência bancária</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select></label><label>Data do pagamento<input required type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></label></div><div className="form-actions"><button type="button" className="button button-light" disabled={busy} onClick={() => setSettlementFormOpen(false)}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || !settlementRecipient || !settlementAmount.trim()}>{busy ? 'Registrando…' : 'Registrar pagamento'}</button></div></form>}
      {settlementNotice && <p className="auth-message" role="status">{settlementNotice}</p>}
    </div>
    {groupSettlements.length > 0 && <details className="settlement-panel settlement-history"><summary><span><strong>Acertos registrados</strong><small>{groupSettlements.length} {groupSettlements.length === 1 ? 'pagamento confirmado' : 'pagamentos confirmados'}</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="settlement-list">{groupSettlements.map((item) => { const paidByUser = item.paid_by === userId; const receivedByUser = item.received_by === userId; return <div className={`balance-row settlement-row${paidByUser ? ' settlement-paid' : receivedByUser ? ' settlement-received' : ''}`} key={item.id}><span><strong>{paidByUser ? `Você pagou para ${memberLabel(item.received_by)}` : receivedByUser ? `${memberLabel(item.paid_by)} pagou para você` : `${memberLabel(item.paid_by)} pagou para ${memberLabel(item.received_by)}`}</strong><small>{item.description} · {settlementPaymentLabels[item.payment_method] ?? 'Forma não informada'} · {new Date(`${item.settlement_date}T12:00:00`).toLocaleDateString('pt-BR')}</small></span><strong>{formatBrlCents(item.amount_cents)}</strong></div> })}</div><small>Acertos reduzem os saldos e ficam separados do total de despesas. Vermelho: você pagou; verde: você recebeu.</small></details>}
    <div className="section-title detail-section-title chart-section-heading">
      <div><h2>Despesas por categoria</h2><p>Veja como os gastos se distribuem no período escolhido.</p></div>
      <div className="chart-switch" role="group" aria-label="Tipo de gráfico"><button className={chartType === 'bars' ? 'selected' : ''} onClick={() => setChartType('bars')}>Barras</button><button className={chartType === 'donut' ? 'selected' : ''} onClick={() => setChartType('donut')}>Rosca</button><button className={chartType === 'trend' ? 'selected' : ''} onClick={() => setChartType('trend')}>Tendência</button></div>
    </div>
    <div className="report-controls">
      <label>Período<select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value as 'week' | 'month' | 'custom' | 'all')}><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Intervalo selecionado</option><option value="all">Desde o início · todo o período</option></select></label>
      {reportPeriod === 'week' && <label>Semana<input aria-label="Escolher semana" type="week" value={reportWeek} onChange={(event) => setReportWeek(event.target.value)} /></label>}
      {reportPeriod === 'month' && <label>Mês<input aria-label="Escolher mês" type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} /></label>}
      {reportPeriod === 'custom' && <div className="report-date-range"><label>De<input aria-label="Data inicial" type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label><span>até</span><label>Até<input aria-label="Data final" type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label></div>}
    </div>
    {reportPeriod === 'custom' && rangeStart && rangeEnd && rangeStart > rangeEnd
      ? <p className="report-range-summary report-range-error">A data inicial precisa ser anterior à data final.</p>
      : <p className="report-range-summary">{reportExpenses.length} {reportExpenses.length === 1 ? 'despesa' : 'despesas'} · {reportPeriod === 'all' ? 'desde o início' : periodStart && periodEnd ? `${new Date(`${periodStart}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${periodEnd}T12:00:00`).toLocaleDateString('pt-BR')}` : 'selecione um período'} · {formatBrlCents(reportExpenses.reduce((sum, expense) => sum + expense.amount_cents, 0))}</p>}
    {validReportRange
      ? <GroupExpenseCharts rows={categoryTotals} expenses={reportExpenses} periodStart={periodStart} periodEnd={periodEnd} labels={categoryLabels} format={formatBrlCents} chartType={chartType} />
      : <div className="chart-card"><p className="chart-empty">Escolha um período válido para visualizar os gastos.</p></div>}
    <div className="section-title detail-section-title"><div><h2>Despesas</h2><p>Registros organizados por mês, do mais recente para o mais antigo.</p></div><label>Categoria<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as ExpenseCategory | 'all')}><option value="all">Todas</option>{Object.entries(categoryLabels).map(([key,label]) => <option key={key} value={key}>{categoryEmojis[key as ExpenseCategory]} {label}</option>)}</select></label></div>
    {expenseMonthGroups.length === 0
      ? <div className="empty-expenses"><strong>Nenhuma despesa nesta categoria.</strong><p>Registre uma despesa ou escolha outra categoria.</p></div>
      : <div className="expense-month-groups">{expenseMonthGroups.map(({ month, expenses, total }) => {
        const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        return <section className="expense-month-group" key={month}>
          <header><div><h3>{monthLabel.charAt(0).toLocaleUpperCase('pt-BR') + monthLabel.slice(1)}</h3><small>{expenses.length} {expenses.length === 1 ? 'lançamento' : 'lançamentos'}</small></div><strong>{formatBrlCents(total)}</strong></header>
          <div className="expense-list">{expenses.map(renderExpenseRow)}</div>
        </section>
      })}</div>}
  </section>
}

function GroupExpenseCharts({ rows, expenses, periodStart, periodEnd, labels, format, chartType }: {
  rows: { category: ExpenseCategory; all: number }[]
  expenses: ExpenseRecord[]
  periodStart: string
  periodEnd: string
  labels: Record<ExpenseCategory, string>
  format: (cents: number) => string
  chartType: 'bars' | 'donut' | 'trend'
}) {
  const colors = ['#77a744', '#d59764', '#729bb3', '#b98665', '#b69bc7', '#d4bc66']
  const total = rows.reduce((sum, row) => sum + row.all, 0)
  const palette = rows.map((row, index) => ({ ...row, color: colors[index], share: total ? row.all / total * 100 : 0 }))
  const start = new Date(`${periodStart}T00:00:00Z`)
  const end = new Date(`${periodEnd}T00:00:00Z`)
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const bucketCount = Math.min(6, totalDays)
  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const firstDay = Math.floor(index * totalDays / bucketCount)
    const afterLastDay = Math.floor((index + 1) * totalDays / bucketCount)
    const bucketStart = new Date(start.getTime() + firstDay * 86400000).toISOString().slice(0, 10)
    const bucketEnd = new Date(start.getTime() + afterLastDay * 86400000).toISOString().slice(0, 10)
    const value = expenses.filter((expense) => expense.expense_date >= bucketStart && expense.expense_date < bucketEnd).reduce((sum, expense) => sum + expense.amount_cents, 0)
    const labelDate = new Date(`${bucketStart}T12:00:00`)
    const label = totalDays <= 7
      ? labelDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
      : totalDays <= 31 ? `${String(labelDate.getDate()).padStart(2, '0')}`
        : labelDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    return { label, value }
  })
  const maximum = Math.max(1, ...trend.map((item) => item.value))
  const trendX = (index: number) => trend.length === 1 ? 200 : 20 + index * (360 / (trend.length - 1))
  const points = trend.map((item, index) => `${trendX(index)},${108 - item.value / maximum * 82}`).join(' ')
  return <div className="chart-card">
    {chartType === 'bars' && <div className="chart-bars">{palette.map((item) => <div className="chart-bar-row" key={item.category}><div className="chart-bar-label"><span>{labels[item.category]}</span><strong>{format(item.all)}</strong></div><div className="chart-track"><i style={{ width: `${item.share}%`, background: item.color }} /></div></div>)}</div>}
    {chartType === 'donut' && <div className="chart-donut-layout"><div className="chart-donut" style={{ background: `conic-gradient(${palette.map((item, index) => `${item.color} ${palette.slice(0,index).reduce((sum, row) => sum + row.share, 0)}% ${palette.slice(0,index + 1).reduce((sum, row) => sum + row.share, 0)}%`).join(',')})` }}><div><strong>{format(total)}</strong><small>Total registrado</small></div></div><div className="chart-legend">{palette.map((item) => <div key={item.category}><span style={{ background: item.color }} />{labels[item.category]}<strong>{Math.round(item.share)}%</strong></div>)}</div></div>}
    {chartType === 'trend' && <div className="chart-trend"><svg viewBox="0 0 400 130" role="img" aria-label="Tendência das despesas no período selecionado"><path className="trend-area" d={`M ${points.split(' ').join(' L ')} L 380 112 L 20 112 Z`} /><polyline points={points} /><line x1="20" y1="112" x2="380" y2="112" />{trend.map((item, index) => <g key={`${item.label}-${index}`}><circle cx={trendX(index)} cy={108 - item.value / maximum * 82} r="4" /><text x={trendX(index)} y="128" textAnchor="middle">{item.label}</text></g>)}</svg><div className="chart-trend-totals" style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` }}>{trend.map((item, index) => <span key={`${item.label}-${index}`}>{format(item.value)}</span>)}</div></div>}
    {total === 0 && <p className="chart-empty">Adicione despesas para visualizar os gráficos.</p>}
  </div>
}

function Expense({ client, groupId, groupName, userId, expense, onBack, onSaved }: { client: NonNullable<typeof supabase>; groupId: string; groupName: string; userId: string; expense: ExpenseRecord | null; onBack: () => void; onSaved: () => void }) {
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const activeMembers = members.filter((member) => member.active)
  const includesFormerParticipant = Boolean(expense && [expense.paid_by, ...expense.shares.map((share) => share.user_id)].some((id) => members.some((member) => member.user_id === id && !member.active)))
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(expense ? `${Math.floor(expense.amount_cents / 100)},${String(expense.amount_cents % 100).padStart(2, '0')}` : '')
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? userId)
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'outros')
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const [firstDueDate, setFirstDueDate] = useState(expense?.installments[0]?.due_date ?? expense?.expense_date ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [participantIds, setParticipantIds] = useState<string[]>(expense?.shares.map((share) => share.user_id) ?? [])
  const [splitMode, setSplitMode] = useState<SplitMode>(expense?.split_mode ?? 'equal')
  const [percentageInputs, setPercentageInputs] = useState<Record<string, string>>(() => Object.fromEntries((expense?.shares ?? []).map((share) => [share.user_id, String(share.percentage ?? (expense?.amount_cents ? share.amount_cents * 100 / expense.amount_cents : 0))])))
  const [customInputs, setCustomInputs] = useState<Record<string, string>>(() => Object.fromEntries((expense?.shares ?? []).map((share) => [share.user_id, `${Math.floor(share.amount_cents / 100)},${String(share.amount_cents % 100).padStart(2, '0')}`])))
  const [installmentCount, setInstallmentCount] = useState(String(expense?.installments.length ?? 1))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getGroupMembers(client, groupId).then((rows) => {
      if (!active) return
      setMembers(rows)
      if (!expense) {
        const currentMembers = rows.filter((member) => member.active)
        setParticipantIds(currentMembers.map((member) => member.user_id))
        if (currentMembers.some((member) => member.user_id === userId)) setPaidBy(userId)
        else if (currentMembers[0]) setPaidBy(currentMembers[0].user_id)
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os participantes.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [client, groupId, expense, userId])

  function makeShares(amountCents: number) {
    if (!participantIds.length) throw new Error('Selecione ao menos uma pessoa.')
    if (splitMode === 'equal') return splitEvenly(amountCents, participantIds)
    if (splitMode === 'percentage') {
      const percentages = Object.fromEntries(participantIds.map((id) => [id, Number(percentageInputs[id] ?? 0)]))
      return { shares: allocatePercentage(amountCents, percentages), remainderCents: 0 }
    }
    const shares = participantIds.map((id) => {
      const value = (customInputs[id] ?? '0').trim()
      const amount_cents = /^0+(?:[,.]0{1,2})?$/.test(value) ? 0 : parseBrlCents(value)
      return { user_id: id, amount_cents }
    })
    if (shares.reduce((sum, share) => sum + share.amount_cents, 0) !== amountCents) throw new Error('Os valores individuais precisam somar exatamente o total.')
    return { shares, remainderCents: 0 }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const amountCents = parseBrlCents(amount)
      const { shares, remainderCents } = makeShares(amountCents)
      const count = Number(installmentCount)
      const installments = generateMonthlySchedule(amountCents, count, firstDueDate, shares, remainderCents)
      const values = { description, category, amountCents, paidBy, expenseDate, notes, splitMode, roundingRemainderCents: remainderCents, shares, installments }
      if (expense) await updateExpense(client, expense.id, values)
      else await createExpense(client, groupId, values)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a despesa.')
    } finally { setBusy(false) }
  }

  let preview: ReturnType<typeof splitEvenly> | null = null
  let previewError: string | null = null
  let parsedAmount: number | null = null
  try {
    parsedAmount = parseBrlCents(amount)
    preview = makeShares(parsedAmount)
    generateMonthlySchedule(parsedAmount, Number(installmentCount), firstDueDate, preview.shares, preview.remainderCents)
  } catch (reason) { previewError = reason instanceof Error ? reason.message : 'Confira os dados do rateio.' }
  const memberLabel = (member: GroupMemberView) => member.username ? `@${member.username}` : member.display_name || 'Sem identificador'
  const totalPercent = participantIds.reduce((sum, id) => sum + Number(percentageInputs[id] ?? 0), 0)
  const installmentsPreview = parsedAmount && preview && !previewError ? generateMonthlySchedule(parsedAmount, Number(installmentCount), firstDueDate, preview.shares, preview.remainderCents) : []

  return <section className="page-wrap form-wrap"><button className="back-link" onClick={onBack}>← Voltar ao grupo</button><div className="eyebrow">{groupName}</div><h1>{expense ? 'Editar despesa' : 'Nova despesa'}<span className="heading-dot">.</span></h1><p className="form-intro">Registre o gasto, escolha como dividir e confira as parcelas antes de salvar.</p>{includesFormerParticipant && <p className="invite-help">Esta despesa inclui participante removido. O registro e as parcelas foram preservados e não podem ser recalculados.</p>}{loading ? <p className="auth-loading">Carregando participantes…</p> : <form onSubmit={(event) => void submit(event)}>
    <label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} required placeholder="Ex.: almoço na praia" disabled={busy} /></label>
    <div className="form-two"><label>Valor total<div className="money-input"><span>R$</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required placeholder="0,00" disabled={busy} /></div></label><label>Quem pagou?<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} required disabled={busy}><option value="" disabled>Selecione</option>{activeMembers.map((member) => <option key={member.user_id} value={member.user_id}>{memberLabel(member)}{member.user_id === userId ? ' (você)' : ''}</option>)}</select></label></div>
    <div className="form-two"><label>Categoria<select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)} disabled={busy}><option value="alimentacao">🍴 Alimentação</option><option value="hospedagem">🏡 Hospedagem</option><option value="transporte">🚗 Transporte</option><option value="corrida">🍁 Corrida</option><option value="atividades">🎟️ Atividades</option><option value="outros">✳ Outros</option></select></label><label>Data da despesa<input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required disabled={busy} /></label></div>
    <label>Forma de divisão<select value={splitMode} onChange={(event) => setSplitMode(event.target.value as SplitMode)} disabled={busy}><option value="equal">Igualmente</option><option value="percentage">Por porcentagem</option><option value="custom">Valores definidos por pessoa</option></select></label>
    <fieldset className="participant-picker"><legend>Participantes</legend>{activeMembers.map((member) => <label key={member.user_id}><input type="checkbox" checked={participantIds.includes(member.user_id)} onChange={(event) => { const ids = event.target.checked ? [...participantIds, member.user_id] : participantIds.filter((id) => id !== member.user_id); setParticipantIds(ids); if (event.target.checked) { const equal = ids.length ? 100 / ids.length : 0; setPercentageInputs((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? String(equal)]))) } }} disabled={busy} /><span>{memberLabel(member)}{member.user_id === userId ? ' (você)' : ''}</span></label>)}</fieldset>
    {splitMode === 'percentage' && participantIds.map((id) => <label key={id}>{memberLabel(members.find((member) => member.user_id === id)!)} · porcentagem<input type="number" min="0" max="100" step="0.01" value={percentageInputs[id] ?? ''} onChange={(event) => setPercentageInputs((current) => ({ ...current, [id]: event.target.value }))} disabled={busy} /></label>)}
    {splitMode === 'percentage' && <small>Soma informada: {totalPercent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%. Deve fechar em 100%.</small>}
    {splitMode === 'custom' && participantIds.map((id) => <label key={id}>{memberLabel(members.find((member) => member.user_id === id)!)} · valor<div className="money-input"><span>R$</span><input inputMode="decimal" value={customInputs[id] ?? ''} onChange={(event) => setCustomInputs((current) => ({ ...current, [id]: event.target.value }))} disabled={busy} /></div></label>)}
    {splitMode === 'equal' && <small>Na divisão igual, todos recebem a mesma cota arredondada para baixo; os centavos restantes ficam com quem pagou.</small>}
    <div className="form-two"><label>Quantidade de parcelas<input type="number" min="1" max="60" step="1" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} required disabled={busy} /></label><label>Primeiro vencimento<input type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} required disabled={busy} /></label></div>
    <label>Observações (opcional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} disabled={busy} /></label>
    {preview && !previewError && <div className="form-note"><strong>Prévia do rateio</strong>{preview.shares.map((share) => <div key={share.user_id}>{memberLabel(members.find((member) => member.user_id === share.user_id)!)}: {formatBrlCents(share.amount_cents)}</div>)}{preview.remainderCents > 0 && <p>Ajuste de {formatBrlCents(preview.remainderCents)} fica com quem pagou.</p>}<strong>Cronograma</strong>{installmentsPreview.map((part) => <div key={part.installment_number}>Parcela {part.installment_number}/{installmentsPreview.length}: {formatBrlCents(part.amount_cents)} · vence {new Date(`${part.due_date}T12:00:00`).toLocaleDateString('pt-BR')}</div>)}</div>}
    {previewError && <p className="auth-error" role="alert">{previewError}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button button-light" onClick={onBack} disabled={busy}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || activeMembers.length === 0 || !preview || Boolean(previewError) || includesFormerParticipant}>{busy ? 'Salvando…' : expense ? 'Salvar alterações' : 'Salvar despesa'} <span>→</span></button></div>
  </form>}</section>
}

function Login({ configured, onSignIn, busy, error }: {
  configured: boolean
  onSignIn: (email: string, password: string) => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSignIn(email.trim(), password)
  }

  return <section className="page-wrap form-wrap auth-wrap"><div className="brand auth-brand"><span className="brand-mark">s<span>.</span></span><span>split<span className="brand-accent">uai</span></span></div><div className="eyebrow">BEM-VINDE DE VOLTA</div><h1>Que bom te ver<span className="heading-dot">.</span></h1><p className="form-intro">Entre na sua conta para continuar dividindo.</p><form onSubmit={submit}><label>Seu e-mail<input type="email" autoComplete="username" placeholder="voce@email.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={!configured || busy} /></label><label>Senha<input type="password" autoComplete="current-password" placeholder="Sua senha" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!configured || busy} /></label><button className="button button-dark full-button" type="submit" disabled={!configured || busy}>{busy ? 'Entrando…' : 'Entrar'} <span>→</span></button>{!configured && <p className="auth-message" role="status">Autenticação não configurada neste ambiente. Novas contas continuam disponíveis somente por convite.</p>}{error && <p className="auth-error" role="alert">{error}</p>}<div className="login-footnote">O SplitUai é privado. O acesso é feito por convite; não há cadastro público.</div></form></section>
}

function PasswordSetup({ onSubmit, onSignOut, busy, error }: {
  onSubmit: (password: string) => Promise<void>
  onSignOut: () => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) {
      setValidationError('As senhas não conferem.')
      return
    }
    setValidationError(null)
    void onSubmit(password)
  }

  return <section className="page-wrap form-wrap auth-wrap"><div className="brand auth-brand"><span className="brand-mark">s<span>.</span></span><span>split<span className="brand-accent">uai</span></span></div><div className="eyebrow">CONVITE ACEITO</div><h1>Crie sua senha<span className="heading-dot">.</span></h1><p className="form-intro">Defina uma senha para entrar no SplitUai.</p><form onSubmit={submit}><label>Nova senha<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required disabled={busy} /></label><label>Confirme a senha<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={6} required disabled={busy} /></label><button className="button button-dark full-button" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'} <span>→</span></button>{(validationError || error) && <p className="auth-error" role="alert">{validationError ?? error}</p>}<button className="text-button auth-signout" type="button" onClick={() => void onSignOut()} disabled={busy}>Sair</button></form></section>
}

function MyInvitations({ invitations, onRefresh, onAccept }: { invitations: MyGroupInvitation[]; onRefresh: () => void; onAccept: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  async function accept(id: string) {
    setBusy(true); setError(null); setNotice(null)
    try { await onAccept(id); setNotice('Convite aceito. O grupo já está disponível em Meus grupos.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível aceitar este convite. Confira se ele ainda está válido e foi enviado para seu e-mail.') }
    finally { setBusy(false) }
  }
  return <section className="page-wrap"><div className="eyebrow">ESPAÇO PESSOAL</div><h1>Convites recebidos<span className="heading-dot">.</span></h1><p className="form-intro">Convites enviados ao e-mail da sua conta.</p>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}{invitations.length === 0 ? <div className="empty-expenses"><strong>Nenhum convite pendente.</strong><p>Quando alguém convidar o e-mail desta conta, ele aparecerá aqui.</p><button className="text-button" onClick={onRefresh}>Atualizar</button></div> : <div className="invitation-list">{invitations.map((invitation) => { const expired = invitation.status === 'expired' || new Date(invitation.expires_at) <= new Date(); return <div className="invitation-row" key={invitation.id}><div><strong>{invitation.group_name}</strong><small>{invitation.invited_email} · válido até {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}</small></div><span className={`invite-status status-${expired ? 'expired' : invitation.status}`}>{expired ? 'Expirado' : 'Pendente'}</span><button className="button button-dark" disabled={busy || expired} onClick={() => void accept(invitation.id)}>{busy ? 'Aceitando…' : 'Aceitar convite'}</button></div> })}</div>}</section>
}

function Account({ client, email, userId, onSignOut, busy }: { client: NonNullable<typeof supabase>; email: string; userId: string; onSignOut: () => Promise<void>; busy: boolean }) {
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void client.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle().then(async ({ data, error: queryError }) => {
      if (!active) return
      let profile = data
      let profileError = queryError
      if (imageColumnsMissing(queryError)) {
        const fallback = await client.from('profiles').select('username').eq('id', userId).maybeSingle()
        profile = fallback.data as typeof profile
        profileError = fallback.error
      }
      if (profileError) setError(profileError.message)
      setUsername(profile?.username ?? '')
      setAvatarUrl(profile?.avatar_url ?? null)
      setProfileLoading(false)
    })
    return () => { active = false }
  }, [client, userId])
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(null); setNotice(null)
    try {
      const saved = await setMyUsername(client, username)
      let nextAvatarUrl = avatarUrl
      if (avatarFile) {
        nextAvatarUrl = await uploadImage(client, `profiles/${userId}/avatar`, avatarFile)
        const { error: avatarError } = await client.from('profiles').update({ avatar_url: nextAvatarUrl }).eq('id', userId)
        if (avatarError) throw avatarError
        setAvatarUrl(nextAvatarUrl)
        setAvatarFile(null)
      }
      setUsername(saved)
      setNotice(`Perfil salvo como @${saved}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o identificador. Talvez ele já esteja em uso.')
    } finally { setSaving(false) }
  }
  return <section className="page-wrap form-wrap"><div className="eyebrow">SUA CONTA</div><h1>Minha conta<span className="heading-dot">.</span></h1><p className="form-intro">Seu e-mail fica visível apenas nesta área de conta e nos fluxos de convite.</p>{profileLoading ? <p className="auth-loading">Carregando perfil…</p> : <form onSubmit={(event) => void saveProfile(event)}><div className="profile-photo-editor"><div className="profile-photo-preview">{avatarFile ? <img src={URL.createObjectURL(avatarFile)} alt="Prévia da foto de perfil" /> : avatarUrl ? <img src={avatarUrl} alt="Foto de perfil atual" /> : username.slice(0,1).toUpperCase() || 'U'}</div><label>Foto de perfil<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} disabled={saving} /><small>JPG, PNG ou WebP · até 5 MB.</small></label></div><label>Identificador público<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" placeholder="ex.: ana_silva" required disabled={saving} /></label><small>Use de 3 a 24 letras sem acento, números ou sublinhados. Será exibido como @{username || 'usuario'}.</small><label>E-mail da conta<input value={email} readOnly /></label>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}<div className="form-actions"><button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar perfil'}</button><button className="button button-light" type="button" onClick={() => void onSignOut()} disabled={busy}>{busy ? 'Saindo…' : 'Sair da conta'}</button></div></form>}</section>
}

export default App
