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

type Page = 'groups' | 'group' | 'new-group' | 'expense' | 'account'

const expenses = [
  { icon: '🏡', title: 'Casa da praia', detail: 'Ana pagou · 4 pessoas', amount: 'R$ 680,00', color: 'peach' },
  { icon: '🛒', title: 'Mercado', detail: 'Você pagou · 5 pessoas', amount: 'R$ 247,35', color: 'mint' },
  { icon: '🍕', title: 'Pizza de sexta', detail: 'Rafa pagou · 5 pessoas', amount: 'R$ 126,00', color: 'lavender' },
]

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
        {page === 'group' && selectedGroupId && supabase && <Group key={selectedGroupId} client={supabase} groupId={selectedGroupId} userId={session.user.id} onBack={() => setPage('groups')} onExpense={() => setPage('expense')} />}
        {page === 'group' && !selectedGroupId && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'expense' && <Expense groupName={groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo'} onBack={() => setPage('group')} />}
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
    <div className="demo-banner">Grupos e participantes são compartilhados. As despesas e os saldos ainda são demonstrativos.</div>
    <div className="eyebrow">SEU ESPAÇO COMPARTILHADO</div>
    <div className="page-heading"><div><h1>Seus grupos<span className="heading-dot">.</span></h1><p>Grupos dos quais sua conta participa.</p></div><div className="heading-actions"><button className="button button-light" onClick={onRefresh} disabled={loading}>Atualizar</button><button className="button button-dark" onClick={onCreate}><span>＋</span> Novo grupo</button></div></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>Grupos</h2><p>{loading ? 'Carregando…' : `${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'}`}</p></div></div>
    <div className="group-grid">
      {groups.map((group, index) => <button className="group-card" key={group.id} onClick={() => onOpen(group.id)}><div className={`group-cover ${index % 2 === 0 ? 'cover-coast' : 'cover-dinner'}`}><span className="cover-tag">GRUPO</span><span className="cover-emoji">{index % 2 === 0 ? '✳' : '◌'}</span><div className="cover-caption">CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div></div><div className="group-card-body"><div className="group-title-line"><h3>{group.name}</h3><span className="arrow-circle">↗</span></div><p>{group.description || 'Organize as despesas com seus participantes.'}</p><div className="group-meta"><span>{group.created_by ? 'Grupo compartilhado' : 'Grupo'}</span><span className="meta-divider" /><span>Despesas demonstrativas</span></div></div></button>)}
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

function Group({ client, groupId, userId, onBack, onExpense }: { client: NonNullable<typeof supabase>; groupId: string; userId: string; onBack: () => void; onExpense: () => void }) {
  const [group, setGroup] = useState<GroupRecord | null>(null)
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const [invitations, setInvitations] = useState<GroupInvitationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const isAdmin = members.some((member) => member.user_id === userId && member.role === 'admin')

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
        if (!active) return
        const currentGroup = groupData as GroupRecord
        setGroup(currentGroup)
        setName(currentGroup.name)
        setDescription(currentGroup.description ?? '')
        setMembers(memberData)
        setInvitations(inviteData)
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

  if (loading) return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><p className="auth-loading">Carregando grupo…</p></section>
  if (error && !group) return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><p className="auth-error" role="alert">{error}</p></section>
  if (!group) return null

  return <section className="page-wrap"><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><div className="demo-banner">Participantes e informações do grupo são reais. Despesas e saldos abaixo continuam demonstrativos.</div><div className="detail-hero"><div><div className="eyebrow">GRUPO · CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div>{editing ? <form className="group-edit-form" onSubmit={(event) => void saveDetails(event)}><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></label><div className="form-actions"><button type="button" className="button button-light" onClick={() => { setName(group.name); setDescription(group.description ?? ''); setEditing(false) }}>Cancelar</button><button className="button button-dark" disabled={busy}>Salvar</button></div></form> : <><h1>{group.name}<span className="heading-dot">.</span></h1><p>{group.description || 'Organize as despesas com seus participantes.'}</p>{isAdmin && <button className="text-button" onClick={() => setEditing(true)}>Editar informações</button>}</>}<div className="detail-people"><span>{members.length} {members.length === 1 ? 'participante' : 'participantes'} · Seu papel: {isAdmin ? 'admin' : 'membro'}</span></div></div><div className="detail-illustration">✳</div></div>{error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>Participantes</h2><p>Somente integrantes deste grupo aparecem aqui.</p></div></div><div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}><span className="avatar avatar-you">{(member.display_name?.[0] ?? 'P').toUpperCase()}</span><span className="member-name">{member.display_name || 'Participante'}</span><span className="role-badge">{member.role === 'admin' ? 'Administrador' : 'Membro'}</span></div>)}</div>
    {isAdmin && <><div className="section-title"><div><h2>Convites</h2><p>Crie o registro e depois envie o e-mail pelo painel Auth.</p></div></div><div className="invite-panel"><form className="invite-form" onSubmit={(event) => void invite(event)}><label>E-mail da pessoa<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="pessoa@email.com" disabled={busy} /></label><button className="button button-dark" disabled={busy}>{busy ? 'Criando…' : 'Criar convite'}</button></form><p className="invite-help">Após criar, no projeto Supabase correto, abra Authentication → Users → Add user → Send invitation e use este mesmo e-mail. O trigger do banco associa a conta ao grupo quando a conta Auth é criada. Nenhum e-mail é enviado pelo app.</p>{notice && <p className="auth-message" role="status">{notice}</p>}{invitations.length > 0 && <div className="invitation-list">{invitations.map((invitation) => <div className="invitation-row" key={invitation.id}><div><strong>{invitation.invited_email}</strong><small>Expira em {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}</small></div><span className={`invite-status status-${invitation.status}`}>{invitation.status === 'pending' ? 'Pendente' : invitation.status === 'sent' ? 'Enviado' : invitation.status === 'revoked' ? 'Revogado' : 'Expirado'}</span></div>)}</div>}</div></>}
    <div className="detail-stats"><div><small>GASTOS DO GRUPO</small><strong>Demonstrativo</strong></div><div><small>PARTICIPANTES</small><strong>{members.length}</strong></div><div><small>SEU PAPEL</small><strong>{isAdmin ? 'Administrador' : 'Membro'}</strong></div><button className="button button-dark" onClick={onExpense}><span>＋</span> Ver despesas demo</button></div><div className="section-title detail-section-title"><div><h2>Despesas</h2><p>Exemplos visuais; ainda não são dados compartilhados.</p></div></div><div className="expense-list">{expenses.map((expense) => <div className="expense-row" key={expense.title}><span className={`expense-icon ${expense.color}`}>{expense.icon}</span><div className="expense-name"><strong>{expense.title}</strong><small>{expense.detail}</small></div><strong className="expense-amount">{expense.amount}</strong><span className="row-arrow">›</span></div>)}</div></section>
}

