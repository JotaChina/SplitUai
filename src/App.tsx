import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  createGroup,
  createGroupInvitation,
  createGroupInvitationForFriend,
  manageGroupInvitation,
  sendGroupInvitationEmail,
  updateGroupMember,
  removeGroupMember,
  listMyGroupInvitations,
  acceptGroupInvitation,
  declineGroupInvitation,
  deleteEmptyGroup,
  getGroupMembers,
  listGroupInvitations,
  listMyGroups,
  updateGroup,
  setGroupArchived,
  setMyUsername,
  getProfile,
  setMyPixKey,
  uploadImage,
  imageColumnsMissing,
  type GroupInvitationRecord,
  type GroupMemberView,
  type GroupRecord,
  type GroupProfileRecord,
  type MyGroupInvitation,
} from './lib/groups'
import {
  createExpense,
  createRecurringExpense,
  calculateBalances,
  generateMonthlySchedule,
  deleteExpense,
  formatBrlCents,
  allocatePercentage,
  listGroupExpenses,
  listGroupSettlements,
  createGroupSettlement,
  markGroupSettlementPaid,
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
  suggestExpenseCategory,
} from './lib/expenses'
import { parseSplitwiseCsv, type SplitwiseCsvPreview } from './lib/splitwiseCsv'
import { listMyFriendships, manageFriendship, searchFriendByUsername, type FriendSearchResult, type FriendshipView } from './lib/friendships'

type Page = 'groups' | 'group' | 'new-group' | 'expense' | 'account' | 'invitations' | 'profile' | 'friends' | 'notifications'
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
type ColorTheme = 'green' | 'red' | 'pink'
type ChartCategory = ExpenseCategory | 'contas_da_casa' | 'transporte_grupo'
type GroupImageFocus = { x: number; y: number }
const houseBillCategories: ExpenseCategory[] = ['aluguel', 'luz', 'agua', 'iptu', 'internet']
const transportCategories: ExpenseCategory[] = ['transporte_gasolina', 'transporte_aluguel_veiculo', 'transporte_onibus', 'transporte_aviao', 'transporte_corrida_app', 'transporte_pedagio', 'transporte_multas', 'transporte_ipva', 'transporte_manutencao']
const categoryLabels: Record<ExpenseCategory, string> = { alimentacao: 'Alimentação', hospedagem: 'Hospedagem', transporte: 'Transporte', corrida: 'Corrida', atividades: 'Atividades', outros: 'Outros', aluguel: 'Aluguel', luz: 'Luz', agua: 'Água', iptu: 'IPTU', internet: 'Internet', viagens: 'Viagens', streaming: 'Streaming', fitness: 'Fitness', fatura_cartao: 'Fatura de cartão', acerto_outros_grupos: 'Acerto de outros grupos', transporte_gasolina: 'Gasolina', transporte_aluguel_veiculo: 'Aluguel de veículo', transporte_onibus: 'Ônibus', transporte_aviao: 'Avião', transporte_corrida_app: 'Corrida de app', transporte_pedagio: 'Pedágio', transporte_multas: 'Multas', transporte_ipva: 'IPVA', transporte_manutencao: 'Manutenção' }
const categoryEmojis: Record<ExpenseCategory, string> = { alimentacao: '🍴', hospedagem: '🏡', transporte: '🚗', corrida: '🍁', atividades: '🎟️', outros: '✳', aluguel: '🏠', luz: '💡', agua: '💧', iptu: '🏛️', internet: '🌐', viagens: '🧳', streaming: '📺', fitness: '🏋️', fatura_cartao: '💳', acerto_outros_grupos: '↔️', transporte_gasolina: '⛽', transporte_aluguel_veiculo: '🚙', transporte_onibus: '🚌', transporte_aviao: '✈️', transporte_corrida_app: '🚕', transporte_pedagio: '🛣️', transporte_multas: '🚨', transporte_ipva: '📄', transporte_manutencao: '🔧' }
const chartCategoryLabels: Record<ChartCategory, string> = { ...categoryLabels, contas_da_casa: 'Contas da Casa', transporte_grupo: 'Transporte' }
const settlementPaymentLabels: Record<SettlementPaymentMethod, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', transferencia: 'Transferência bancária', cartao: 'Cartão', outro: 'Outro', splitwise: 'Importado do Splitwise',
}
const brandLogoUrl = `${import.meta.env.BASE_URL}brand/splituai-graffiti.png?v=2`

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

