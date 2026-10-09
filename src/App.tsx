import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  createGroup,
  createGroupInvitation,
  getGroupMembers,
  listGroupInvitations,
  listMyGroups,
  updateGroup,
  type GroupInvitationRecord,
  type GroupMemberView,
  type GroupRecord,
} from './lib/groups'
import {
  createExpense,
  calculateBalances,
  deleteExpense,
  formatBrlCents,
  listGroupExpenses,
  parseBrlCents,
  splitEvenly,
  suggestSettlements,
  updateExpense,
  type ExpenseCategory,
  type ExpenseRecord,
} from './lib/expenses'

type Page = 'groups' | 'group' | 'new-group' | 'expense' | 'account'

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
  }, [session?.user.id])

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
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">✳</span><strong>Dividir fica leve.</strong><p>Organize os gastos e aproveite o que importa.</p></div>
          <div className="profile"><div className="avatar avatar-you">{session.user.email?.[0]?.toUpperCase() ?? 'V'}</div><div className="profile-details"><strong title={session.user.email ?? ''}>{session.user.email}</strong><small>Conta convidada</small></div></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Espaço pessoal <span>/</span> <strong>{page === 'account' ? 'Minha conta' : page === 'expense' ? 'Nova despesa' : page === 'group' ? groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo' : page === 'new-group' ? 'Novo grupo' : 'Meus grupos'}</strong></div><div className="topbar-account"><span title={session.user.email ?? ''}>{session.user.email}</span><button className="sign-out-button" onClick={() => void signOut()} disabled={authBusy}>Sair</button></div></header>

        {page === 'groups' && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'new-group' && <NewGroup onBack={() => setPage('groups')} onCreate={saveNewGroup} />}
        {page === 'group' && selectedGroupId && supabase && <Group key={selectedGroupId} client={supabase} groupId={selectedGroupId} userId={session.user.id} onBack={() => setPage('groups')} onAddExpense={() => { setEditingExpense(null); setPage('expense') }} onEditExpense={(expense) => { setEditingExpense(expense); setPage('expense') }} />}
        {page === 'group' && !selectedGroupId && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'expense' && selectedGroupId && supabase && <Expense client={supabase} groupId={selectedGroupId} groupName={groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo'} userId={session.user.id} expense={editingExpense} onBack={() => { setEditingExpense(null); setPage('group') }} onSaved={() => { setEditingExpense(null); setPage('group') }} />}
        {page === 'account' && <Account email={session.user.email ?? ''} onSignOut={signOut} busy={authBusy} />}
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
  return <section className="page-wrap">
    <div className="demo-banner">Grupos, participantes e despesas são compartilhados. Os saldos ainda serão implementados.</div>
    <div className="eyebrow">SEU ESPAÇO COMPARTILHADO</div>
    <div className="page-heading"><div><h1>Seus grupos<span className="heading-dot">.</span></h1><p>Grupos dos quais sua conta participa.</p></div><div className="heading-actions"><button className="button button-light" onClick={onRefresh} disabled={loading}>Atualizar</button><button className="button button-dark" onClick={onCreate}><span>＋</span> Novo grupo</button></div></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>Grupos</h2><p>{loading ? 'Carregando…' : `${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'}`}</p></div></div>
    <div className="group-grid">
      {groups.map((group, index) => <button className="group-card" key={group.id} onClick={() => onOpen(group.id)}><div className={`group-cover ${index % 2 === 0 ? 'cover-coast' : 'cover-dinner'}`}><span className="cover-tag">GRUPO</span><span className="cover-emoji">{index % 2 === 0 ? '✳' : '◌'}</span><div className="cover-caption">CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div></div><div className="group-card-body"><div className="group-title-line"><h3>{group.name}</h3><span className="arrow-circle">↗</span></div><p>{group.description || 'Organize as despesas com seus participantes.'}</p><div className="group-meta"><span>{group.created_by ? 'Grupo compartilhado' : 'Grupo'}</span><span className="meta-divider" /><span>Despesas compartilhadas</span></div></div></button>)}
      {!loading && groups.length === 0 && <div className="empty-state"><strong>Você ainda não participa de um grupo.</strong><p>Crie o primeiro para começar a organizar os participantes.</p><button className="button button-dark" onClick={onCreate}><span>＋</span> Criar grupo</button></div>}
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const isAdmin = members.some((member) => member.user_id === userId && member.role === 'admin')
  const balances = calculateBalances(groupExpenses, members.map((member) => member.user_id))
  const settlements = suggestSettlements(balances)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const { data: groupData, error: groupError } = await client.from('groups')
          .select('id, name, description, created_by, created_at').eq('id', groupId).maybeSingle()
        if (groupError) throw groupError
        if (!groupData) throw new Error('Este grupo não existe ou sua conta não tem acesso.')
        const [memberData, inviteData] = await Promise.all([
          getGroupMembers(client, groupId),
          listGroupInvitations(client, groupId),
        ])
        const expenseData = await listGroupExpenses(client, groupId)
        if (!active) return
        const currentGroup = groupData as GroupRecord
        setGroup(currentGroup)
        setName(currentGroup.name)
        setDescription(currentGroup.description ?? '')
        setMembers(memberData)
        setInvitations(inviteData)
        setGroupExpenses(expenseData)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o grupo.')
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
      const updated = await updateGroup(client, groupId, { name, description })
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
      const created = await createGroupInvitation(client, userId, groupId, email)
      setInvitations((current) => [created, ...current])
      setEmail('')
      setNotice(`Convite pendente criado para ${created.invited_email}. Agora envie o convite Auth pelo painel Supabase; o app não envia e-mail.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar o convite. Verifique se já há um convite pendente para este e-mail.')
    } finally {
      setBusy(false)
    }
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

  if (loading) return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><p className="auth-loading">Carregando grupo…</p></section>
  if (error && !group) return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><p className="auth-error" role="alert">{error}</p></section>
  if (!group) return null

  return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><div className="detail-hero"><div><div className="eyebrow">GRUPO · CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div>{editing ? <form className="group-edit-form" onSubmit={(event) => void saveDetails(event)}><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></label><div className="form-actions"><button type="button" className="button button-light" onClick={() => { setName(group.name); setDescription(group.description ?? ''); setEditing(false) }}>Cancelar</button><button className="button button-dark" disabled={busy}>Salvar</button></div></form> : <><h1>{group.name}<span className="heading-dot">.</span></h1><p>{group.description || 'Organize as despesas com seus participantes.'}</p>{isAdmin && <button className="text-button" onClick={() => setEditing(true)}>Editar informações</button>}</>}<div className="detail-people"><span>{members.length} {members.length === 1 ? 'participante' : 'participantes'} · Seu papel: {isAdmin ? 'admin' : 'membro'}</span></div></div><div className="detail-illustration">✳</div></div>{error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>Participantes</h2><p>Somente integrantes deste grupo aparecem aqui.</p></div></div><div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}><span className="avatar avatar-you">{(member.display_name?.[0] ?? 'P').toUpperCase()}</span><span className="member-name">{member.display_name || 'Participante'}</span><span className="role-badge">{member.role === 'admin' ? 'Administrador' : 'Membro'}</span></div>)}</div>
    {isAdmin && <><div className="section-title"><div><h2>Convites</h2><p>Crie o registro e depois envie o e-mail pelo painel Auth.</p></div></div><div className="invite-panel"><form className="invite-form" onSubmit={(event) => void invite(event)}><label>E-mail da pessoa<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="pessoa@email.com" disabled={busy} /></label><button className="button button-dark" disabled={busy}>{busy ? 'Criando…' : 'Criar convite'}</button></form><p className="invite-help">Após criar, no projeto Supabase correto, abra Authentication → Users → Add user → Send invitation e use este mesmo e-mail. O trigger do banco associa a conta ao grupo quando a conta Auth é criada. Nenhum e-mail é enviado pelo app.</p>{notice && <p className="auth-message" role="status">{notice}</p>}{invitations.length > 0 && <div className="invitation-list">{invitations.map((invitation) => <div className="invitation-row" key={invitation.id}><div><strong>{invitation.invited_email}</strong><small>Expira em {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}</small></div><span className={`invite-status status-${invitation.status}`}>{invitation.status === 'pending' ? 'Pendente' : invitation.status === 'sent' ? 'Enviado' : invitation.status === 'revoked' ? 'Revogado' : 'Expirado'}</span></div>)}</div>}</div></>}
    <div className="detail-stats"><div><small>DESPESAS DO GRUPO</small><strong>{groupExpenses.length}</strong></div><div><small>PARTICIPANTES</small><strong>{members.length}</strong></div><div><small>SEU PAPEL</small><strong>{isAdmin ? 'Administrador' : 'Membro'}</strong></div><button className="button button-dark" onClick={onAddExpense}><span>＋</span> Nova despesa</button></div>
    <div className="section-title detail-section-title"><div><h2>Saldos</h2><p>Saldo líquido: o que cada pessoa pagou menos sua parte nas despesas.</p></div></div>
    <div className="balance-list">{balances.map((balance) => { const member = members.find((item) => item.user_id === balance.user_id); return <div className="balance-row" key={balance.user_id}><span>{member?.display_name || 'Participante'}</span><strong className={balance.balance_cents > 0 ? 'balance-positive' : balance.balance_cents < 0 ? 'balance-negative' : ''}>{balance.balance_cents > 0 ? 'Recebe ' : balance.balance_cents < 0 ? 'Deve ' : ''}{formatBrlCents(Math.abs(balance.balance_cents))}</strong></div> })}</div>
    <div className="settlement-panel"><h3>Sugestões de acerto</h3>{settlements.length ? <div className="settlement-list">{settlements.map((item, index) => { const from = members.find((member) => member.user_id === item.from_user_id)?.display_name || 'Participante'; const to = members.find((member) => member.user_id === item.to_user_id)?.display_name || 'Participante'; return <div className="balance-row" key={`${item.from_user_id}-${item.to_user_id}-${index}`}><span>{from} paga para {to}</span><strong>{formatBrlCents(item.amount_cents)}</strong></div> })}</div> : <p>Todos estão em dia. Não há transferências sugeridas.</p>}<small>São sugestões calculadas a partir das despesas registradas; não confirmam pagamentos feitos.</small></div>
    <div className="section-title detail-section-title"><div><h2>Despesas</h2><p>Registros compartilhados com os participantes deste grupo.</p></div></div><div className="expense-list">{groupExpenses.length === 0 ? <div className="empty-expenses"><strong>Nenhuma despesa ainda.</strong><p>Registre a primeira para dividir o total com o grupo.</p></div> : groupExpenses.map((expense) => { const payer = members.find((member) => member.user_id === expense.paid_by)?.display_name || 'Participante'; return <div className="expense-row" key={expense.id}><span className={`expense-icon ${expense.category === 'hospedagem' ? 'peach' : expense.category === 'alimentacao' ? 'mint' : 'lavender'}`}>{expense.category === 'hospedagem' ? '🏡' : expense.category === 'alimentacao' ? '🍴' : expense.category === 'transporte' ? '🚗' : expense.category === 'atividades' ? '🎟️' : '✳'}</span>{isAdmin ? <button className="expense-name expense-open" onClick={() => onEditExpense(expense)}><strong>{expense.description}</strong><small>{payer} pagou · {new Date(`${expense.expense_date}T12:00:00`).toLocaleDateString('pt-BR')} · {expense.shares.length} {expense.shares.length === 1 ? 'pessoa' : 'pessoas'}</small></button> : <div className="expense-name"><strong>{expense.description}</strong><small>{payer} pagou · {new Date(`${expense.expense_date}T12:00:00`).toLocaleDateString('pt-BR')} · {expense.shares.length} {expense.shares.length === 1 ? 'pessoa' : 'pessoas'}</small></div>}<strong className="expense-amount">{formatBrlCents(expense.amount_cents)}</strong>{isAdmin && <><button className="expense-edit" aria-label={`Editar ${expense.description}`} onClick={() => onEditExpense(expense)}>Editar</button><button className="expense-delete" aria-label={`Excluir ${expense.description}`} onClick={() => void removeExpense(expense)}>×</button></>}</div> })}</div></section>
}

function Expense({ client, groupId, groupName, userId, expense, onBack, onSaved }: { client: NonNullable<typeof supabase>; groupId: string; groupName: string; userId: string; expense: ExpenseRecord | null; onBack: () => void; onSaved: () => void }) {
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(expense ? `${Math.floor(expense.amount_cents / 100)},${String(expense.amount_cents % 100).padStart(2, '0')}` : '')
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? userId)
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'outros')
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [participantIds, setParticipantIds] = useState<string[]>(expense?.shares.map((share) => share.user_id) ?? [])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getGroupMembers(client, groupId).then((rows) => {
      if (!active) return
      setMembers(rows)
      if (!expense) {
        setParticipantIds(rows.map((member) => member.user_id))
        if (rows.some((member) => member.user_id === userId)) setPaidBy(userId)
        else if (rows[0]) setPaidBy(rows[0].user_id)
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os participantes.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [client, groupId, expense, userId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const amountCents = parseBrlCents(amount)
      const shares = splitEvenly(amountCents, participantIds)
      const values = { description, category, amountCents, paidBy, expenseDate, notes, shares }
      if (expense) await updateExpense(client, expense.id, values)
      else await createExpense(client, groupId, values)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a despesa.')
    } finally {
      setBusy(false)
    }
  }

  const parsedAmount = (() => { try { return parseBrlCents(amount) } catch { return null } })()
  const preview = parsedAmount && participantIds.length ? splitEvenly(parsedAmount, participantIds) : []
  const previewMin = preview.length ? Math.min(...preview.map((share) => share.amount_cents)) : 0
  const previewMax = preview.length ? Math.max(...preview.map((share) => share.amount_cents)) : 0

  return <section className="page-wrap form-wrap"><button className="back-link" onClick={onBack}>← Voltar ao grupo</button><div className="eyebrow">{groupName}</div><h1>{expense ? 'Editar despesa' : 'Nova despesa'}<span className="heading-dot">.</span></h1><p className="form-intro">Registre o gasto e divida cada centavo com o grupo.</p>{loading ? <p className="auth-loading">Carregando participantes…</p> : <form onSubmit={(event) => void submit(event)}><label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} required placeholder="Ex.: almoço na praia" disabled={busy} /></label><div className="form-two"><label>Valor total<div className="money-input"><span>R$</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required placeholder="0,00" disabled={busy} /></div></label><label>Quem pagou?<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} required disabled={busy}><option value="" disabled>Selecione</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || 'Participante'}{member.user_id === userId ? ' (você)' : ''}</option>)}</select></label></div><div className="form-two"><label>Categoria<select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)} disabled={busy}><option value="alimentacao">🍴 Alimentação</option><option value="hospedagem">🏡 Hospedagem</option><option value="transporte">🚗 Transporte</option><option value="atividades">🎟️ Atividades</option><option value="outros">✳ Outros</option></select></label><label>Data<input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required disabled={busy} /></label></div><fieldset className="participant-picker"><legend>Dividir com</legend>{members.map((member) => <label key={member.user_id}><input type="checkbox" checked={participantIds.includes(member.user_id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} disabled={busy} /><span>{member.display_name || 'Participante'}{member.user_id === userId ? ' (você)' : ''}</span></label>)}{members.length === 0 && <p>Este grupo não tem participantes.</p>}</fieldset><label>Observações (opcional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} disabled={busy} /></label>{preview.length > 0 && <div className="form-note"><span>✳</span> Cada pessoa fica com {formatBrlCents(previewMin)}{previewMax > previewMin ? ` ou ${formatBrlCents(previewMax)}` : ''}. A soma fecha em {formatBrlCents(parsedAmount!)}.</div>}{error && <p className="auth-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button button-light" onClick={onBack} disabled={busy}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || members.length === 0}>{busy ? 'Salvando…' : expense ? 'Salvar alterações' : 'Salvar despesa'} <span>→</span></button></div></form>}</section>
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

function Account({ email, onSignOut, busy }: { email: string; onSignOut: () => Promise<void>; busy: boolean }) {
  return <section className="page-wrap form-wrap"><div className="eyebrow">SUA CONTA</div><h1>Minha conta<span className="heading-dot">.</span></h1><p className="form-intro">Sessão iniciada como {email}.</p><div className="form-actions"><button className="button button-light" onClick={() => void onSignOut()} disabled={busy}>{busy ? 'Saindo…' : 'Sair da conta'}</button></div></section>
}

export default App