function Expense({ groupName, onBack }: { groupName: string; onBack: () => void }) {
  return <section className="page-wrap form-wrap"><button className="back-link" onClick={onBack}>← Voltar ao grupo</button><div className="demo-banner">Esta tela é demonstrativa e não salva despesas.</div><div className="eyebrow">{groupName}</div><h1>Nova despesa<span className="heading-dot">.</span></h1><p className="form-intro">Anote aqui que a gente divide direitinho.</p><form onSubmit={(event) => { event.preventDefault(); onBack() }}><label>O que foi?<input placeholder="Ex.: almoço na praia" /></label><div className="form-two"><label>Quanto?<div className="money-input"><span>R$</span><input placeholder="0,00" inputMode="decimal" /></div></label><label>Quem pagou?<select defaultValue="you"><option value="you">Você</option><option>Ana</option><option>Rafa</option><option>Marina</option></select></label></div><label>Categoria<select defaultValue="food"><option value="food">🍴 Alimentação</option><option>🏡 Hospedagem</option><option>🚗 Transporte</option><option>🎟️ Atividades</option><option>✳ Outros</option></select></label><div className="form-note"><span>✳</span> A divisão igualitária entre as pessoas do grupo fica pronta automaticamente.</div><div className="form-actions"><button type="button" className="button button-light" onClick={onBack}>Cancelar</button><button type="submit" className="button button-dark">Salvar despesa <span>→</span></button></div></form></section>
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