function downloadGroupCsv(groupName: string, start: string, end: string, expenses: ExpenseRecord[], settlements: SettlementRecord[], members: GroupMemberView[]) {
  const safeCell = (value: string | number) => {
    const text = String(value)
    const protectedText = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text
    return `"${protectedText.replaceAll('"', '""')}"`
  }
  const memberName = (id: string) => {
    const person = members.find((member) => member.user_id === id)
    return person?.username ? `@${person.username}` : person?.display_name || id
  }
  const header = ['tipo', 'data', 'descricao', 'categoria', 'valor_centavos', 'quem_pagou', 'recebido_por', 'forma_pagamento', 'status']
  const rows: Array<Array<string | number>> = [header]
  for (const expense of expenses) {
    if (expense.expense_date < start || expense.expense_date > end) continue
    rows.push(['despesa', expense.expense_date, expense.description, categoryLabels[expense.category], expense.amount_cents, memberName(expense.paid_by), '', '', ''])
  }
  for (const settlement of settlements) {
    if (settlement.settlement_date < start || settlement.settlement_date > end) continue
    rows.push(['acerto', settlement.settlement_date, settlement.description, '', settlement.amount_cents, memberName(settlement.paid_by), memberName(settlement.received_by), settlementPaymentLabels[settlement.payment_method] ?? settlement.payment_method, settlement.status === 'paid' ? 'pago' : 'pendente'])
  }
  const csv = `\uFEFF${rows.map((row) => row.map(safeCell).join(';')).join('\r\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `splituai-${groupName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${start}-${end}.csv`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function cropGroupImage(file: File, aspectRatio: number, focus: GroupImageFocus) {
  const imageUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = imageUrl
    await image.decode()
    const sourceRatio = image.naturalWidth / image.naturalHeight
    const sourceWidth = sourceRatio > aspectRatio ? image.naturalHeight * aspectRatio : image.naturalWidth
    const sourceHeight = sourceRatio > aspectRatio ? image.naturalHeight : image.naturalWidth / aspectRatio
    const sourceX = (image.naturalWidth - sourceWidth) * focus.x / 100
    const sourceY = (image.naturalHeight - sourceHeight) * focus.y / 100
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sourceWidth)
    canvas.height = Math.round(sourceHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Não foi possível preparar a imagem selecionada.')
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Não foi possível preparar a imagem selecionada.')), file.type))
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified })
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function GroupImageField({ label, file, onChange, shape, focus, onFocusChange }: {
  label: string; file: File | null; onChange: (file: File | null) => void
  shape: 'cover' | 'icon'; focus: GroupImageFocus; onFocusChange: (focus: GroupImageFocus) => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <div className={`group-image-control group-image-control-${shape}`}>
    <label>{label}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} /></label>
    {file && previewUrl && <>
      <div className={`group-image-preview group-image-preview-${shape}`}><img src={previewUrl} alt={`Prévia de ${label.toLocaleLowerCase('pt-BR')}`} style={{ objectPosition: `${focus.x}% ${focus.y}%` }} /></div>
      <div className="group-image-position"><label>Horizontal <input aria-label={`Enquadramento horizontal de ${label.toLocaleLowerCase('pt-BR')}`} type="range" min="0" max="100" value={focus.x} onChange={(event) => onFocusChange({ ...focus, x: Number(event.target.value) })} /></label><label>Vertical <input aria-label={`Enquadramento vertical de ${label.toLocaleLowerCase('pt-BR')}`} type="range" min="0" max="100" value={focus.y} onChange={(event) => onFocusChange({ ...focus, y: Number(event.target.value) })} /></label></div>
      <button type="button" className="text-button" onClick={() => onChange(null)}>Remover imagem selecionada</button>
    </>}
  </div>
}

function App() {
  const [page, setPage] = useState<Page>('groups')
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    const saved = window.localStorage.getItem('splituai-color-theme')
    return saved === 'red' || saved === 'pink' ? saved : 'green'
  })
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('splituai-dark-mode') === 'true')
  const [session, setSession] = useState<Session | null>(null)
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [passwordSetupMode, setPasswordSetupMode] = useState<'invite' | 'recovery' | null>(null)
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [targetNotificationRecordId, setTargetNotificationRecordId] = useState<string | null>(null)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null)
  const [myInvitations, setMyInvitations] = useState<MyGroupInvitation[]>([])
  const [accountProfile, setAccountProfile] = useState<GroupProfileRecord | null>(null)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const hadSession = useRef(false)

  useEffect(() => {
    document.documentElement.dataset.accent = colorTheme
    document.documentElement.dataset.mode = darkMode ? 'dark' : 'light'
    window.localStorage.setItem('splituai-color-theme', colorTheme)
    window.localStorage.setItem('splituai-dark-mode', String(darkMode))
  }, [colorTheme, darkMode])

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
    const authLinkType = new URLSearchParams(window.location.hash.slice(1)).get('type')
    const inviteLink = authLinkType === 'invite'
    const recoveryLink = authLinkType === 'recovery'
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' && hadSession.current) setAuthError('Sua sessão foi encerrada. Entre novamente para continuar.')
      hadSession.current = Boolean(nextSession)
      setSession(nextSession)
      setCheckingSession(false)
      if (event === 'PASSWORD_RECOVERY' && nextSession) setPasswordSetupMode('recovery')
      else if (inviteLink && nextSession) setPasswordSetupMode('invite')
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      setSession(data.session)
      hadSession.current = Boolean(data.session)
      setCheckingSession(false)
      if (error) setAuthError(error.message)
      if (recoveryLink && data.session) setPasswordSetupMode('recovery')
      else if (inviteLink && data.session) setPasswordSetupMode('invite')
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
      setAccountProfile(null)
      return
    }
    if (supabase) void getProfile(supabase, session.user.id).then(setAccountProfile).catch(() => setAccountProfile(null))
    void refreshGroups()
    if (supabase) void listMyGroupInvitations(supabase).then((invitations) => {
      setMyInvitations(invitations)
      const hasNotificationDestination = new URLSearchParams(window.location.search).has('group') || new URLSearchParams(window.location.search).has('tab')
      if (invitations.length > 0 && !hasNotificationDestination) setPage('invitations')
    }).catch(() => setMyInvitations([]))
  }, [session?.user.id])

  useEffect(() => {
    if (!session) return
    const targetGroup = new URLSearchParams(window.location.search).get('group')
    const targetTab = new URLSearchParams(window.location.search).get('tab')
    setTargetNotificationRecordId(new URLSearchParams(window.location.search).get('expense') ?? new URLSearchParams(window.location.search).get('settlement'))
    if (targetGroup) {
      setSelectedGroupId(targetGroup)
      setPage('group')
    } else if (targetTab === 'invitations') setPage('invitations')
    else if (targetTab === 'friends') setPage('friends')
  }, [session?.user.id])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((error) => console.warn('Service worker indisponível', error))
  }, [])

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const onAppInstalled = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  useEffect(() => {
    if (!supabase || !session) { setUnreadNotifications(0); return }
    let active = true
    const refresh = async () => {
      const { count } = await supabase!.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (active) setUnreadNotifications(count ?? 0)
    }
    void refresh()
    const channel = supabase.channel(`notifications:${session.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => void refresh()).subscribe()
    return () => { active = false; void supabase!.removeChannel(channel) }
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

  async function declineMyInvitation(id: string) {
    if (!supabase) throw new Error('Autenticação não configurada.')
    await declineGroupInvitation(supabase, id)
    await refreshMyInvitations()
  }

  async function signIn(identifier: string, password: string) {
    if (!supabase) return
    setAuthBusy(true)
    setAuthError(null)
    const { data, error } = await supabase.functions.invoke('username-auth', {
      body: { action: 'sign_in', identifier, password },
    })
    if (error || !data?.session) setAuthError('Não foi possível entrar. Confira seus dados ou tente novamente mais tarde.')
    else {
      const { error: sessionError } = await supabase.auth.setSession(data.session)
      if (sessionError) setAuthError('Não foi possível entrar. Confira seus dados ou tente novamente mais tarde.')
    }
    setAuthBusy(false)
  }

  async function recoverPassword(identifier: string) {
    if (!supabase) return
    setAuthBusy(true)
    setAuthError(null)
    const { error } = await supabase.functions.invoke('username-auth', {
      body: { action: 'recover', identifier, redirect_to: window.location.origin + window.location.pathname },
    })
    setAuthError(error ? 'Não foi possível processar a solicitação. Tente novamente mais tarde.' : 'Se a conta puder ser recuperada, você receberá instruções no e-mail cadastrado.')
    setAuthBusy(false)
  }

  async function signOut() {
    if (!supabase) return
    setAuthBusy(true)
    const { error } = await supabase.auth.signOut()
    setAuthError(error?.message ?? null)
    setPasswordSetupMode(null)
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
      setPasswordSetupMode(null)
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

  if (passwordSetupMode && session) {
    return <PasswordSetup mode={passwordSetupMode} onSubmit={setInvitedUserPassword} onSignOut={signOut} busy={authBusy} error={authError} />
  }

  if (!session) {
    return <Login configured={Boolean(supabase)} onSignIn={signIn} onRecover={recoverPassword} busy={authBusy} error={authError} />
  }

  const accountEmail = session.user.email || 'Conta autenticada'
  const accountName = accountProfile?.display_name || (accountProfile?.username ? `@${accountProfile.username}` : session.user.email?.split('@')[0] || 'Minha conta')
  const accountInitial = (accountProfile?.display_name || accountProfile?.username || accountEmail).replace(/^@/, '').slice(0, 1).toLocaleUpperCase('pt-BR') || 'U'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inicio" onClick={(event) => { event.preventDefault(); setPage('groups') }} aria-label="SplitUai — início">
          <img className="brand-logo" src={brandLogoUrl} alt="" /><span className="brand-name">Split<span>Uai</span></span>
        </a>
        <div className="side-label">MENU</div>
        <nav className="main-nav" aria-label="Navegação principal">
          <button aria-current={page === 'groups' || page === 'group' || page === 'new-group' || page === 'expense' ? 'page' : undefined} className={page === 'groups' || page === 'group' || page === 'new-group' || page === 'expense' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('groups')}>
            <span className="nav-icon" aria-hidden="true">▦</span> Meus grupos
          </button>
          <button aria-current={page === 'account' ? 'page' : undefined} className={page === 'account' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('account')}>
            <span className="nav-icon" aria-hidden="true">◎</span> Minha conta
          </button>
          <button aria-current={page === 'invitations' ? 'page' : undefined} className={page === 'invitations' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('invitations')}>
            <span className="nav-icon" aria-hidden="true">✉</span> Convites recebidos{myInvitations.length > 0 ? ` · ${myInvitations.length}` : ''}
          </button>
          <button aria-current={page === 'notifications' ? 'page' : undefined} className={page === 'notifications' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('notifications')}>
            <span className="nav-icon" aria-hidden="true">♢</span> Avisos{unreadNotifications > 0 ? ` · ${unreadNotifications}` : ''}
          </button>
          <button aria-current={page === 'friends' ? 'page' : undefined} className={page === 'friends' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('friends')}>
            <span className="nav-icon" aria-hidden="true">♡</span> Amizades
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><svg className="help-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2.5 22 21H2L12 2.5Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><path d="M8 16.5h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><strong>Dividir fica leve.</strong><p>Organize os gastos e aproveite o que importa.</p></div>
          <button className="profile" type="button" onClick={() => setPage('account')} aria-label="Abrir minha conta"><div className="avatar avatar-you">{accountProfile?.avatar_url ? <img src={accountProfile.avatar_url} alt="" /> : accountInitial}</div><div className="profile-details"><strong>{accountName}</strong><small>{accountEmail}</small></div></button>
        </div>
      </aside>

      <main className="main-content">
      <header className="topbar"><a className="mobile-brand" href="#inicio" onClick={(event) => { event.preventDefault(); setPage('groups') }} aria-label="SplitUai — início"><img className="brand-logo" src={brandLogoUrl} alt="" /><span className="brand-name">Split<span>Uai</span></span></a><div className="breadcrumb"><strong>{page === 'account' ? 'Minha conta' : page === 'expense' ? 'Nova despesa' : page === 'profile' ? 'Perfil' : page === 'friends' ? 'Amizades' : page === 'invitations' ? 'Convites recebidos' : page === 'notifications' ? 'Avisos' : page === 'group' ? groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo' : page === 'new-group' ? 'Novo grupo' : 'Meus grupos'}</strong></div><div className="topbar-account">{installPrompt && <button className="install-app-button" type="button" onClick={() => void installApp()}>Instalar app</button>}<button className="sign-out-button" onClick={() => void signOut()} disabled={authBusy}>Sair</button></div></header>

        {page === 'groups' && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'new-group' && <NewGroup onBack={() => setPage('groups')} onCreate={saveNewGroup} />}
        {page === 'group' && selectedGroupId && supabase && <Group key={selectedGroupId} client={supabase} groupId={selectedGroupId} targetRecordId={targetNotificationRecordId} userId={session.user.id} onBack={() => { void refreshGroups(); setPage('groups') }} onAddExpense={() => { setEditingExpense(null); setPage('expense') }} onEditExpense={(expense) => { setEditingExpense(expense); setPage('expense') }} onOpenProfile={(id) => { setProfileUserId(id); setPage('profile') }} />}
        {page === 'group' && !selectedGroupId && <Groups groups={groups} loading={groupsLoading} error={groupsError} onRefresh={() => void refreshGroups()} onOpen={(id) => { setSelectedGroupId(id); setPage('group') }} onCreate={() => setPage('new-group')} />}
        {page === 'expense' && selectedGroupId && supabase && <Expense client={supabase} groupId={selectedGroupId} groupName={groups.find((group) => group.id === selectedGroupId)?.name ?? 'Grupo'} userId={session.user.id} expense={editingExpense} onBack={() => { setEditingExpense(null); setPage('group') }} onSaved={() => { setEditingExpense(null); setPage('group') }} />}
        {page === 'account' && supabase && <Account client={supabase} email={session.user.email ?? ''} userId={session.user.id} onProfileChange={setAccountProfile} onSignOut={signOut} busy={authBusy} colorTheme={colorTheme} onColorThemeChange={setColorTheme} darkMode={darkMode} onDarkModeChange={setDarkMode} />}
        {page === 'profile' && supabase && profileUserId && <UserProfile client={supabase} userId={profileUserId} viewerId={session.user.id} onBack={() => setPage(selectedGroupId ? 'group' : 'groups')} onOpenGroup={(id) => { setSelectedGroupId(id); setPage('group') }} />}
        {page === 'invitations' && <MyInvitations invitations={myInvitations} onRefresh={() => void refreshMyInvitations()} onAccept={acceptMyInvitation} onDecline={declineMyInvitation} />}
        {page === 'friends' && supabase && <Friends client={supabase} userId={session.user.id} />}
        {page === 'notifications' && supabase && <NotificationCenter client={supabase} userId={session.user.id} onOpenGroup={(id, recordId) => { setTargetNotificationRecordId(recordId ?? null); setSelectedGroupId(id); setPage('group') }} />}
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
  return <section className="page-wrap" aria-busy={loading}>
    <div className="eyebrow">SEU ESPAÇO COMPARTILHADO</div>
    <div className="page-heading"><div><h1>Seus grupos<span className="heading-dot">.</span></h1><p>Grupos dos quais sua conta participa.</p></div><div className="heading-actions"><button className="button button-light" onClick={onRefresh} disabled={loading}>Atualizar</button><button className="button button-dark" onClick={onCreate}><span>＋</span> Novo grupo</button></div></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="section-title"><div><h2>{showArchived ? 'Grupos arquivados' : 'Grupos ativos'}</h2><p role="status" aria-live="polite">{loading ? 'Carregando grupos…' : `${visibleGroups.length} ${visibleGroups.length === 1 ? 'grupo' : 'grupos'}`}</p></div><div className="heading-actions"><button className="button button-light" onClick={() => setShowArchived(false)} aria-pressed={!showArchived}>Ativos ({groups.filter((group) => !group.archived_at).length})</button><button className="button button-light" onClick={() => setShowArchived(true)} aria-pressed={showArchived}>Arquivados ({groups.filter((group) => group.archived_at).length})</button></div></div>
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

function Group({ client, groupId, targetRecordId, userId, onBack, onAddExpense, onEditExpense, onOpenProfile }: { client: NonNullable<typeof supabase>; groupId: string; targetRecordId?: string | null; userId: string; onBack: () => void; onAddExpense: () => void; onEditExpense: (expense: ExpenseRecord) => void; onOpenProfile: (id: string) => void }) {
  const [group, setGroup] = useState<GroupRecord | null>(null)
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const [invitations, setInvitations] = useState<GroupInvitationRecord[]>([])
  const [friendsToInvite, setFriendsToInvite] = useState<FriendshipView[]>([])
  const [selectedFriendToInvite, setSelectedFriendToInvite] = useState('')
  const [groupExpenses, setGroupExpenses] = useState<ExpenseRecord[]>([])
  const [groupSettlements, setGroupSettlements] = useState<SettlementRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [iconFocus, setIconFocus] = useState<GroupImageFocus>({ x: 50, y: 50 })
  const [coverFocus, setCoverFocus] = useState<GroupImageFocus>({ x: 50, y: 50 })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [settlementFormOpen, setSettlementFormOpen] = useState(false)
  const [settlementNotice, setSettlementNotice] = useState<string | null>(null)
  const [settlementRecipient, setSettlementRecipient] = useState('')
  const [settlementAmount, setSettlementAmount] = useState('')
  const [settlementMethod, setSettlementMethod] = useState<Exclude<SettlementPaymentMethod, 'splitwise'>>('pix')
  const [settlementStatus, setSettlementStatus] = useState<'pending' | 'paid'>('paid')
  const [settlementDate, setSettlementDate] = useState(toDateInputValue(new Date()))
  const [splitwisePreview, setSplitwisePreview] = useState<SplitwiseCsvPreview | null>(null)
  const [splitwiseFileName, setSplitwiseFileName] = useState('')
  const [splitwiseMappings, setSplitwiseMappings] = useState<Record<string, string>>({})
  const [adminView, setAdminView] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | 'contas_da_casa' | 'transporte_grupo' | 'all'>('all')
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
  const allTimeDebtors = allBalances.filter((row) => row.balance_cents < 0)
  const hasOutstandingDebt = allTimeDebtors.length > 0
  const currentUserBalanceOutsideMonth = (allBalances.find((row) => row.user_id === userId)?.balance_cents ?? 0)
    - (monthBalances.find((row) => row.user_id === userId)?.balance_cents ?? 0)
  const weekBounds = reportPeriod === 'week' ? isoWeekBounds(reportWeek) : null
  const expenseDates = [...groupExpenses.map((expense) => expense.expense_date), ...groupSettlements.map((settlement) => settlement.settlement_date)].sort()
  const periodStart = reportPeriod === 'week' ? weekBounds?.start ?? '' : reportPeriod === 'month' ? `${reportMonth}-01` : reportPeriod === 'custom' ? rangeStart : expenseDates[0] ?? initialDateValue
  const periodEnd = reportPeriod === 'week' ? weekBounds?.end ?? '' : reportPeriod === 'month' && /^\d{4}-\d{2}$/.test(reportMonth)
    ? toDateInputValue(new Date(Number(reportMonth.slice(0, 4)), Number(reportMonth.slice(5, 7)), 0)) : reportPeriod === 'month' ? '' : reportPeriod === 'custom' ? rangeEnd : expenseDates[expenseDates.length - 1] ?? initialDateValue
  const validReportRange = Boolean(periodStart && periodEnd && periodStart <= periodEnd)
  const reportExpenses = validReportRange ? groupExpenses.filter((expense) => expense.expense_date >= periodStart && expense.expense_date <= periodEnd) : []
  const categoryTotals: { category: ChartCategory; all: number }[] = [
    ...(['alimentacao','hospedagem','corrida','atividades','outros','viagens','streaming','fitness','fatura_cartao','acerto_outros_grupos'] as ExpenseCategory[]).map((category) => ({
      category,
      all: reportExpenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amount_cents, 0),
    })),
    { category: 'contas_da_casa', all: reportExpenses.filter((expense) => houseBillCategories.includes(expense.category)).reduce((sum, expense) => sum + expense.amount_cents, 0) },
    { category: 'transporte_grupo', all: reportExpenses.filter((expense) => expense.category === 'transporte' || transportCategories.includes(expense.category)).reduce((sum, expense) => sum + expense.amount_cents, 0) },
  ]
  const visibleExpenses = categoryFilter === 'all' ? groupExpenses : groupExpenses.filter((expense) => categoryFilter === 'contas_da_casa' ? houseBillCategories.includes(expense.category) : categoryFilter === 'transporte_grupo' ? expense.category === 'transporte' || transportCategories.includes(expense.category) : expense.category === categoryFilter)
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
        const friendData = memberData.some((member) => member.user_id === userId && member.active && member.role === 'admin')
          ? await listMyFriendships(client)
          : []
        if (!active) return
        const currentGroup = groupData as GroupRecord
        setGroup(currentGroup)
        setName(currentGroup.name)
        setDescription(currentGroup.description ?? '')
        setMembers(memberData)
        setInvitations(inviteData)
        setFriendsToInvite(friendData.filter((friend) => friend.status === 'accepted' && !memberData.some((member) => member.user_id === friend.other_user_id && member.active)))
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

  useEffect(() => {
    if (!targetRecordId || loading) return
    const row = document.getElementById(`notification-record-${targetRecordId}`)
    if (!row) return
    const details = row.closest('details')
    if (details) details.open = true
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [targetRecordId, loading, groupExpenses, groupSettlements])

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const iconUrl = iconFile ? await uploadImage(client, `groups/${groupId}/icon`, await cropGroupImage(iconFile, 1, iconFocus)) : group?.icon_url
      const coverUrl = coverFile ? await uploadImage(client, `groups/${groupId}/cover`, await cropGroupImage(coverFile, 3.2, coverFocus)) : group?.cover_url
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

  async function inviteFriend() {
    if (!selectedFriendToInvite) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await createGroupInvitationForFriend(client, groupId, selectedFriendToInvite)
      setInvitations(await listGroupInvitations(client, groupId))
      setSelectedFriendToInvite('')
      setNotice('Convite enviado pela central do SplitUai. A pessoa precisará aceitá-lo para entrar no grupo.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : 'Não foi possível enviar o convite para essa amizade.'))
      setInvitations(await listGroupInvitations(client, groupId).catch(() => invitations))
    } finally { setBusy(false) }
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
    try { await updateGroupMember(client, groupId, member.user_id, role); setMembers(await getGroupMembers(client, groupId)) }
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
        status: settlementStatus,
      })
      setGroupSettlements(await listGroupSettlements(client, groupId))
      setSettlementFormOpen(false)
      setSettlementRecipient('')
      setSettlementAmount('')
      setSettlementDate(toDateInputValue(new Date()))
      setSettlementNotice(settlementStatus === 'paid' ? 'Pagamento confirmado. Os saldos do grupo foram atualizados.' : 'Acerto pendente registrado. Ele não altera os saldos até a confirmação do pagamento.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar o acerto.')
    } finally { setBusy(false) }
  }

  async function confirmSettlementPaid(settlement: SettlementRecord) {
    setBusy(true); setError(null)
    try {
      await markGroupSettlementPaid(client, settlement.id)
      setGroupSettlements(await listGroupSettlements(client, groupId))
      setSettlementNotice('Pagamento confirmado. Os saldos do grupo foram atualizados.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível confirmar o pagamento.')
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
  const memberLink = (id: string) => <button className="profile-link" onClick={() => onOpenProfile(id)} title="Abrir perfil">{memberLabel(id)}</button>
  const renderBalances = (rows: typeof allBalances) => <div className="balance-list">{rows.map((balance) => <div className="balance-row" key={balance.user_id}><span>{memberLink(balance.user_id)}</span><strong className={balance.balance_cents > 0 ? 'balance-positive' : balance.balance_cents < 0 ? 'balance-negative' : ''}>{balance.balance_cents > 0 ? 'Recebe ' : balance.balance_cents < 0 ? 'Deve ' : ''}{formatBrlCents(Math.abs(balance.balance_cents))}</strong></div>)}</div>
  const renderDebtBreakdown = (debtorId: string) => {
    const expenseContributions = groupExpenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      date: expense.expense_date,
      amount: (expense.paid_by === debtorId ? expense.amount_cents - expense.rounding_remainder_cents : 0)
        - (expense.shares.find((share) => share.user_id === debtorId)?.amount_cents ?? 0),
      kind: 'Despesa' as const,
      installments: expense.installments,
    })).filter((item) => item.amount !== 0)
    const settlementContributions = groupSettlements.filter((item) => item.status === 'paid' && [item.paid_by, item.received_by].includes(debtorId)).map((item) => ({
      id: item.id,
      description: item.description,
      date: item.settlement_date,
      amount: (item.paid_by === debtorId ? item.amount_cents : 0) - (item.received_by === debtorId ? item.amount_cents : 0),
      kind: 'Acerto pago' as const,
      installments: [],
    })).filter((item) => item.amount !== 0)
    const contributions = [...expenseContributions, ...settlementContributions].sort((a, b) => a.date.localeCompare(b.date))
    const pending = groupSettlements.filter((item) => item.status === 'pending' && [item.paid_by, item.received_by].includes(debtorId))
    return <details className="debt-breakdown"><summary>Ver composição do saldo de {memberLabel(debtorId)}</summary><p>Saldo calculado = despesas + acertos pagos. Valores verdes aumentaram o crédito; valores vermelhos aumentaram a dívida.</p><div className="settlement-list">{contributions.map((item) => <div className="balance-row debt-contribution" key={`${item.kind}-${item.id}`}><span><strong>{item.description}</strong><small>{item.kind} · {new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}{item.installments.length > 1 ? ` · ${item.installments.length} parcelas: ${item.installments.map((part) => `${formatBrlCents(part.amount_cents)} (${new Date(`${part.due_date}T12:00:00`).toLocaleDateString('pt-BR')})`).join(', ')}` : ''}</small></span><strong className={item.amount > 0 ? 'balance-positive' : 'balance-negative'}>{item.amount > 0 ? '+' : '−'}{formatBrlCents(Math.abs(item.amount))}</strong></div>)}</div>{pending.length > 0 && <div className="pending-breakdown"><strong>Acertos pendentes · fora do saldo calculado</strong>{pending.map((item) => <div className="balance-row" key={item.id}><span><strong>{item.description}</strong><small>{memberLabel(item.paid_by)} → {memberLabel(item.received_by)} · previsto para {new Date(`${item.settlement_date}T12:00:00`).toLocaleDateString('pt-BR')}</small></span><strong>{formatBrlCents(item.amount_cents)}</strong></div>)}</div>}</details>
  }
  const installmentStatus = (dueDate: string) => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return dueDate < today ? 'Vencimento passado' : 'A vencer'
  }
  const renderExpenseRow = (expense: ExpenseRecord) => {
    const schedule = expense.installments.map((part) => `${formatBrlCents(part.amount_cents)} em ${new Date(`${part.due_date}T12:00:00`).toLocaleDateString('pt-BR')} (${installmentStatus(part.due_date)})`).join(' · ')
    const personalShare = expense.shares.find((share) => share.user_id === userId)?.amount_cents
    const personalPaid = expense.paid_by === userId ? expense.amount_cents - expense.rounding_remainder_cents : 0
    const personalNet = personalShare === undefined && expense.paid_by !== userId ? null : personalPaid - (personalShare ?? 0)
    return <div className="expense-row" id={`notification-record-${expense.id}`} key={expense.id}>
      <span className={`expense-icon category-${expense.category}`}>{categoryEmojis[expense.category]}</span>
      <div className="expense-name">{isAdmin ? <button className="expense-title-button" onClick={() => onEditExpense(expense)}>{expense.description}</button> : <strong>{expense.description}</strong>}<small>{memberLink(expense.paid_by)} pagou · {categoryLabels[expense.category]} · {expense.installments.length}x · {schedule}</small></div>
      <span className="expense-personal-position">{personalNet === null ? <small>Sem parte individual</small> : personalNet > 0 ? <strong className="balance-positive">A receber {formatBrlCents(personalNet)}</strong> : personalNet < 0 ? <strong className="balance-negative">A pagar {formatBrlCents(Math.abs(personalNet))}</strong> : <strong className="expense-settled">Parte individual quitada</strong>}<small>Total da despesa · {formatBrlCents(expense.amount_cents)}</small></span>
      {expense.rounding_remainder_cents > 0 && <small>Ajuste {formatBrlCents(expense.rounding_remainder_cents)} fica com quem pagou</small>}
      {isAdmin && <><button className="expense-edit" aria-label={`Editar ${expense.description}`} onClick={() => onEditExpense(expense)}>Editar</button><button className="expense-delete" aria-label={`Excluir ${expense.description}`} onClick={() => void removeExpense(expense)}>×</button></>}
    </div>
  }
  return <section className="page-wrap" aria-busy={busy}><button className="back-link" onClick={onBack}>← Voltar aos grupos</button><div className="detail-hero" style={group.cover_url ? { backgroundImage: `linear-gradient(90deg,rgba(18,28,17,.78),rgba(18,28,17,.2)),url("${group.cover_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><div><div className="eyebrow">{group.archived_at ? 'GRUPO ARQUIVADO' : 'GRUPO'} · CRIADO EM {new Date(group.created_at).toLocaleDateString('pt-BR')}</div>{editing ? <form className="group-edit-form" onSubmit={(event) => void saveDetails(event)}><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></label><div className="group-image-fields"><GroupImageField label="Foto do ícone" file={iconFile} onChange={setIconFile} shape="icon" focus={iconFocus} onFocusChange={setIconFocus} /><GroupImageField label="Foto de capa" file={coverFile} onChange={setCoverFile} shape="cover" focus={coverFocus} onFocusChange={setCoverFocus} /></div><small>Ajuste o enquadramento na prévia antes de salvar. JPG, PNG ou WebP · até 5 MB por imagem.</small><div className="form-actions"><button type="button" className="button button-light" onClick={() => { setName(group.name); setDescription(group.description ?? ''); setIconFile(null); setCoverFile(null); setEditing(false) }}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div></form> : <><div className="group-hero-title">{group.icon_url && <img className="group-icon-large" src={group.icon_url} alt="" />}<h1>{group.name}<span className="heading-dot">.</span></h1></div><p>{group.description || 'Organize as despesas com seus participantes.'}</p>{isAdmin && <button className="text-button" onClick={() => setEditing(true)}>Editar informações</button>}</>}<div className="detail-people"><span>{members.length} {members.length === 1 ? 'participante' : 'participantes'} · Seu papel: {isAdmin ? 'admin' : 'membro'}</span></div><div className="heading-actions">{isAdmin && <button className="button button-light" aria-pressed={adminView} onClick={() => setAdminView((value) => !value)}>{adminView ? 'Visão comum' : 'Visão de admin'}</button>}<button className="button button-light" onClick={() => void archiveGroup()} disabled={busy}>{group.archived_at ? 'Restaurar grupo' : 'Arquivar grupo'}</button>{canDeleteGroup && <button className="button button-light" onClick={() => void permanentlyDeleteGroup()} disabled={busy}>Excluir grupo</button>}</div>{groupExpenses.length > 0 && <small>Grupos com despesas podem ser arquivados; o histórico não pode ser apagado.</small>}</div>{!group.cover_url && <div className="detail-illustration">✳</div>}</div>{error && <p className="auth-error" role="alert">{error}</p>}
    <details className="group-collapsible" open><summary><span><strong>Participantes</strong><small>{members.length} pessoas · perfis, papéis e acesso</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}>{member.avatar_url ? <img className="avatar avatar-photo" src={member.avatar_url} alt="" /> : <span className="avatar avatar-you">{(member.username?.[0] ?? member.display_name?.[0] ?? 'P').toUpperCase()}</span>}<button className="member-name-button" onClick={() => onOpenProfile(member.user_id)} title="Abrir perfil">{member.username ? `@${member.username}` : member.display_name || 'Sem identificador'}{!member.active && <small> · Acesso encerrado</small>}</button><span className="role-badge">{member.role === 'admin' ? 'Administrador' : 'Membro'}</span>{isAdmin && member.active && member.user_id !== userId && <><select aria-label={`Papel de ${member.username ?? member.display_name ?? 'participante'}`} value={member.role} disabled={busy} onChange={(event) => void memberRole(member, event.target.value as 'admin' | 'member')}><option value="member">Membro</option><option value="admin">Administrador</option></select><button className="text-button" disabled={busy} onClick={() => void memberRemove(member)}>Remover</button></>}</div>)}</div></details>
    {isAdmin && <details className="group-collapsible"><summary><span><strong>Convites</strong><small>{invitations.length} convites · enviar e acompanhar acessos</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="invite-panel"><form className="invite-form" onSubmit={(event) => void invite(event)}><label>E-mail da pessoa<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="pessoa@email.com" disabled={busy} /></label><button className="button button-dark" disabled={busy}>{busy ? 'Enviando…' : 'Criar e enviar'}</button></form>{friendsToInvite.length > 0 && <div className="friend-invite"><label>Ou convide uma amizade<select value={selectedFriendToInvite} onChange={(event) => setSelectedFriendToInvite(event.target.value)} disabled={busy}><option value="">Selecione uma amizade</option>{friendsToInvite.map((friend) => <option key={friend.other_user_id} value={friend.other_user_id}>{friend.username ? `@${friend.username}` : friend.display_name || 'Pessoa usuária'}</option>)}</select></label><button className="button button-light" disabled={busy || !selectedFriendToInvite} onClick={() => void inviteFriend()}>{busy ? 'Enviando…' : 'Enviar convite'}</button><small>O convite aparece em Convites recebidos e gera um aviso no dispositivo, se o Push estiver ativado. A pessoa ainda precisa aceitar para entrar no grupo.</small></div>}<p className="invite-help">Para contas existentes, use o convite de amizade acima e dispense o e-mail. O campo de e-mail continua disponível para convidar quem ainda não usa o SplitUai.</p>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}{invitations.length > 0 && <div className="invitation-list">{invitations.map((invitation) => { const expired = ['pending','sent'].includes(invitation.status) && new Date(invitation.expires_at) <= new Date(); const status = expired ? 'expired' : invitation.status; const friend = friendsToInvite.find((item) => item.other_user_id === invitation.invited_user_id); const recipient = invitation.invited_user_id ? (friend?.username ? `@${friend.username}` : friend?.display_name || 'Amizade') : invitation.invited_email || 'Conta convidada'; return <div className="invitation-row" key={invitation.id}><div><strong>{recipient}</strong><small>Expira em {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}</small></div><span className={`invite-status status-${status}`}>{status === 'pending' ? 'Pendente' : status === 'sent' ? 'Enviado' : status === 'accepted' ? 'Aceito' : status === 'cancelled' ? 'Cancelado' : 'Expirado'}</span>{isAdmin && ['pending','sent'].includes(invitation.status) && !expired && <>{!invitation.invited_user_id && <button className="text-button" disabled={busy} onClick={() => void invitationAction(invitation,'send')}>{invitation.status === 'sent' ? 'Reenviar' : 'Enviar'}</button>}<button className="text-button" disabled={busy} onClick={() => void invitationAction(invitation,'cancel')}>Cancelar</button></>}</div> })}</div>}</div></details>}
    {isAdmin && adminView && <details className="group-collapsible admin-tools"><summary><span><strong>Ferramentas administrativas</strong><small>Importar histórico do Splitwise</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><section className="settlement-panel splitwise-import"><div><div className="eyebrow">VISÃO DE ADMIN</div><h3>Importar histórico do Splitwise</h3><p>Despesas entram como despesas e pagamentos entram como acertos, separados dos gráficos. Reimportar o mesmo arquivo não duplica os registros.</p></div><label>Arquivo CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void chooseSplitwiseFile(event.target.files?.[0])} /></label>{splitwisePreview && <><strong>{splitwiseFileName}: {splitwisePreview.expenses.length} despesas · {splitwisePreview.settlements.length} acertos · {splitwisePreview.skipped.length} linhas ignoradas</strong><div className="splitwise-mappings">{splitwisePreview.memberNames.map((person) => <label key={person}>{person}<select value={splitwiseMappings[person] ?? ''} onChange={(event) => setSplitwiseMappings((current) => ({ ...current, [person]: event.target.value }))}><option value="">Selecione participante</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username ? `@${member.username}` : member.display_name || 'Sem identificador'}{!member.active ? ' (acesso encerrado)' : ''}</option>)}</select></label>)}</div>{splitwisePreview.skipped.length > 0 && <details><summary>Ver linhas ignoradas</summary><ul>{splitwisePreview.skipped.map((row) => <li key={row.row}>Linha {row.row} · {row.description}: {row.reason}</li>)}</ul></details>}<div className="form-actions"><button className="button button-light" disabled={busy} onClick={() => setSplitwisePreview(null)}>Cancelar</button><button className="button button-dark" disabled={busy || splitwisePreview.expenses.length + splitwisePreview.settlements.length === 0} onClick={() => void importSplitwise()}>{busy ? 'Importando…' : 'Importar histórico'}</button></div></>}</section></details>}
    <div className="detail-stats"><div><small>DESPESAS DO GRUPO</small><strong>{groupExpenses.length}</strong></div><div><small>PARTICIPANTES</small><strong>{members.length}</strong></div>{hasOutstandingDebt && <div><small>VALOR DEVEDOR TOTAL</small><strong className="balance-negative">{formatBrlCents(allTimeDebtTotal)}</strong></div>}<button className="button button-dark" onClick={onAddExpense}><span>＋</span> Nova despesa</button></div>
    <details className="group-collapsible" open><summary><span><strong>Saldos em paralelo</strong><small>{hasOutstandingDebt ? 'Saldo do mês e resumo de todo o período' : 'Saldo do mês · histórico preservado abaixo'}</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="balance-columns"><section className="settlement-panel"><h3>Saldo do mês · {new Date(`${currentMonth}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>{renderBalances(monthBalances)}<strong className={monthDebtTotal > 0 ? 'balance-negative' : 'balance-positive'}>Total devedor do mês: {formatBrlCents(monthDebtTotal)}</strong><small className="balance-period-note">{currentUserBalanceOutsideMonth === 0 ? 'Seu saldo dos demais períodos está zerado.' : `Nos demais períodos, ${currentUserBalanceOutsideMonth < 0 ? 'você deve' : 'você recebe'} ${formatBrlCents(Math.abs(currentUserBalanceOutsideMonth))}.`}</small></section>{hasOutstandingDebt && <section className="settlement-panel all-time-balance"><h3>Saldo de todo o período · {group.name}</h3><p>Saldo calculado com despesas e acertos pagos. Acertos pendentes aparecem no histórico e não reduzem este valor.</p>{renderBalances(allBalances)}<strong className="balance-negative">Valor devedor total: {formatBrlCents(allTimeDebtTotal)}</strong>{allTimeDebtors.map((debtor) => <div key={debtor.user_id}>{renderDebtBreakdown(debtor.user_id)}</div>)}</section>}</div></details>
    <details className="settlement-panel group-collapsible" open><summary><span><strong>Sugestões e registro de acerto</strong><small>{settlements.length ? `${settlements.length} transferências sugeridas · todo o período` : 'Todos estão em dia'}</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="settlement-panel-content"><div className="settlement-panel-heading"><h3>Acertos do grupo</h3><button className="button button-dark" type="button" onClick={() => { setSettlementFormOpen((open) => !open); setError(null); setSettlementNotice(null) }}>{settlementFormOpen ? 'Cancelar acerto' : '＋ Acertar contas'}</button></div>{settlements.length ? <div className="settlement-list">{settlements.map((item, index) => <div className="balance-row" key={`${item.from_user_id}-${item.to_user_id}-${index}`}><span>{memberLink(item.from_user_id)} paga para {memberLink(item.to_user_id)}</span><strong>{formatBrlCents(item.amount_cents)}</strong></div>)}</div> : <p>Todos estão em dia. Não há transferências sugeridas.</p>}<small>As sugestões mostram valores para quitar o saldo. Você também pode registrar pagamentos parciais.</small>
      {settlementFormOpen && <form className="settlement-form" onSubmit={(event) => void saveSettlement(event)}><p>Registre um pagamento feito ou combinado por você. Acertos pendentes ficam no histórico e só alteram os saldos depois de confirmados.</p><div className="settlement-form-fields"><label>Quem recebeu?<select required value={settlementRecipient} onChange={(event) => setSettlementRecipient(event.target.value)}><option value="">Escolha uma pessoa</option>{members.filter((member) => member.user_id !== userId).map((member) => <option key={member.user_id} value={member.user_id}>{memberLabel(member.user_id)}{member.active ? '' : ' · sem acesso'}</option>)}</select></label><label>Valor<div className="money-input"><span>R$</span><input required type="text" inputMode="decimal" placeholder="0,00" value={settlementAmount} onChange={(event) => setSettlementAmount(formatBrlInput(event.target.value))} /></div></label><label>Forma de pagamento<select value={settlementMethod} onChange={(event) => setSettlementMethod(event.target.value as Exclude<SettlementPaymentMethod, 'splitwise'>)}><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência bancária</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select></label><label>Status<select value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value as 'paid' | 'pending')}><option value="paid">Pago</option><option value="pending">Pendente</option></select></label><label>{settlementStatus === 'paid' ? 'Data do pagamento' : 'Data prevista'}<input required type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></label></div><div className="form-actions"><button type="button" className="button button-light" disabled={busy} onClick={() => setSettlementFormOpen(false)}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || !settlementRecipient || !settlementAmount.trim()}>{busy ? 'Registrando…' : settlementStatus === 'paid' ? 'Registrar pagamento' : 'Registrar como pendente'}</button></div></form>}
      {settlementNotice && <p className="auth-message" role="status">{settlementNotice}</p>}
    </div></details>
    {groupSettlements.length > 0 && <details className="settlement-panel settlement-history"><summary><span><strong>Histórico de acertos</strong><small>{groupSettlements.filter((item) => item.status === 'pending').length} pendentes · {groupSettlements.filter((item) => item.status === 'paid').length} pagos</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="settlement-list">{groupSettlements.map((item) => { const paidByUser = item.paid_by === userId; const receivedByUser = item.received_by === userId; const pending = item.status === 'pending'; const canConfirm = pending && (paidByUser || isAdmin); return <div id={`notification-record-${item.id}`} className={`balance-row settlement-row${pending ? ' settlement-pending' : paidByUser ? ' settlement-paid' : receivedByUser ? ' settlement-received' : ''}`} key={item.id}><span><strong>{paidByUser ? <>Você {pending ? 'combinou pagar' : 'pagou'} para {memberLink(item.received_by)}</> : receivedByUser ? <>{memberLink(item.paid_by)} {pending ? 'combinou pagar para você' : 'pagou para você'}</> : <>{memberLink(item.paid_by)} {pending ? 'combinou pagar para' : 'pagou para'} {memberLink(item.received_by)}</>}<em className={`settlement-status settlement-status-${item.status}`}>{pending ? 'Pendente' : 'Pago'}</em></strong><small>{item.description} · {settlementPaymentLabels[item.payment_method] ?? 'Forma não informada'} · {pending ? 'Previsto para' : 'Pago em'} {new Date(`${item.settlement_date}T12:00:00`).toLocaleDateString('pt-BR')}</small></span><strong>{formatBrlCents(item.amount_cents)}</strong>{canConfirm && <button className="button button-light settlement-confirm" disabled={busy} onClick={() => void confirmSettlementPaid(item)} aria-label={`Confirmar pagamento de ${formatBrlCents(item.amount_cents)} para ${memberLabel(item.received_by)}`}>Confirmar pagamento</button>}</div> })}</div><small>Somente acertos pagos reduzem os saldos. Despesas e acertos ficam separados nos relatórios; pendentes permanecem como previsão.</small></details>}
    <details className="group-collapsible report-collapsible" open><summary><span><strong>Relatórios e gráficos</strong><small>Despesas por categoria, período e tendência</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="report-section-content">
      <div className="chart-switch" role="group" aria-label="Tipo de gráfico"><button aria-pressed={chartType === 'bars'} className={chartType === 'bars' ? 'selected' : ''} onClick={() => setChartType('bars')}>Barras</button><button aria-pressed={chartType === 'donut'} className={chartType === 'donut' ? 'selected' : ''} onClick={() => setChartType('donut')}>Rosca</button><button aria-pressed={chartType === 'trend'} className={chartType === 'trend' ? 'selected' : ''} onClick={() => setChartType('trend')}>Tendência</button></div>
    <div className="report-controls">
      <label>Período<select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value as 'week' | 'month' | 'custom' | 'all')}><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Intervalo selecionado</option><option value="all">Desde o início · todo o período</option></select></label>
      {reportPeriod === 'week' && <label>Semana<input aria-label="Escolher semana" type="week" value={reportWeek} onChange={(event) => setReportWeek(event.target.value)} /></label>}
      {reportPeriod === 'month' && <label>Mês<input aria-label="Escolher mês" type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} /></label>}
      {reportPeriod === 'custom' && <div className="report-date-range"><label>De<input aria-label="Data inicial" type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label><span>até</span><label>Até<input aria-label="Data final" type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label></div>}
    </div>
    {reportPeriod === 'custom' && rangeStart && rangeEnd && rangeStart > rangeEnd
      ? <p className="report-range-summary report-range-error">A data inicial precisa ser anterior à data final.</p>
      : <p className="report-range-summary">{reportExpenses.length} {reportExpenses.length === 1 ? 'despesa' : 'despesas'} · {reportPeriod === 'all' ? 'desde o início' : periodStart && periodEnd ? `${new Date(`${periodStart}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${periodEnd}T12:00:00`).toLocaleDateString('pt-BR')}` : 'selecione um período'} · {formatBrlCents(reportExpenses.reduce((sum, expense) => sum + expense.amount_cents, 0))}</p>}
      {isAdmin && <div className="report-export"><button type="button" className="button button-light" disabled={!validReportRange || (reportPeriod === 'custom' && rangeStart > rangeEnd)} onClick={() => downloadGroupCsv(group.name, periodStart, periodEnd, groupExpenses, groupSettlements, members)}>Exportar despesas e acertos em CSV</button><small>Somente dados deste grupo, no período selecionado.</small></div>}
    {validReportRange
      ? <GroupExpenseCharts rows={categoryTotals} expenses={reportExpenses} periodStart={periodStart} periodEnd={periodEnd} labels={chartCategoryLabels} format={formatBrlCents} chartType={chartType} onSelectCategory={setCategoryFilter} />
      : <div className="chart-card"><p className="chart-empty">Escolha um período válido para visualizar os gastos.</p></div>}</div></details>
    <details className="group-collapsible expense-section" open><summary><span><strong>Despesas</strong><small>{visibleExpenses.length} lançamentos · organizados por mês</small></span><span className="settlement-chevron" aria-hidden="true">⌄</span></summary><div className="expense-section-content"><div className="section-title detail-section-title"><div><p>{categoryFilter === 'all' ? 'Registros do mais recente para o mais antigo.' : `Categoria selecionada: ${categoryFilter === 'contas_da_casa' ? 'Contas da Casa' : categoryFilter === 'transporte_grupo' ? 'Transporte' : categoryLabels[categoryFilter]}`}</p></div><label>Categoria<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as ExpenseCategory | 'contas_da_casa' | 'transporte_grupo' | 'all')}><option value="all">Todas</option><optgroup label="Categorias principais">{(['alimentacao','hospedagem','corrida','atividades','outros','viagens','streaming','fitness','fatura_cartao','acerto_outros_grupos'] as ExpenseCategory[]).map((key) => <option key={key} value={key}>{categoryEmojis[key]} {categoryLabels[key]}</option>)}</optgroup><optgroup label="Contas da Casa"><option value="contas_da_casa">🏠 Todas as contas da casa</option>{houseBillCategories.map((key) => <option key={key} value={key}>{categoryEmojis[key]} {categoryLabels[key]}</option>)}</optgroup><optgroup label="Transporte"><option value="transporte_grupo">🚗 Todas as despesas de transporte</option><option value="transporte">🚗 Transporte · registros antigos</option>{transportCategories.map((key) => <option key={key} value={key}>{categoryEmojis[key]} {categoryLabels[key]}</option>)}</optgroup></select></label></div>
    {expenseMonthGroups.length === 0
      ? <div className="empty-expenses"><strong>Nenhuma despesa nesta categoria.</strong><p>Registre uma despesa ou escolha outra categoria.</p></div>
      : <div className="expense-month-groups">{expenseMonthGroups.map(({ month, expenses, total }) => {
        const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        return <details className="expense-month-group collapsible-panel" key={month} open={month === expenseMonthGroups[0]?.month}>
          <summary><span><h3>{monthLabel.charAt(0).toLocaleUpperCase('pt-BR') + monthLabel.slice(1)}</h3><small>{expenses.length} {expenses.length === 1 ? 'lançamento' : 'lançamentos'}</small></span><strong>{formatBrlCents(total)}</strong><span className="settlement-chevron" aria-hidden="true">⌄</span></summary>
          <div className="expense-list">{expenses.map(renderExpenseRow)}</div>
        </details>
      })}</div>}</div></details>
  </section>
}

function GroupExpenseCharts({ rows, expenses, periodStart, periodEnd, labels, format, chartType, onSelectCategory }: {
  rows: { category: ChartCategory; all: number }[]
  expenses: ExpenseRecord[]
  periodStart: string
  periodEnd: string
  labels: Record<ChartCategory, string>
  format: (cents: number) => string
  chartType: 'bars' | 'donut' | 'trend'
  onSelectCategory: (category: ChartCategory) => void
}) {
  const colors = ['#77a744', '#d59764', '#729bb3', '#b98665', '#b69bc7', '#d4bc66', '#8caa75', '#5f9a91', '#c47c9b', '#8794ca', '#bb985c', '#85935d', '#ba725f']
  const total = rows.reduce((sum, row) => sum + row.all, 0)
  const palette = rows.map((row, index) => ({ ...row, color: colors[index], share: total ? row.all / total * 100 : 0 }))
  const firstMonth = new Date(`${periodStart.slice(0, 7)}-01T12:00:00`)
  const lastMonth = new Date(`${periodEnd.slice(0, 7)}-01T12:00:00`)
  const trend: { label: string; value: number }[] = []
  for (const month = new Date(firstMonth); month <= lastMonth; month.setMonth(month.getMonth() + 1)) {
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    trend.push({
      label: month.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', ''),
      value: expenses.filter((expense) => expense.expense_date.startsWith(key) && expense.expense_date >= periodStart && expense.expense_date <= periodEnd).reduce((sum, expense) => sum + expense.amount_cents, 0),
    })
  }
  const maximum = Math.max(1, ...trend.map((item) => item.value))
  const columnWidth = 104
  const chartWidth = Math.max(416, trend.length * columnWidth)
  const trendX = (index: number) => columnWidth / 2 + index * columnWidth
  const trendY = (value: number) => 112 - value / maximum * 76
  const points = trend.map((item, index) => `${trendX(index)},${trendY(item.value)}`).join(' ')
  const categoryExpenses = (category: ChartCategory) => expenses.filter((expense) => category === 'contas_da_casa' ? houseBillCategories.includes(expense.category) : category === 'transporte_grupo' ? expense.category === 'transporte' || transportCategories.includes(expense.category) : expense.category === category)
  const categoryTitle = (category: ChartCategory) => categoryExpenses(category).map((expense) => `${expense.description} · ${format(expense.amount_cents)}`).join('\n') || 'Nenhuma despesa nesta categoria no período.'
  return <div className="chart-card">
    {chartType === 'bars' && <div className="chart-bars">{palette.map((item) => <button className="chart-bar-row chart-category-select" type="button" key={item.category} title={categoryTitle(item.category)} onClick={() => onSelectCategory(item.category)}><span className="chart-bar-label"><span>{labels[item.category]}</span><strong>{format(item.all)}</strong></span><span className="chart-track"><i style={{ width: `${item.share}%`, background: item.color }} /></span></button>)}</div>}
    {chartType === 'donut' && <div className="chart-donut-layout"><div className="chart-donut" style={{ background: `conic-gradient(${palette.map((item, index) => `${item.color} ${palette.slice(0,index).reduce((sum, row) => sum + row.share, 0)}% ${palette.slice(0,index + 1).reduce((sum, row) => sum + row.share, 0)}%`).join(',')})` }}><div><strong>{format(total)}</strong><small>Total registrado</small></div></div><div className="chart-legend">{palette.map((item) => <button className="chart-legend-item" type="button" key={item.category} title={categoryTitle(item.category)} onClick={() => onSelectCategory(item.category)}><span style={{ background: item.color }} />{labels[item.category]}<strong>{Math.round(item.share)}%</strong></button>)}</div></div>}
    {chartType === 'trend' && <div className="chart-trend-scroll"><div className="chart-trend" style={{ width: chartWidth }}><svg viewBox={`0 0 ${chartWidth} 140`} role="img" aria-label="Tendência mensal das despesas no período selecionado"><path className="trend-area" d={`M ${points.split(' ').join(' L ')} L ${chartWidth - columnWidth / 2} 112 L ${columnWidth / 2} 112 Z`} /><polyline points={points} /><line x1={columnWidth / 2} y1="112" x2={chartWidth - columnWidth / 2} y2="112" />{trend.map((item, index) => <g key={`${item.label}-${index}`}><title>{`${item.label}: ${format(item.value)}`}</title><circle cx={trendX(index)} cy={trendY(item.value)} r="4" /></g>)}</svg><div className="chart-trend-labels" style={{ gridTemplateColumns: `repeat(${trend.length}, ${columnWidth}px)` }}>{trend.map((item) => <div key={item.label}><strong>{format(item.value)}</strong><span>{item.label}</span></div>)}</div></div></div>}
    {total === 0 && <p className="chart-empty">Adicione despesas para visualizar os gráficos.</p>}
  </div>
}

function Expense({ client, groupId, groupName, userId, expense, onBack, onSaved }: { client: NonNullable<typeof supabase>; groupId: string; groupName: string; userId: string; expense: ExpenseRecord | null; onBack: () => void; onSaved: () => void }) {
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const activeMembers = members.filter((member) => member.active)
  const includesFormerParticipant = Boolean(expense && [expense.paid_by, ...expense.shares.map((share) => share.user_id)].some((id) => members.some((member) => member.user_id === id && !member.active)))
  const [description, setDescription] = useState(expense?.description ?? '')
  const [categoryManuallySelected, setCategoryManuallySelected] = useState(Boolean(expense))
  const [amount, setAmount] = useState(expense ? formatBrlInput(String(expense.amount_cents)) : '')
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? userId)
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'outros')
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const [firstDueDate, setFirstDueDate] = useState(expense?.installments[0]?.due_date ?? expense?.expense_date ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [participantIds, setParticipantIds] = useState<string[]>(expense?.shares.map((share) => share.user_id) ?? [])
  const [splitMode, setSplitMode] = useState<SplitMode>(expense?.split_mode ?? 'equal')
  const [percentageInputs, setPercentageInputs] = useState<Record<string, string>>(() => Object.fromEntries((expense?.shares ?? []).map((share) => [share.user_id, String(share.percentage ?? (expense?.amount_cents ? share.amount_cents * 100 / expense.amount_cents : 0))])))
  const [customInputs, setCustomInputs] = useState<Record<string, string>>(() => Object.fromEntries((expense?.shares ?? []).map((share) => [share.user_id, formatBrlInput(String(share.amount_cents))])))
  const [installmentCount, setInstallmentCount] = useState(String(expense?.installments.length ?? 1))
  const [recurring, setRecurring] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [favoriteRows, setFavoriteRows] = useState<Array<{ id: string; name: string; kind: 'split' | 'expense'; template: Record<string, unknown> }>>([])
  const [favoriteName, setFavoriteName] = useState('')
  const [selectedFavoriteId, setSelectedFavoriteId] = useState('')
  const [favoriteNotice, setFavoriteNotice] = useState<string | null>(null)

  useEffect(() => {
    if (expense || categoryManuallySelected) return
    const suggestion = suggestExpenseCategory(description)
    setCategory(suggestion ?? 'outros')
  }, [description, expense, categoryManuallySelected])

  useEffect(() => {
    let active = true
    void Promise.all([getGroupMembers(client, groupId), client.from('group_expense_favorites').select('id,name,kind,template').eq('group_id', groupId).order('name')]).then(([rows, favorites]) => {
      if (!active) return
      setMembers(rows)
      if (favorites.error && favorites.error.code !== '42P01') throw favorites.error
      setFavoriteRows((favorites.data ?? []) as typeof favoriteRows)
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

  function saveFavorite(kind: 'split' | 'expense') {
    const name = favoriteName.trim()
    if (!name) { setFavoriteNotice('Informe um nome para o favorito.'); return }
    try {
      const percentages = Object.fromEntries(participantIds.map((id) => [id, Number(percentageInputs[id] ?? 0)]))
      if (splitMode === 'percentage') allocatePercentage(100, percentages)
      const customCents = Object.fromEntries(participantIds.map((id) => {
        const value = (customInputs[id] ?? '0,00').trim()
        return [id, /^0+(?:[,.]0{1,2})?$/.test(value) ? 0 : parseBrlCents(value)]
      }))
      if (splitMode === 'custom' && amount.trim()) {
        const totalCents = parseBrlCents(amount)
        if (Object.values(customCents).reduce((sum, value) => sum + value, 0) !== totalCents) throw new Error('Os valores individuais precisam somar exatamente o total.')
      }
      if (kind === 'expense') makeShares(parseBrlCents(amount))
      const template: Record<string, unknown> = {
        participants: participantIds, paid_by: paidBy, split_mode: splitMode,
        percentages, custom_cents: customCents,
      }
      if (kind === 'expense') Object.assign(template, {
        description: description.trim(), category, amount_cents: parseBrlCents(amount), notes: notes.trim(), recurring,
        installment_count: recurring ? 1 : Number(installmentCount),
      })
      void (async () => {
        const favorite = favoriteRows.find((row) => row.id === selectedFavoriteId)
        const request = favorite
          ? client.from('group_expense_favorites').update({ name, kind, template }).eq('id', favorite.id)
          : client.from('group_expense_favorites').insert({ group_id: groupId, created_by: userId, name, kind, template })
        const { data, error: insertError } = await request.select('id,name,kind,template').single()
          if (insertError) throw insertError
          setFavoriteRows((current) => [...current.filter((row) => row.id !== (data as typeof favoriteRows[number]).id), data as typeof favoriteRows[number]].sort((a, b) => a.name.localeCompare(b.name)))
          setFavoriteName(''); setSelectedFavoriteId(''); setFavoriteNotice(`Favorito “${name}” ${favorite ? 'atualizado' : 'salvo'} neste grupo.`)
      })().catch((reason: unknown) => setFavoriteNotice(reason instanceof Error ? reason.message : 'Não foi possível salvar o favorito.'))
    } catch (reason) { setFavoriteNotice(reason instanceof Error ? reason.message : 'Revise os dados do favorito.') }
  }

  function applyFavorite(id: string) {
    const favorite = favoriteRows.find((row) => row.id === id)
    if (!favorite) return
    setSelectedFavoriteId(favorite.id)
    setFavoriteName(favorite.name)
    const t = favorite.template
    const ids = (Array.isArray(t.participants) ? t.participants : []).filter((value): value is string => typeof value === 'string' && activeMembers.some((member) => member.user_id === value))
    if (!ids.length) { setFavoriteNotice('As pessoas salvas neste favorito não estão mais ativas no grupo.'); return }
    setParticipantIds(ids)
    if (typeof t.paid_by === 'string' && activeMembers.some((member) => member.user_id === t.paid_by)) setPaidBy(t.paid_by)
    if (t.split_mode === 'equal' || t.split_mode === 'percentage' || t.split_mode === 'custom') setSplitMode(t.split_mode)
    if (t.percentages && typeof t.percentages === 'object') setPercentageInputs(Object.fromEntries(Object.entries(t.percentages).map(([key, value]) => [key, String(value)])))
    if (t.custom_cents && typeof t.custom_cents === 'object') setCustomInputs(Object.fromEntries(Object.entries(t.custom_cents).map(([key, value]) => [key, formatBrlInput(String(Number(value)))])))
    if (favorite.kind === 'expense') {
      if (typeof t.description === 'string') setDescription(t.description)
      if (typeof t.category === 'string') { setCategory(t.category as ExpenseCategory); setCategoryManuallySelected(true) }
      if (typeof t.amount_cents === 'number') setAmount(formatBrlInput(String(t.amount_cents)))
      if (typeof t.notes === 'string') setNotes(t.notes)
      setRecurring(t.recurring === true)
      setInstallmentCount(String(t.installment_count ?? 1))
    }
    setFavoriteNotice(`Favorito “${favorite.name}” aplicado.`)
  }

  async function deleteFavorite() {
    if (!selectedFavoriteId) return
    const id = selectedFavoriteId
    const { data: deletedFavorite, error: deleteError } = await client.from('group_expense_favorites').delete().eq('id', id).select('id').maybeSingle()
    if (deleteError || !deletedFavorite) { setFavoriteNotice(deleteError?.message ?? 'Somente quem criou o favorito ou um admin ativo pode excluí-lo.'); return }
    setFavoriteRows((current) => current.filter((row) => row.id !== id))
    setSelectedFavoriteId(''); setFavoriteName(''); setFavoriteNotice('Favorito excluído.')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const amountCents = parseBrlCents(amount)
      const { shares, remainderCents } = makeShares(amountCents)
      const count = recurring ? 1 : Number(installmentCount)
      const installments = generateMonthlySchedule(amountCents, count, firstDueDate, shares, remainderCents)
      const values = { description, category, amountCents, paidBy, expenseDate, notes, splitMode, roundingRemainderCents: remainderCents, shares, installments }
      if (expense) await updateExpense(client, expense.id, values)
      else if (recurring) await createRecurringExpense(client, groupId, values)
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
    {favoriteRows.length > 0 && <label>Usar ou editar favorito deste grupo<select value={selectedFavoriteId} onChange={(event) => applyFavorite(event.target.value)}><option value="">Escolha um favorito</option>{favoriteRows.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.kind === 'split' ? 'rateio' : 'despesa'}</option>)}</select><small>Favoritos de despesa preenchem descrição e categoria e preservam essa categoria ao editar o texto. Favoritos de rateio alteram participantes e divisão.</small></label>}
    <label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} required placeholder="Ex.: almoço na praia" disabled={busy} />{!expense && suggestExpenseCategory(description) && !categoryManuallySelected && <small role="status">Categoria sugerida: {categoryLabels[suggestExpenseCategory(description)!]}. Você pode alterar abaixo.</small>}</label>
    <div className="form-two"><label>Valor total<div className="money-input"><span>R$</span><input value={amount} onChange={(event) => setAmount(formatBrlInput(event.target.value))} inputMode="decimal" required placeholder="0,00" disabled={busy} /></div></label><label>Quem pagou?<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} required disabled={busy}><option value="" disabled>Selecione</option>{activeMembers.map((member) => <option key={member.user_id} value={member.user_id}>{memberLabel(member)}{member.user_id === userId ? ' (você)' : ''}</option>)}</select></label></div>
    <div className="form-two"><label>Categoria<select value={category} onChange={(event) => { setCategory(event.target.value as ExpenseCategory); setCategoryManuallySelected(true) }} disabled={busy}><optgroup label="Categorias principais"><option value="alimentacao">🍴 Alimentação</option><option value="hospedagem">🏡 Hospedagem</option><option value="corrida">🍁 Corrida</option><option value="atividades">🎟️ Atividades</option><option value="outros">✳ Outros</option><option value="viagens">🧳 Viagens</option><option value="streaming">📺 Streaming</option><option value="fitness">🏋️ Fitness</option><option value="fatura_cartao">💳 Fatura de cartão</option><option value="acerto_outros_grupos">↔️ Acerto de outros grupos</option></optgroup><optgroup label="Contas da Casa"><option value="aluguel">🏠 Aluguel</option><option value="luz">💡 Luz</option><option value="agua">💧 Água</option><option value="iptu">🏛️ IPTU</option><option value="internet">🌐 Internet</option></optgroup><optgroup label="Transporte · categorias atuais">{transportCategories.map((key) => <option key={key} value={key}>{categoryEmojis[key]} {categoryLabels[key]}</option>)}</optgroup>{expense?.category === 'transporte' && <optgroup label="Transporte · registro antigo"><option value="transporte">🚗 Transporte (categoria antiga)</option></optgroup>}</select></label><label>Data da despesa<input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required disabled={busy || Boolean(expense?.recurring_series_id)} /></label></div>
    <label>Forma de divisão<select value={splitMode} onChange={(event) => setSplitMode(event.target.value as SplitMode)} disabled={busy}><option value="equal">Igualmente</option><option value="percentage">Por porcentagem</option><option value="custom">Valores definidos por pessoa</option></select></label>
    <fieldset className="participant-picker"><legend>Participantes</legend>{activeMembers.map((member) => <label key={member.user_id}><input type="checkbox" checked={participantIds.includes(member.user_id)} onChange={(event) => { const ids = event.target.checked ? [...participantIds, member.user_id] : participantIds.filter((id) => id !== member.user_id); setParticipantIds(ids); if (event.target.checked) { const equal = ids.length ? 100 / ids.length : 0; setPercentageInputs((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? String(equal)]))) } }} disabled={busy} /><span>{memberLabel(member)}{member.user_id === userId ? ' (você)' : ''}</span></label>)}</fieldset>
    {splitMode === 'percentage' && participantIds.map((id) => <label key={id}>{memberLabel(members.find((member) => member.user_id === id)!)} · porcentagem<input type="number" min="0" max="100" step="0.01" value={percentageInputs[id] ?? ''} onChange={(event) => setPercentageInputs((current) => ({ ...current, [id]: event.target.value }))} disabled={busy} /></label>)}
    {splitMode === 'percentage' && <small>Soma informada: {totalPercent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%. Deve fechar em 100%.</small>}
    {splitMode === 'custom' && participantIds.map((id) => <label key={id}>{memberLabel(members.find((member) => member.user_id === id)!)} · valor<div className="money-input"><span>R$</span><input inputMode="decimal" value={customInputs[id] ?? ''} onChange={(event) => setCustomInputs((current) => ({ ...current, [id]: formatBrlInput(event.target.value) }))} disabled={busy} /></div></label>)}
    {splitMode === 'equal' && <small>Na divisão igual, todos recebem a mesma cota arredondada para baixo; os centavos restantes ficam com quem pagou.</small>}
    {!expense && <label className="recurrence-choice"><input type="checkbox" checked={recurring} onChange={(event) => { setRecurring(event.target.checked); if (event.target.checked) setInstallmentCount('1') }} disabled={busy} /><span><strong>Repetir todo mês sem data de término</strong><small>As ocorrências são criadas somente até o mês consultado. Valores futuros não entram nos saldos.</small></span></label>}
    {expense?.recurring_series_id && <p className="invite-help">Esta despesa faz parte de uma série mensal. Salvar alterações modifica somente esta ocorrência; a série continuará com os dados usados no próximo mês.</p>}
    <div className="form-two">{!recurring && <label>Quantidade de parcelas<input type="number" min="1" max="60" step="1" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} required disabled={busy || recurring} /></label>}<label>{recurring ? 'Data da primeira ocorrência' : 'Primeiro vencimento'}<input type="date" value={firstDueDate} onChange={(event) => { setFirstDueDate(event.target.value); if (recurring) setExpenseDate(event.target.value) }} required disabled={busy || Boolean(expense?.recurring_series_id)} /></label></div>
    <label>Observações (opcional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} disabled={busy} /></label>
    {preview && !previewError && <div className="form-note"><strong>Prévia do rateio</strong>{preview.shares.map((share) => <div key={share.user_id}>{memberLabel(members.find((member) => member.user_id === share.user_id)!)}: {formatBrlCents(share.amount_cents)}</div>)}{preview.remainderCents > 0 && <p>Ajuste de {formatBrlCents(preview.remainderCents)} fica com quem pagou.</p>}<strong>Cronograma</strong>{installmentsPreview.map((part) => <div key={part.installment_number}>Parcela {part.installment_number}/{installmentsPreview.length}: {formatBrlCents(part.amount_cents)} · vence {new Date(`${part.due_date}T12:00:00`).toLocaleDateString('pt-BR')}</div>)}</div>}
    <fieldset className="favorite-controls"><legend>Favoritos do grupo</legend><label>Nome do favorito<input value={favoriteName} onChange={(event) => setFavoriteName(event.target.value)} maxLength={80} placeholder="Ex.: divisão casa 60/40" /></label><div className="form-actions"><button type="button" className="button button-light" onClick={() => saveFavorite('split')} disabled={busy || !participantIds.length}>{selectedFavoriteId ? 'Atualizar rateio' : 'Salvar rateio'}</button><button type="button" className="button button-light" onClick={() => saveFavorite('expense')} disabled={busy || !participantIds.length}>{selectedFavoriteId ? 'Atualizar despesa' : 'Salvar despesa'}</button>{selectedFavoriteId && <button type="button" className="button button-light" onClick={() => void deleteFavorite()}>Excluir favorito</button>}</div><small>Todos os membros ativos podem usar. Quem criou ou um admin ativo pode atualizar e excluir; favoritos guardam apenas referências a participantes ativos.</small>{favoriteNotice && <p role="status">{favoriteNotice}</p>}</fieldset>
    {previewError && <p className="auth-error" role="alert">{previewError}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button button-light" onClick={onBack} disabled={busy}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || activeMembers.length === 0 || !preview || Boolean(previewError) || includesFormerParticipant}>{busy ? 'Salvando…' : expense ? 'Salvar alterações' : 'Salvar despesa'} <span>→</span></button></div>
  </form>}</section>
}

function Login({ configured, onSignIn, onRecover, busy, error }: {
  configured: boolean
  onSignIn: (identifier: string, password: string) => Promise<void>
  onRecover: (identifier: string) => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSignIn(identifier.trim(), password)
  }

  return <section className="page-wrap form-wrap auth-wrap"><div className="brand auth-brand"><img className="brand-logo" src={brandLogoUrl} alt="" /><span className="brand-name">Split<span>Uai</span></span></div><div className="eyebrow">BEM-VINDE DE VOLTA</div><h1>Que bom te ver<span className="heading-dot">.</span></h1><p className="form-intro">Entre na sua conta para continuar dividindo.</p><form onSubmit={submit}><label>E-mail ou @usuário<input type="text" autoComplete="username" placeholder="voce@email.com ou @ana_silva" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required disabled={!configured || busy} /></label><label>Senha<input type="password" autoComplete="current-password" placeholder="Sua senha" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!configured || busy} /></label><button className="button button-dark full-button" type="submit" disabled={!configured || busy}>{busy ? 'Entrando…' : 'Entrar'} <span>→</span></button><button className="text-button" type="button" disabled={!configured || busy || !identifier.trim()} onClick={() => void onRecover(identifier.trim())}>Esqueci minha senha</button>{!configured && <p className="auth-message" role="status">Autenticação não configurada neste ambiente. Novas contas continuam disponíveis somente por convite.</p>}{error && <p className={error.startsWith('Se a conta') ? 'auth-message' : 'auth-error'} role={error.startsWith('Se a conta') ? 'status' : 'alert'}>{error}</p>}<div className="login-footnote">O SplitUai é privado. O acesso é feito por convite; não há cadastro público.</div></form></section>
}

function PasswordSetup({ mode, onSubmit, onSignOut, busy, error }: {
  mode: 'invite' | 'recovery'
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

  return <section className="page-wrap form-wrap auth-wrap"><div className="brand auth-brand"><img className="brand-logo" src={brandLogoUrl} alt="" /><span className="brand-name">Split<span>Uai</span></span></div><div className="eyebrow">{mode === 'invite' ? 'CONVITE ACEITO' : 'RECUPERAÇÃO DE ACESSO'}</div><h1>{mode === 'invite' ? 'Crie sua senha' : 'Defina uma nova senha'}<span className="heading-dot">.</span></h1><p className="form-intro">{mode === 'invite' ? 'Defina uma senha para entrar no SplitUai.' : 'Escolha uma nova senha para sua conta SplitUai.'}</p><form onSubmit={submit}><label>Nova senha<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required disabled={busy} /></label><label>Confirme a senha<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={6} required disabled={busy} /></label><button className="button button-dark full-button" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'} <span>→</span></button>{(validationError || error) && <p className="auth-error" role="alert">{validationError ?? error}</p>}<button className="text-button auth-signout" type="button" onClick={() => void onSignOut()} disabled={busy}>Sair</button></form></section>
}

function MyInvitations({ invitations, onRefresh, onAccept, onDecline }: { invitations: MyGroupInvitation[]; onRefresh: () => void; onAccept: (id: string) => Promise<void>; onDecline: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  async function accept(id: string) {
    setBusy(true); setError(null); setNotice(null)
    try { await onAccept(id); setNotice('Convite aceito. O grupo já está disponível em Meus grupos.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível aceitar este convite. Confira se ele ainda está válido e foi enviado para seu e-mail.') }
    finally { setBusy(false) }
  }
  async function decline(id: string) {
    setBusy(true); setError(null); setNotice(null)
    try { await onDecline(id); setNotice('Convite recusado.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível recusar este convite.') }
    finally { setBusy(false) }
  }
  return <section className="page-wrap"><div className="eyebrow">ESPAÇO PESSOAL</div><h1>Convites recebidos<span className="heading-dot">.</span></h1><p className="form-intro">Convites enviados para sua conta ou e-mail.</p>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}{invitations.length === 0 ? <div className="empty-expenses"><strong>Nenhum convite pendente.</strong><p>Quando alguém convidar você ou o e-mail da sua conta, o convite aparecerá aqui.</p><button className="text-button" onClick={onRefresh}>Atualizar</button></div> : <div className="invitation-list">{invitations.map((invitation) => { const expired = invitation.status === 'expired' || new Date(invitation.expires_at) <= new Date(); return <div className="invitation-row" key={invitation.id}><div><strong>{invitation.group_name}</strong><small>{invitation.invited_email || 'Convite direto para sua conta'} · válido até {new Date(invitation.expires_at).toLocaleDateString('pt-BR')}</small></div><span className={`invite-status status-${expired ? 'expired' : invitation.status}`}>{expired ? 'Expirado' : 'Pendente'}</span><button className="button button-dark" disabled={busy || expired} onClick={() => void accept(invitation.id)}>{busy ? 'Aceitando…' : 'Aceitar convite'}</button><button className="button button-light" disabled={busy || expired} onClick={() => void decline(invitation.id)}>Recusar</button></div> })}</div>}</section>
}

function Friends({ client, userId }: { client: NonNullable<typeof supabase>; userId: string }) {
  const [username, setUsername] = useState('')
  const [result, setResult] = useState<FriendSearchResult | null>(null)
  const [friendships, setFriendships] = useState<FriendshipView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    const rows = await listMyFriendships(client)
    setFriendships(rows)
    return rows
  }
  useEffect(() => {
    let active = true
    void listMyFriendships(client).then((rows) => { if (active) setFriendships(rows) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar suas amizades.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [client, userId])

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null); setResult(null)
    try {
      const found = await searchFriendByUsername(client, username.trim().replace(/^@/, ''))
      setResult(found)
      if (!found) setNotice('Nenhum perfil encontrado com esse username.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível buscar esse username.') }
    finally { setBusy(false) }
  }

  async function action(targetId: string, kind: 'send' | 'accept' | 'decline' | 'cancel' | 'unfriend') {
    setBusy(true); setError(null); setNotice(null)
    try {
      await manageFriendship(client, targetId, kind)
      const rows = await refresh()
      const relationship = rows.find((row) => row.other_user_id === targetId)
      setResult((current) => current?.user_id === targetId ? { ...current, relationship_status: relationship?.status ?? null, request_direction: relationship?.direction ?? null } : current)
      setNotice(kind === 'send' ? 'Pedido enviado.' : kind === 'accept' ? 'Amizade aceita.' : kind === 'decline' ? 'Pedido recusado.' : kind === 'cancel' ? 'Pedido cancelado.' : 'Amizade desfeita.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar esta amizade.') }
    finally { setBusy(false) }
  }

  const label = (person: { username: string | null; display_name: string | null }) => person.username ? `@${person.username}` : person.display_name || 'Pessoa usuária'
  const incoming = friendships.filter((row) => row.status === 'pending' && row.direction === 'incoming')
  const outgoing = friendships.filter((row) => row.status === 'pending' && row.direction === 'outgoing')
  const friends = friendships.filter((row) => row.status === 'accepted')
  return <section className="page-wrap">
    <div className="eyebrow">ESPAÇO PESSOAL</div><h1>Amizades<span className="heading-dot">.</span></h1>
    <p className="form-intro">Encontre pessoas pelo username completo. Só mostramos username, nome e foto; e-mails e grupos permanecem privados.</p>
    <form className="friend-search" onSubmit={(event) => void search(event)}>
      <label htmlFor="friend-username">Username</label><div className="friend-search-row"><span aria-hidden="true">@</span><input id="friend-username" value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, ''))} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" placeholder="ana_silva" required disabled={busy} /><button className="button button-dark" disabled={busy}>{busy ? 'Buscando…' : 'Buscar'}</button></div>
      <small>Busca exata, com limite de tentativas para proteger os perfis.</small>
    </form>
    {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}
    {result && <div className="friend-result"><div className="friend-person">{result.avatar_url ? <img className="avatar avatar-photo" src={result.avatar_url} alt="" /> : <span className="avatar avatar-you">{(result.username?.[0] ?? 'U').toUpperCase()}</span>}<div><strong>{label(result)}</strong>{result.display_name && <small>{result.display_name}</small>}</div></div>
      {!result.relationship_status && <button className="button button-dark" disabled={busy} onClick={() => void action(result.user_id, 'send')}>Enviar pedido</button>}
      {result.relationship_status === 'accepted' && <span className="role-badge">Amizade</span>}
      {result.relationship_status === 'pending' && result.request_direction === 'outgoing' && <><span className="invite-status status-pending">Pedido enviado</span><button className="button button-light" disabled={busy} onClick={() => void action(result.user_id, 'cancel')}>Cancelar</button></>}
      {result.relationship_status === 'pending' && result.request_direction === 'incoming' && <><button className="button button-dark" disabled={busy} onClick={() => void action(result.user_id, 'accept')}>Aceitar</button><button className="button button-light" disabled={busy} onClick={() => void action(result.user_id, 'decline')}>Recusar</button></>}
    </div>}
    <div className="section-title"><div><h2>Pedidos recebidos</h2><p>{incoming.length} pendente{incoming.length === 1 ? '' : 's'}</p></div></div>
    {incoming.length ? <div className="invitation-list">{incoming.map((row) => <div className="invitation-row" key={row.id}><FriendIdentity row={row} label={label} /><button className="button button-dark" disabled={busy} onClick={() => void action(row.other_user_id, 'accept')}>Aceitar</button><button className="button button-light" disabled={busy} onClick={() => void action(row.other_user_id, 'decline')}>Recusar</button></div>)}</div> : <div className="empty-expenses"><strong>{loading ? 'Carregando…' : 'Nenhum pedido recebido.'}</strong><p>Pedidos que outras pessoas enviarem aparecerão aqui.</p></div>}
    <div className="section-title"><div><h2>Pedidos enviados</h2><p>{outgoing.length} aguardando resposta</p></div></div>
    {outgoing.length ? <div className="invitation-list">{outgoing.map((row) => <div className="invitation-row" key={row.id}><FriendIdentity row={row} label={label} /><span className="invite-status status-pending">Aguardando</span><button className="button button-light" disabled={busy} onClick={() => void action(row.other_user_id, 'cancel')}>Cancelar pedido</button></div>)}</div> : <div className="empty-expenses"><strong>Nenhum pedido enviado.</strong><p>Pedidos pendentes podem ser cancelados a qualquer momento.</p></div>}
    <div className="section-title"><div><h2>Minhas amizades</h2><p>{friends.length} {friends.length === 1 ? 'pessoa' : 'pessoas'}</p></div></div>
    {friends.length ? <div className="invitation-list">{friends.map((row) => <div className="invitation-row" key={row.id}><FriendIdentity row={row} label={label} /><span className="role-badge">Amizade</span><button className="button button-light" disabled={busy} onClick={() => void action(row.other_user_id, 'unfriend')}>Desfazer amizade</button></div>)}</div> : <div className="empty-expenses"><strong>{loading ? 'Carregando…' : 'Você ainda não tem amizades.'}</strong><p>Busque uma pessoa pelo username para começar.</p></div>}
    <p className="friend-invite-note">A amizade não adiciona ninguém a grupos nem aceita convites. Convites de grupo continuam sendo enviados e aceitos separadamente.</p>
  </section>
}

function FriendIdentity({ row, label }: { row: FriendshipView; label: (person: { username: string | null; display_name: string | null }) => string }) {
  return <div className="friend-person">{row.avatar_url ? <img className="avatar avatar-photo" src={row.avatar_url} alt="" /> : <span className="avatar avatar-you">{(row.username?.[0] ?? 'U').toUpperCase()}</span>}<div><strong>{label(row)}</strong>{row.display_name && <small>{row.display_name}</small>}</div></div>
}

function UserProfile({ client, userId, viewerId, onBack, onOpenGroup }: {
  client: NonNullable<typeof supabase>
  userId: string
  viewerId: string
  onBack: () => void
  onOpenGroup: (id: string) => void
}) {
  const [profile, setProfile] = useState<GroupProfileRecord | null>(null)
  const [sharedGroups, setSharedGroups] = useState<{ id: string; name: string; created_at: string; archived_at: string | null; sharedSince: string; viewerBalance: number; profileBalance: number; history: { id: string; date: string; description: string; amount: number; kind: 'expense' | 'settlement'; status?: 'pending' | 'paid' }[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const profileData = await getProfile(client, userId)
        if (!profileData) throw new Error('Este perfil não existe ou você não tem um grupo em comum com esta pessoa.')
        const { data: memberships, error: membershipError } = await client.from('group_members')
          .select('group_id, joined_at, active').eq('user_id', userId).eq('active', true)
        if (membershipError) throw membershipError
        const groupIds = (memberships ?? []).map((row) => row.group_id as string)
        if (groupIds.length === 0) {
          if (active) { setProfile(profileData); setSharedGroups([]) }
          return
        }
        const { data: groupRows, error: groupError } = await client.from('groups')
          .select('id, name, created_at, archived_at').in('id', groupIds).order('created_at', { ascending: true })
        if (groupError) throw groupError
        const summaries = await Promise.all((groupRows ?? []).map(async (group) => {
          const [members, expenses, settlements] = await Promise.all([
            getGroupMembers(client, group.id),
            listGroupExpenses(client, group.id),
            listGroupSettlements(client, group.id),
          ])
          const viewer = members.find((member) => member.user_id === viewerId && member.active)
          const target = members.find((member) => member.user_id === userId && member.active)
          if (!viewer || !target) return null
          const balances = calculateBalances(expenses, members.map((member) => member.user_id), undefined, settlements)
          const involved = (expense: ExpenseRecord, id: string) => expense.paid_by === id || expense.shares.some((share) => share.user_id === id)
          const history = [
            ...expenses.filter((expense) => involved(expense, viewerId) && involved(expense, userId)).map((expense) => ({ id: expense.id, date: expense.expense_date, description: expense.description, amount: expense.amount_cents, kind: 'expense' as const })),
            ...settlements.filter((item) => [item.paid_by, item.received_by].includes(viewerId) && [item.paid_by, item.received_by].includes(userId)).map((item) => ({ id: item.id, date: item.settlement_date, description: item.description, amount: item.amount_cents, kind: 'settlement' as const, status: item.status })),
          ].sort((a, b) => b.date.localeCompare(a.date))
          const targetMembership = (memberships ?? []).find((row) => row.group_id === group.id)
          return {
            ...group,
            sharedSince: [viewer.joined_at, targetMembership?.joined_at ?? target.joined_at].sort().at(-1) ?? group.created_at,
            viewerBalance: balances.find((balance) => balance.user_id === viewerId)?.balance_cents ?? 0,
            profileBalance: balances.find((balance) => balance.user_id === userId)?.balance_cents ?? 0,
            history,
          }
        }))
        if (active) { setProfile(profileData); setSharedGroups(summaries.filter((summary) => summary !== null)) }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir este perfil.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [client, userId, viewerId])

  const displayName = profile?.display_name || (profile?.username ? `@${profile.username}` : 'Perfil do participante')
  return <section className="page-wrap profile-page"><button className="back-link" onClick={onBack}>← Voltar</button>
    {loading ? <p className="auth-loading">Carregando perfil…</p> : error ? <p className="auth-error" role="alert">{error}</p> : profile && <>
      <div className="profile-heading"><div className="profile-photo-preview">{profile.avatar_url ? <img src={profile.avatar_url} alt={`Foto de ${displayName}`} /> : (profile.display_name || profile.username || 'P').slice(0, 1).toUpperCase()}</div><div><div className="eyebrow">PERFIL DO PARTICIPANTE</div><h1>{displayName}<span className="heading-dot">.</span></h1>{profile.username && <p>@{profile.username}</p>}</div></div>
      <div className="profile-details-grid"><article className="settlement-panel"><small>NOME</small><strong>{profile.display_name || 'Não informado'}</strong></article><article className="settlement-panel"><small>APELIDO</small><strong>{profile.username ? `@${profile.username}` : 'Não definido'}</strong></article><article className="settlement-panel"><small>CHAVE PIX</small><strong>{profile.pix_key || 'Não informada'}</strong></article></div>
      <div className="section-title"><div><h2>Grupos em comum</h2><p>{sharedGroups.length} {sharedGroups.length === 1 ? 'grupo compartilhado' : 'grupos compartilhados'} com você</p></div></div>
      {sharedGroups.length === 0 ? <div className="empty-expenses"><strong>Nenhum grupo ativo em comum.</strong><p>Os detalhes do perfil ficam disponíveis para pessoas que compartilham um grupo ativo.</p></div> : <div className="profile-groups">{sharedGroups.map((group) => <article className="settlement-panel profile-group" key={group.id}>
        <div className="profile-group-heading"><div><h3>{group.name}</h3><small>Período do grupo: {new Date(group.created_at).toLocaleDateString('pt-BR')} – {group.archived_at ? new Date(group.archived_at).toLocaleDateString('pt-BR') : 'em andamento'} · Em comum desde {new Date(group.sharedSince).toLocaleDateString('pt-BR')}</small></div><button className="button button-light" onClick={() => onOpenGroup(group.id)}>Abrir grupo</button></div>
        <div className="profile-balances"><p>Seu saldo no grupo <strong className={group.viewerBalance > 0 ? 'balance-positive' : group.viewerBalance < 0 ? 'balance-negative' : ''}>{formatBrlCents(group.viewerBalance)}</strong></p><p>Saldo de {profile.username ? `@${profile.username}` : 'esta pessoa'} <strong className={group.profileBalance > 0 ? 'balance-positive' : group.profileBalance < 0 ? 'balance-negative' : ''}>{formatBrlCents(group.profileBalance)}</strong></p></div>
        <details className="profile-history"><summary>Histórico compartilhado · {group.history.length} registros</summary>{group.history.length === 0 ? <p>Nenhuma despesa ou acerto compartilhado neste grupo.</p> : <div className="settlement-list">{group.history.map((item) => <div className="balance-row" key={`${item.kind}-${item.id}`}><span><strong>{item.description}</strong><small>{item.kind === 'expense' ? 'Despesa' : item.status === 'pending' ? 'Acerto pendente' : 'Acerto pago'} · {new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></span><strong>{formatBrlCents(item.amount)}</strong></div>)}</div>}</details>
      </article>)}</div>}
    </>}
  </section>
}

function NotificationCenter({ client, userId, onOpenGroup }: { client: NonNullable<typeof supabase>; userId: string; onOpenGroup: (id: string, recordId?: string) => void }) {
  const [rows, setRows] = useState<Array<{ id: string; title: string; message: string; destination: string; created_at: string; read_at: string | null }>>([])
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

  async function refresh() {
    const { data, error } = await client.from('notifications').select('id,title,message,destination,created_at,read_at').order('created_at', { ascending: false }).limit(100)
    if (error) { setNotice('Não foi possível carregar seus avisos.'); return }
    setRows(data ?? [])
  }
  useEffect(() => {
    void refresh()
    const channel = client.channel(`notification-center:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void refresh()).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [client, userId])

  async function enablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { setPermission('unsupported'); return }
    if (!vapidKey) { setNotice('A chave pública VAPID ainda não está configurada neste ambiente.'); return }
    setBusy(true); setNotice('')
    try {
      const granted = await Notification.requestPermission()
      setPermission(granted)
      if (granted !== 'granted') { setNotice(granted === 'denied' ? 'Permissão negada. Os avisos continuam disponíveis nesta central; altere a permissão nas configurações do navegador para ativar o Push.' : 'Permissão não concedida. Os avisos continuam disponíveis nesta central.'); return }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(vapidKey) })
      const json = subscription.toJSON()
      const { error } = await client.from('web_push_subscriptions').upsert({ user_id: userId, endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }, { onConflict: 'endpoint' })
      if (error) throw error
      setNotice('Este dispositivo está inscrito para receber avisos Push.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível ativar o Push neste dispositivo.') }
    finally { setBusy(false) }
  }

  async function disablePush() {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await client.from('web_push_subscriptions').delete().eq('endpoint', subscription.endpoint).eq('user_id', userId)
        await subscription.unsubscribe()
      }
      setNotice('A inscrição deste dispositivo foi desativada. Os avisos seguem na central.')
    } finally { setBusy(false) }
  }

  async function toggleRead(row: typeof rows[number]) {
    const readAt = row.read_at ? null : new Date().toISOString()
    const { error } = await client.from('notifications').update({ read_at: readAt }).eq('id', row.id)
    if (!error) setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: readAt } : item))
  }

  return <section className="page-wrap">
    <div className="page-heading"><div><span className="eyebrow">CENTRAL</span><h1>Seus avisos</h1><p>Atualizações de grupos, convites e acertos ficam guardadas aqui.</p></div></div>
    <section className="appearance-card" aria-labelledby="push-heading"><h2 id="push-heading">Notificações neste dispositivo</h2>
      {permission === 'unsupported' ? <p>Este navegador não oferece Web Push. Você ainda pode consultar os avisos nesta central.</p> : permission === 'denied' ? <p>A permissão foi negada. Os avisos continuam nesta central; reative a permissão nas configurações do navegador para voltar a receber Push.</p> : <p>O Push é opcional e só será ativado depois que você escolher permitir neste dispositivo. Em iPhone e iPad, adicione a web app à Tela de Início para receber Web Push.</p>}
      <div className="form-actions"><button className="button button-dark" type="button" onClick={() => void enablePush()} disabled={busy || permission === 'unsupported' || permission === 'denied'}>Ativar neste dispositivo</button><button className="button button-light" type="button" onClick={() => void disablePush()} disabled={busy || permission === 'unsupported'}>Desativar inscrição</button></div>
      {notice && <p role="status">{notice}</p>}
    </section>
    <div className="notification-list">{rows.length === 0 ? <div className="empty-state"><strong>Nenhum aviso por enquanto</strong><p>Quando houver uma atualização, ela aparecerá aqui.</p></div> : rows.map((row) => <article className={`notification-row${row.read_at ? '' : ' notification-unread'}`} key={row.id}>
      <div><strong>{row.title}</strong><p>{row.message}</p><time dateTime={row.created_at}>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.created_at))}</time></div>
      <div className="notification-actions"><button className="button button-light" type="button" onClick={() => void toggleRead(row)}>{row.read_at ? 'Marcar não lido' : 'Marcar como lido'}</button><button className="button button-dark" type="button" onClick={() => { const target = new URL(row.destination, window.location.origin); const groupId = target.searchParams.get('group'); const tab = target.searchParams.get('tab'); if (groupId) onOpenGroup(groupId, target.searchParams.get('expense') ?? target.searchParams.get('settlement') ?? undefined); else if (tab === 'invitations' || tab === 'friends') window.location.assign(row.destination); }}>Abrir</button></div>
    </article>)}</div>
    <p className="form-note">O texto do Push é genérico para reduzir a exposição na tela bloqueada. O ícone e a aparência dependem do navegador e do sistema operacional. A entrega em relógios depende do espelhamento e das configurações do telefone e do relógio.</p>
  </section>
}

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

function formatBrlInput(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  const cents = BigInt(digits)
  const whole = (cents / 100n).toLocaleString('pt-BR')
  const fraction = String(cents % 100n).padStart(2, '0')
  return `${whole},${fraction}`
}

function AppearanceSettings({ colorTheme, onColorThemeChange, darkMode, onDarkModeChange }: {
  colorTheme: ColorTheme
  onColorThemeChange: (theme: ColorTheme) => void
  darkMode: boolean
  onDarkModeChange: (enabled: boolean) => void
}) {
  const options: Array<{ id: ColorTheme; label: string }> = [
    { id: 'green', label: 'Verde' },
    { id: 'red', label: 'Vermelho' },
    { id: 'pink', label: 'Rosa bebê' },
  ]
  return <section className="appearance-card" aria-labelledby="appearance-title">
    <div><h2 id="appearance-title">Aparência</h2><p>Escolha a cor principal e o modo de exibição.</p></div>
    <div className="theme-options" role="group" aria-label="Cor do aplicativo">
      {options.map((option) => <button key={option.id} type="button" className={`theme-option theme-option-${option.id}`} aria-pressed={colorTheme === option.id} onClick={() => onColorThemeChange(option.id)}><span className="theme-swatch" aria-hidden="true" />{option.label}</button>)}
    </div>
    <label className="dark-mode-option"><input type="checkbox" checked={darkMode} onChange={(event) => onDarkModeChange(event.target.checked)} /><span><strong>Modo noturno</strong><small>Aplicar fundo escuro ao app</small></span></label>
  </section>
}

function Account({ client, email, userId, onProfileChange, onSignOut, busy, colorTheme, onColorThemeChange, darkMode, onDarkModeChange }: {
  client: NonNullable<typeof supabase>
  email: string
  userId: string
  onProfileChange: (profile: GroupProfileRecord | null) => void
  onSignOut: () => Promise<void>
  busy: boolean
  colorTheme: ColorTheme
  onColorThemeChange: (theme: ColorTheme) => void
  darkMode: boolean
  onDarkModeChange: (enabled: boolean) => void
}) {
  const [username, setUsername] = useState('')
  const [pixKey, setPixKey] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void client.from('profiles').select('username, avatar_url, pix_key').eq('id', userId).maybeSingle().then(async ({ data, error: queryError }) => {
      if (!active) return
      let profile = data
      let profileError = queryError
      if (imageColumnsMissing(queryError)) {
        const fallback = await client.from('profiles').select('username, pix_key').eq('id', userId).maybeSingle()
        profile = fallback.data as typeof profile
        profileError = fallback.error
      }
      if (profileError) setError(profileError.message)
      setUsername(profile?.username ?? '')
      setAvatarUrl(profile?.avatar_url ?? null)
      setPixKey(profile?.pix_key ?? '')
      setProfileLoading(false)
    })
    return () => { active = false }
  }, [client, userId])
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(null); setNotice(null)
    try {
      const saved = await setMyUsername(client, username)
      await setMyPixKey(client, userId, pixKey)
      let nextAvatarUrl = avatarUrl
      if (avatarFile) {
        nextAvatarUrl = await uploadImage(client, `profiles/${userId}/avatar`, avatarFile)
        const { error: avatarError } = await client.from('profiles').update({ avatar_url: nextAvatarUrl }).eq('id', userId)
        if (avatarError) throw avatarError
        setAvatarUrl(nextAvatarUrl)
        setAvatarFile(null)
      }
      setUsername(saved)
      onProfileChange({ id: userId, display_name: null, username: saved, avatar_url: nextAvatarUrl ?? null, pix_key: pixKey.trim() || null })
      setNotice(`Perfil salvo como @${saved}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o identificador. Talvez ele já esteja em uso.')
    } finally { setSaving(false) }
  }
  return <section className="page-wrap form-wrap"><AppearanceSettings colorTheme={colorTheme} onColorThemeChange={onColorThemeChange} darkMode={darkMode} onDarkModeChange={onDarkModeChange} /><div className="eyebrow">SUA CONTA</div><h1>Minha conta<span className="heading-dot">.</span></h1><p className="form-intro">Seu e-mail fica visível apenas nesta área de conta e nos fluxos de convite.</p>{profileLoading ? <p className="auth-loading">Carregando perfil…</p> : <form onSubmit={(event) => void saveProfile(event)}><div className="profile-photo-editor"><div className="profile-photo-preview">{avatarFile ? <img src={URL.createObjectURL(avatarFile)} alt="Prévia da foto de perfil" /> : avatarUrl ? <img src={avatarUrl} alt="Foto de perfil atual" /> : username.slice(0,1).toUpperCase() || 'U'}</div><label>Foto de perfil<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} disabled={saving} /><small>JPG, PNG ou WebP · até 5 MB.</small></label></div><label>Identificador público<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" placeholder="ex.: ana_silva" required disabled={saving} /></label><small>Use de 3 a 24 letras sem acento, números ou sublinhados. Será exibido como @{username || 'usuario'}.</small><label>Chave PIX (opcional)<input value={pixKey} onChange={(event) => setPixKey(event.target.value)} maxLength={128} placeholder="CPF, telefone, e-mail ou chave aleatória" disabled={saving} /><small>Visível somente para você e para pessoas com quem compartilha um grupo.</small></label><label>E-mail da conta<input value={email} readOnly /></label>{error && <p className="auth-error" role="alert">{error}</p>}{notice && <p className="auth-message" role="status">{notice}</p>}<div className="form-actions"><button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar perfil'}</button><button className="button button-light" type="button" onClick={() => void onSignOut()} disabled={busy}>{busy ? 'Saindo…' : 'Sair da conta'}</button></div></form>}</section>
}

export default App
