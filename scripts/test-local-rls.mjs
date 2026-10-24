import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { createGroup, createGroupInvitation } from '../src/lib/groups.ts'
import { allocatePercentage, calculateBalances, createExpense, createRecurringExpense, deleteExpense, generateMonthlySchedule, listGroupExpenses, splitEvenly, suggestExpenseCategory, suggestSettlements, updateExpense } from '../src/lib/expenses.ts'

const apiUrl = process.env.API_URL
const anonKey = process.env.ANON_KEY
const localServiceKey = process.env.SERVICE_ROLE_KEY
const dbContainer = process.env.DB_CONTAINER ?? 'supabase_db_splituai'

if (!apiUrl || !anonKey || !localServiceKey) {
  throw new Error('Load API_URL, ANON_KEY and SERVICE_ROLE_KEY from `supabase status -o env` first.')
}

const api = new URL(apiUrl)
if (!['127.0.0.1', 'localhost', '::1'].includes(api.hostname)) {
  throw new Error(`Refusing to run test fixtures against non-local API host: ${api.hostname}`)
}

// The local service key is used only to provision/clean up test accounts.
// Every permission assertion below uses an individual anon-key user session.
const admin = createClient(apiUrl, localServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const prefix = `RLS local ${Date.now()} ${process.pid}`
const suffix = `${Date.now()}-${process.pid}`
const accounts = {
  admin: { email: `rls-admin-${suffix}@example.test`, password: `A-${suffix}-pass!` },
  member: { email: `rls-member-${suffix}@example.test`, password: `B-${suffix}-pass!` },
  member2: { email: `rls-member2-${suffix}@example.test`, password: `F-${suffix}-pass!` },
  outsider: { email: `rls-outsider-${suffix}@example.test`, password: `C-${suffix}-pass!` },
  isolated: { email: `rls-isolated-${suffix}@example.test`, password: `D-${suffix}-pass!` },
}
const createdUsers = []
const results = []

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
  results.push(`PASS: ${message}`)
  console.log(`PASS: ${message}`)
}

function userClient() {
  return createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function provisionUser(account) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
  })
  if (error) throw error
  createdUsers.push(data.user.id)
  return data.user
}

async function signIn(account) {
  const client = userClient()
  const { data, error } = await client.auth.signInWithPassword(account)
  if (error) throw error
  return { client, userId: data.user.id }
}

async function cleanup() {
  await admin.from('groups').delete().like('name', `${prefix}%`)
  await admin.from('bootstrap_invites').delete().in('email', [
    accounts.admin.email,
    accounts.outsider.email,
    accounts.isolated.email,
  ])
  for (const userId of createdUsers.reverse()) {
    await admin.auth.admin.deleteUser(userId)
  }
}

try {
  assert(suggestExpenseCategory('  CONTA—de ÁGUA! ') === 'agua', 'sugestão de categoria ignora acentos, caixa, espaços e pontuação')
  assert(suggestExpenseCategory('Internet do apartamento') === 'internet' && suggestExpenseCategory('luz') === 'luz', 'sugere categoria de internet e luz por palavras reconhecidas')
  const centSplit = allocatePercentage(101, { '00000000-0000-0000-0000-000000000001': 60, '00000000-0000-0000-0000-000000000002': 40 })
  assert(centSplit.reduce((sum, share) => sum + share.amount_cents, 0) === 101, 'rateio percentual distribui centavos residuais deterministicamente e fecha o total')
  const bootstrapEmails = [accounts.admin.email, accounts.outsider.email, accounts.isolated.email]
  if (!bootstrapEmails.every((email) => /^[a-z0-9-]+@example\.test$/.test(email))) {
    throw new Error('Unexpected generated test email format.')
  }
  const values = bootstrapEmails.map((email) => `('${email}', now() + interval '1 day')`).join(', ')
  const sql = `insert into public.bootstrap_invites (email, expires_at) values ${values};`
  execFileSync('docker', [
    'exec', dbContainer, 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-c', sql,
  ], { stdio: 'pipe' })

  const adminUser = await provisionUser(accounts.admin)
  const outsiderUser = await provisionUser(accounts.outsider)
  const isolatedUser = await provisionUser(accounts.isolated)
  const signupProbe = userClient()
  const { data: signupData, error: signupError } = await signupProbe.auth.signUp({
    email: `rls-public-signup-${suffix}@example.test`,
    password: `E-${suffix}-pass!`,
  })
  if (signupData.user?.id) createdUsers.push(signupData.user.id)
  assert(Boolean(signupError) && !signupData.user,
    'cadastro público continua bloqueado mesmo com login por e-mail habilitado localmente')

  const [adminSession, outsiderSession, isolatedSession] = await Promise.all([
    signIn(accounts.admin), signIn(accounts.outsider), signIn(accounts.isolated),
  ])

  const group1 = await createGroup(adminSession.client, adminUser.id, {
    name: `${prefix} G1`, description: 'teste local',
  })
  const { data: creatorMembership, error: creatorMembershipError } = await adminSession.client
    .from('group_members').select('role').eq('group_id', group1.id).eq('user_id', adminUser.id).single()
  if (creatorMembershipError) throw creatorMembershipError
  assert(group1.created_by === adminUser.id && creatorMembership.role === 'admin',
    'usuário autenticado cria grupo e o trigger o torna admin')

  const memberEmail = accounts.member.email
  const createdInvitation = await createGroupInvitation(
    adminSession.client, group1.id, `  ${memberEmail.toUpperCase()}  `,
  )
  assert(createdInvitation.invited_email === memberEmail,
    'função real do app normaliza o e-mail e permite convite a admin')
  const memberUser = await provisionUser(accounts.member)
  const memberSession = await signIn(accounts.member)
  const memberSendClaim = await memberSession.client.rpc('claim_group_invitation_email', {
    p_group_id: group1.id, p_invitation_id: createdInvitation.id,
  })
  assert(Boolean(memberSendClaim.error), 'membro sem papel admin não pode reivindicar envio de convite')
  const { data: preAcceptMembership, error: preAcceptMembershipError } = await memberSession.client
    .from('group_members').select('role').eq('group_id', group1.id).eq('user_id', memberUser.id)
  if (preAcceptMembershipError) throw preAcceptMembershipError
  assert(preAcceptMembership.length === 0,
    'criar a conta Auth não associa a pessoa nem aceita o convite')
  const wrongEmailAcceptance = await isolatedSession.client.rpc('accept_group_invitation', { p_invitation_id: createdInvitation.id })
  assert(Boolean(wrongEmailAcceptance.error), 'convite não pode ser aceito por uma sessão com outro e-mail')
  const pendingInbox = await memberSession.client.rpc('list_my_group_invitations')
  assert(!pendingInbox.error && pendingInbox.data.some((invite) => invite.id === createdInvitation.id && invite.status === 'pending'),
    'destinatário autenticado vê convite pendente antes de aceitar')
  const acceptedGroup = await memberSession.client.rpc('accept_group_invitation', { p_invitation_id: createdInvitation.id })
  assert(!acceptedGroup.error && acceptedGroup.data === group1.id,
    'destinatário autenticado aceita convite destinado ao e-mail confirmado da sessão')
  const { data: memberMembership, error: memberMembershipError } = await memberSession.client
    .from('group_members').select('role').eq('group_id', group1.id).eq('user_id', memberUser.id).single()
  if (memberMembershipError) throw memberMembershipError
  assert(memberMembership.role === 'member', 'aceite cria associação ativa com papel de membro')

  const member2Invite = await createGroupInvitation(adminSession.client, group1.id, accounts.member2.email)
  const member2User = await provisionUser(accounts.member2)
  const member2Session = await signIn(accounts.member2)
  const member2Acceptance = await member2Session.client.rpc('accept_group_invitation', { p_invitation_id: member2Invite.id })
  assert(!member2Acceptance.error, 'segundo participante aceita o próprio convite')
  const { data: member2Membership, error: member2MembershipError } = await member2Session.client
    .from('group_members').select('role').eq('group_id', group1.id).eq('user_id', member2User.id).single()
  if (member2MembershipError) throw member2MembershipError
  assert(member2Membership.role === 'member', 'segundo participante de teste entra no grupo por convite válido')

  const favoriteTemplate = { participants: [adminUser.id, memberUser.id], paid_by: adminUser.id, split_mode: 'percentage', percentages: { [adminUser.id]: 60, [memberUser.id]: 40 } }
  const { data: createdFavorite, error: favoriteCreateError } = await memberSession.client.from('group_expense_favorites')
    .insert({ group_id: group1.id, created_by: memberUser.id, name: `${prefix} 60/40`, kind: 'split', template: favoriteTemplate })
    .select('id,template').single()
  if (favoriteCreateError) throw favoriteCreateError
  const { data: memberFavorites, error: memberFavoritesError } = await adminSession.client.from('group_expense_favorites').select('id').eq('id', createdFavorite.id)
  if (memberFavoritesError) throw memberFavoritesError
  assert(memberFavorites.length === 1 && createdFavorite.template.percentages[memberUser.id] === 40,
    'membro ativo cria rateio percentual favorito e outro membro ativo consegue usar/ler')
  const { error: ownerFavoriteUpdateError } = await memberSession.client.from('group_expense_favorites').update({ name: `${prefix} 60/40 revisado` }).eq('id', createdFavorite.id)
  assert(!ownerFavoriteUpdateError, 'criador ativo pode editar seu favorito')
  const { error: adminFavoriteUpdateError } = await adminSession.client.from('group_expense_favorites').update({ name: `${prefix} rateio do grupo` }).eq('id', createdFavorite.id)
  assert(!adminFavoriteUpdateError, 'admin ativo pode editar favorito criado por outro membro')
  const { data: outsiderFavorites, error: outsiderFavoritesError } = await outsiderSession.client.from('group_expense_favorites').select('id').eq('id', createdFavorite.id)
  if (outsiderFavoritesError) throw outsiderFavoritesError
  assert(outsiderFavorites.length === 0, 'usuário fora do grupo não lê favoritos')
  const { error: outsiderFavoriteInsertError } = await outsiderSession.client.from('group_expense_favorites')
    .insert({ group_id: group1.id, created_by: outsiderUser.id, name: 'fora', kind: 'split', template: favoriteTemplate })
  assert(Boolean(outsiderFavoriteInsertError), 'usuário fora do grupo não cria favoritos')
  const { error: outsiderFavoriteUpdateError } = await outsiderSession.client.from('group_expense_favorites').update({ name: 'alterado fora' }).eq('id', createdFavorite.id)
  const { error: outsiderFavoriteDeleteError } = await outsiderSession.client.from('group_expense_favorites').delete().eq('id', createdFavorite.id)
  assert(!outsiderFavoriteUpdateError && !outsiderFavoriteDeleteError,
    'RLS não permite que usuário externo altere ou exclua favoritos de outro grupo')
  const { error: invalidFavoriteParticipantsError } = await memberSession.client.from('group_expense_favorites').insert({
    group_id: group1.id, created_by: memberUser.id, name: `${prefix} participante inválido`, kind: 'split',
    template: { participants: [outsiderUser.id], paid_by: outsiderUser.id, split_mode: 'equal' },
  })
  assert(Boolean(invalidFavoriteParticipantsError), 'banco recusa favorito que referencia participante não ativo do grupo')

  const image = new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])], { type: 'image/png' })
  const imageBase = `rls-${suffix}`
  const groupImagePath = `groups/${group1.id}/${imageBase}.png`
  const profileImagePath = `profiles/${adminUser.id}/${imageBase}.png`
  const otherProfileImagePath = `profiles/${memberUser.id}/${imageBase}.png`
  const { error: adminGroupImageError } = await adminSession.client.storage.from('splituai-images').upload(groupImagePath, image, { contentType: 'image/png' })
  assert(!adminGroupImageError, 'admin ativo pode enviar imagem do grupo')
  const { error: adminGroupImageReplaceError } = await adminSession.client.storage.from('splituai-images').upload(groupImagePath, image, { contentType: 'image/png', upsert: true })
  assert(!adminGroupImageReplaceError, 'admin ativo pode substituir imagem existente do grupo')
  const { error: memberGroupImageError } = await memberSession.client.storage.from('splituai-images').upload(`groups/${group1.id}/${imageBase}-member.png`, image, { contentType: 'image/png' })
  assert(Boolean(memberGroupImageError), 'membro comum não pode enviar imagem do grupo')
  const { error: outsiderGroupImageError } = await outsiderSession.client.storage.from('splituai-images').upload(`groups/${group1.id}/${imageBase}-outsider.png`, image, { contentType: 'image/png' })
  assert(Boolean(outsiderGroupImageError), 'usuário fora do grupo não pode enviar imagem do grupo')
  const { error: ownProfileImageError } = await adminSession.client.storage.from('splituai-images').upload(profileImagePath, image, { contentType: 'image/png' })
  assert(!ownProfileImageError, 'pessoa pode enviar a própria imagem de perfil')
  const { error: ownProfileImageReplaceError } = await adminSession.client.storage.from('splituai-images').upload(profileImagePath, image, { contentType: 'image/png', upsert: true })
  assert(!ownProfileImageReplaceError, 'pessoa pode substituir a própria imagem de perfil')
  const { error: otherProfileImageError } = await adminSession.client.storage.from('splituai-images').upload(otherProfileImagePath, image, { contentType: 'image/png' })
  assert(Boolean(otherProfileImageError), 'pessoa não pode enviar imagem ao perfil de outra conta')
  await admin.from('group_expense_favorites').delete().eq('id', createdFavorite.id)
  await admin.storage.from('splituai-images').remove([groupImagePath, profileImagePath, `groups/${group1.id}/${imageBase}-member.png`, `groups/${group1.id}/${imageBase}-outsider.png`])

  const { data: invitation, error: invitationReadError } = await adminSession.client
    .from('group_invitations').select('status').eq('group_id', group1.id).eq('invited_email', memberEmail).single()
  if (invitationReadError) throw invitationReadError
  assert(invitation.status === 'accepted', 'convite muda para aceito somente depois do aceite autenticado')
  const { data: memberInvitations, error: memberInvitationsError } = await memberSession.client
    .from('group_invitations').select('id').eq('group_id', group1.id)
  if (memberInvitationsError) throw memberInvitationsError
  assert(memberInvitations.length === 0, 'membro comum não lê a lista de convites reservada a admins')

  const { data: memberGroup, error: memberGroupError } = await memberSession.client
    .from('groups').select('id').eq('id', group1.id).maybeSingle()
  if (memberGroupError) throw memberGroupError
  const { data: group1Members, error: group1MembersError } = await memberSession.client
    .from('group_members').select('user_id').eq('group_id', group1.id)
  if (group1MembersError) throw group1MembersError
  assert(memberGroup?.id === group1.id && group1Members.length === 3,
    'membro lê o grupo compartilhado e seus três participantes')

  const group2 = await createGroup(outsiderSession.client, outsiderUser.id, {
    name: `${prefix} G2`, description: '',
  })
  const { data: outsiderOwnMembership, error: outsiderMembershipError } = await outsiderSession.client
    .from('group_members').select('role').eq('group_id', group2.id).eq('user_id', outsiderUser.id).single()
  if (outsiderMembershipError) throw outsiderMembershipError
  assert(outsiderOwnMembership.role === 'admin', 'criador do segundo grupo também recebe papel admin')

  const testUsername = `ana_${suffix.replace(/\D/g, '').slice(-12)}`
  const usernameSet = await adminSession.client.rpc('set_my_username', { p_username: ` ${testUsername.toUpperCase()} ` })
  assert(usernameSet.data === testUsername && !usernameSet.error, 'identificador é normalizado para minúsculas e espaços externos são removidos')
  const duplicateUsername = await memberSession.client.rpc('set_my_username', { p_username: testUsername.toUpperCase() })
  assert(Boolean(duplicateUsername.error), 'identificador duplicado sem diferenciar maiúsculas é recusado')
  const reservedUsername = await memberSession.client.rpc('set_my_username', { p_username: 'admin' })
  assert(Boolean(reservedUsername.error), 'identificador reservado é recusado pelo banco')
  const invalidUsername = await memberSession.client.rpc('set_my_username', { p_username: 'ab!' })
  assert(Boolean(invalidUsername.error), 'identificador fora do formato e tamanho permitidos é recusado')
  const { data: peerProfile, error: peerProfileError } = await memberSession.client.from('profiles')
    .select('username').eq('id', adminUser.id).single()
  if (peerProfileError) throw peerProfileError
  assert(peerProfile.username === testUsername, 'membro consulta o @ público de colega do grupo sem consultar e-mail')
  const { data: noUsernameProfile, error: noUsernameError } = await memberSession.client.from('profiles')
    .select('username').eq('id', memberUser.id).single()
  if (noUsernameError) throw noUsernameError
  assert(noUsernameProfile.username === null, 'perfil ainda sem identificador é retornado sem expor e-mail')
  const { data: forbiddenProfileUpdate, error: forbiddenProfileError } = await adminSession.client.from('profiles')
    .update({ username: 'hijack_name' }).eq('id', memberUser.id).select('id')
  assert(Boolean(forbiddenProfileError) || !forbiddenProfileUpdate?.length, 'usuário não altera identificador de outra pessoa por escrita direta')
  const outsiderUsername = `out_${suffix.replace(/\D/g, '').slice(-12)}`
  const unauthorizedProfile = await outsiderSession.client.rpc('set_my_username', { p_username: outsiderUsername })
  assert(!unauthorizedProfile.error, 'usuário pode escolher o próprio identificador mesmo fora do grupo')
  const { data: selfProfile, error: selfProfileError } = await outsiderSession.client.from('profiles')
    .select('username').eq('id', outsiderUser.id).single()
  if (selfProfileError) throw selfProfileError
  assert(selfProfile.username === outsiderUsername, 'usuário lê seu identificador mesmo sem grupo compartilhado')

  const memberIds = [adminUser.id, memberUser.id, member2User.id]
  const sharesFor = (amountCents, ids = memberIds) => splitEvenly(amountCents, ids)
  const scheduleFor = (amountCents, split, count = 1, due = '2026-10-08') => generateMonthlySchedule(amountCents, count, due, split.shares, split.remainderCents)
  const expenseValues = (amountCents, split, overrides = {}) => ({
    description: `${prefix} despesa`, category: 'outros', amountCents, paidBy: adminUser.id,
    expenseDate: '2026-10-08', notes: '', splitMode: 'equal', roundingRemainderCents: split.remainderCents,
    shares: split.shares, installments: scheduleFor(amountCents, split), ...overrides,
  })
  const recurringSplit = sharesFor(1001)
  const recurringExpenseId = await createRecurringExpense(adminSession.client, group1.id, expenseValues(1001, recurringSplit, {
    description: `${prefix} internet recorrente`, category: 'internet', expenseDate: '2026-08-15',
    installments: scheduleFor(1001, recurringSplit, 1, '2026-08-15'),
  }))
  const firstMaterialized = await adminSession.client.rpc('ensure_recurring_expenses_through', { p_group_id: group1.id, p_through_month: '2026-10-01' })
  const duplicateMaterialized = await adminSession.client.rpc('ensure_recurring_expenses_through', { p_group_id: group1.id, p_through_month: '2026-10-01' })
  const recurringRows = await listGroupExpenses(adminSession.client, group1.id)
  const seriesRows = recurringRows.filter((row) => row.recurring_series_id === recurringRows.find((candidate) => candidate.id === recurringExpenseId)?.recurring_series_id)
  assert(!firstMaterialized.error && firstMaterialized.data === 2 && !duplicateMaterialized.error && duplicateMaterialized.data === 0
    && seriesRows.length === 3 && new Set(seriesRows.map((row) => row.recurring_series_id + row.expense_date.slice(0, 7))).size === 3,
  'série materializa somente até a competência solicitada, sem duplicar ocorrências')
  const deletedRecurring = seriesRows.find((row) => row.id !== recurringExpenseId)
  await deleteExpense(adminSession.client, deletedRecurring.id)
  const afterSkip = await adminSession.client.rpc('ensure_recurring_expenses_through', { p_group_id: group1.id, p_through_month: deletedRecurring.expense_date.slice(0, 7) + '-01' })
  assert(!afterSkip.error && afterSkip.data === 0, 'ocorrência excluída não reaparece na próxima materialização')
  for (const row of seriesRows.filter((row) => row.id !== deletedRecurring.id)) await deleteExpense(adminSession.client, row.id)
  const initialSplit = sharesFor(1001)
  assert(initialSplit.shares.reduce((sum, share) => sum + share.amount_cents, 0) + initialSplit.remainderCents === 1001
    && initialSplit.shares.map((share) => share.amount_cents).join(',') === '333,333,333' && initialSplit.remainderCents === 2,
  'divisão igual deixa todos com 333 centavos e registra o resto no pagador')
  const exampleSplit = sharesFor(2234)
  assert(exampleSplit.shares.every((share) => share.amount_cents === 744) && exampleSplit.remainderCents === 2,
    'R$ 22,34 para três pessoas mostra R$ 7,44 por pessoa e ajuste de R$ 0,02')
  const tinySplit = sharesFor(1)
  assert(tinySplit.shares.every((share) => share.amount_cents === 0) && tinySplit.remainderCents === 1,
    'rateio menor que um centavo por pessoa deixa o restante integralmente com o pagador')
  const tinyExpenseId = await createExpense(adminSession.client, group1.id, expenseValues(1, tinySplit, {
    description: `${prefix} um centavo`, category: 'outros',
  }))
  const tinyRows = await listGroupExpenses(memberSession.client, group1.id)
  assert(calculateBalances(tinyRows.filter((row) => row.id === tinyExpenseId), memberIds).every((row) => row.balance_cents === 0),
    'RPC aceita ajuste igual ao total da despesa e mantém saldos em zero')
  await deleteExpense(adminSession.client, tinyExpenseId)
  const percentageShares = allocatePercentage(1001, { [adminUser.id]: 50, [memberUser.id]: 25, [member2User.id]: 25 })
  assert(percentageShares.reduce((sum, share) => sum + share.amount_cents, 0) === 1001,
    'rateio percentual distribui restos pelo maior resto fracionário e fecha o total')
  const percentExpenseId = await createExpense(adminSession.client, group1.id, expenseValues(1001,
    { shares: percentageShares, remainderCents: 0 }, { description: `${prefix} percentual`, category: 'atividades', splitMode: 'percentage' }))
  const percentRows = await listGroupExpenses(memberSession.client, group1.id)
  const percentExpense = percentRows.find((row) => row.id === percentExpenseId)
  assert(percentExpense?.split_mode === 'percentage'
    && percentExpense.shares.reduce((sum, share) => sum + share.amount_cents, 0) === 1001
    && percentExpense.shares.every((share) => share.percentage != null),
  'RPC valida e persiste divisão percentual e percentuais usados')
  await deleteExpense(adminSession.client, percentExpenseId)
  const customShares = [{ user_id: adminUser.id, amount_cents: 500 }, { user_id: memberUser.id, amount_cents: 501 }]
  const customSplit = { shares: customShares, remainderCents: 0 }
  const customExpenseId = await createExpense(adminSession.client, group1.id, expenseValues(1001, customSplit, {
    description: `${prefix} personalizado`, category: 'outros', splitMode: 'custom',
  }))
  const customRows = await listGroupExpenses(memberSession.client, group1.id)
  assert(customRows.find((row) => row.id === customExpenseId)?.shares.reduce((sum, share) => sum + share.amount_cents, 0) === 1001,
    'RPC grava valores personalizados que fecham exatamente com o total')
  await deleteExpense(adminSession.client, customExpenseId)
  const invalidPercentage = await adminSession.client.rpc('create_expense_with_schedule', {
    p_group_id: group1.id, p_description: 'percentuais inválidos', p_category: 'outros', p_amount_cents: 100,
    p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null, p_split_mode: 'percentage', p_rounding_remainder_cents: 0,
    p_shares: [{ user_id: adminUser.id, amount_cents: 100, percentage: 99 }],
    p_installments: [{ installment_number: 1, amount_cents: 100, due_date: '2026-10-08', shares: [{ user_id: adminUser.id, amount_cents: 100 }] }],
  })
  assert(Boolean(invalidPercentage.error), 'RPC recusa percentuais que não somam 100%')
  const createdExpenseId = await createExpense(adminSession.client, group1.id, expenseValues(1001, initialSplit, {
    description: `${prefix} almoço`, category: 'alimentacao',
  }))
  const memberExpenses = await listGroupExpenses(memberSession.client, group1.id)
  const createdExpense = memberExpenses.find((expense) => expense.id === createdExpenseId)
  assert(createdExpense?.shares.reduce((total, share) => total + share.amount_cents, 0) + createdExpense?.rounding_remainder_cents === createdExpense?.amount_cents
    && createdExpense?.shares.length === 3 && createdExpense.installments.length === 1,
  'membro lê a despesa, o ajuste e seu cronograma de uma parcela')

  const installmentSplit = sharesFor(1001)
  const installmentExpenseId = await createExpense(adminSession.client, group1.id, expenseValues(1001, installmentSplit, {
    description: `${prefix} parcelas`, category: 'hospedagem',
    installments: scheduleFor(1001, installmentSplit, 3, '2026-10-08'),
  }))
  const installmentRows = await listGroupExpenses(memberSession.client, group1.id)
  const installmentExpense = installmentRows.find((expense) => expense.id === installmentExpenseId)
  assert(installmentExpense?.installments.length === 3
    && installmentExpense.installments.reduce((sum, item) => sum + item.amount_cents, 0) === 1001
    && installmentExpense.installments.map((item) => item.due_date.slice(0, 7)).join(',') === '2026-10,2026-11,2026-12',
  'cronograma de três parcelas valida soma e vencimentos mensais')
  const octoberBalances = calculateBalances(installmentRows.filter((row) => row.id === installmentExpenseId), memberIds, '2026-10')
  const novemberBalances = calculateBalances(installmentRows.filter((row) => row.id === installmentExpenseId), memberIds, '2026-11')
  const decemberBalances = calculateBalances(installmentRows.filter((row) => row.id === installmentExpenseId), memberIds, '2026-12')
  assert(octoberBalances.reduce((sum, row) => sum + row.balance_cents, 0) === 0
    && novemberBalances.reduce((sum, row) => sum + row.balance_cents, 0) === 0
    && decemberBalances.reduce((sum, row) => sum + row.balance_cents, 0) === 0
    && calculateBalances([installmentExpense], memberIds).reduce((sum, row) => sum + row.balance_cents, 0) === 0,
  'cada parcela afeta somente seu mês de vencimento e todos os saldos fecham em zero')
  const outsiderInstallments = await outsiderSession.client.from('expense_installments').select('id').eq('expense_id', installmentExpenseId)
  assert(!outsiderInstallments.error && outsiderInstallments.data.length === 0, 'usuário de fora não consulta o cronograma')
  await deleteExpense(adminSession.client, installmentExpenseId)

  const secondExpenseId = await createExpense(memberSession.client, group1.id, expenseValues(1000, sharesFor(1000), {
    description: `${prefix} transporte`, category: 'transporte', paidBy: memberUser.id,
  }))
  const group1Rows = await listGroupExpenses(member2Session.client, group1.id)
  let balances = calculateBalances(group1Rows, memberIds)
  assert(balances.find((balance) => balance.user_id === adminUser.id)?.balance_cents === 333
    && balances.find((balance) => balance.user_id === memberUser.id)?.balance_cents === 333
    && balances.find((balance) => balance.user_id === member2User.id)?.balance_cents === -666
    && balances.reduce((sum, balance) => sum + balance.balance_cents, 0) === 0,
  'saldos líquidos incluem pagadores diferentes e somam exatamente zero')
  const initialSettlements = suggestSettlements(balances)
  assert(initialSettlements.length === 2
    && initialSettlements.reduce((sum, settlement) => sum + settlement.amount_cents, 0) === 666,
  'sugestões liquidam toda a dívida em centavos sem transferências excedentes')

  const { data: directExpenseInsert, error: directExpenseError } = await adminSession.client.from('expenses')
    .insert({ group_id: group1.id, created_by: adminUser.id, paid_by: adminUser.id,
      description: 'escrita direta', category: 'outros', amount_cents: 100, expense_date: '2026-10-08' })
    .select('id')
  assert(Boolean(directExpenseError) || !directExpenseInsert?.length,
    'INSERT direto em expenses permanece bloqueado')
  const legacyCreate = await adminSession.client.rpc('create_expense_with_shares', {
    p_group_id: group1.id, p_description: 'RPC antiga', p_category: 'outros', p_amount_cents: 100,
    p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null,
    p_shares: [{ user_id: adminUser.id, amount_cents: 100 }],
  })
  assert(Boolean(legacyCreate.error), 'RPC legada sem cronograma foi revogada')
  let outsiderExpenseReadDenied = false
  try { await listGroupExpenses(outsiderSession.client, group1.id) } catch (reason) { outsiderExpenseReadDenied = reason?.code === '42501' }
  assert(outsiderExpenseReadDenied, 'RPC de materialização recorrente recusa leitura de despesa por usuário fora do grupo')

  const invalidParticipant = await adminSession.client.rpc('create_expense_with_schedule', {
    p_group_id: group1.id, p_description: 'participante inválido', p_category: 'outros',
    p_amount_cents: 100, p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null, p_split_mode: 'custom', p_rounding_remainder_cents: 0,
    p_shares: [{ user_id: outsiderUser.id, amount_cents: 100 }],
    p_installments: [{ installment_number: 1, amount_cents: 100, due_date: '2026-10-08', shares: [{ user_id: outsiderUser.id, amount_cents: 100 }] }],
  })
  assert(Boolean(invalidParticipant.error), 'RPC recusa participante que pertence a outro grupo')
  const invalidAmount = await adminSession.client.rpc('create_expense_with_schedule', {
    p_group_id: group1.id, p_description: 'valor inválido', p_category: 'outros',
    p_amount_cents: -1, p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null, p_split_mode: 'custom', p_rounding_remainder_cents: 0,
    p_shares: [{ user_id: adminUser.id, amount_cents: 1 }],
    p_installments: [{ installment_number: 1, amount_cents: 1, due_date: '2026-10-08', shares: [{ user_id: adminUser.id, amount_cents: 1 }] }],
  })
  assert(Boolean(invalidAmount.error), 'RPC recusa valor nulo/zero/negativo ou fora do limite')
  const invalidTotal = await adminSession.client.rpc('create_expense_with_schedule', {
    p_group_id: group1.id, p_description: 'total inválido', p_category: 'outros',
    p_amount_cents: 100, p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null, p_split_mode: 'custom', p_rounding_remainder_cents: 0,
    p_shares: [{ user_id: adminUser.id, amount_cents: 99 }],
    p_installments: [{ installment_number: 1, amount_cents: 100, due_date: '2026-10-08', shares: [{ user_id: adminUser.id, amount_cents: 100 }] }],
  })
  assert(Boolean(invalidTotal.error), 'RPC recusa parcelas cuja soma não fecha o total')
  const invalidCustomRemainder = await adminSession.client.rpc('create_expense_with_schedule', {
    p_group_id: group1.id, p_description: 'custom com resto inválido', p_category: 'outros', p_amount_cents: 100,
    p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null, p_split_mode: 'custom', p_rounding_remainder_cents: 1,
    p_shares: [{ user_id: adminUser.id, amount_cents: 99 }],
    p_installments: [{ installment_number: 1, amount_cents: 100, due_date: '2026-10-08', shares: [{ user_id: adminUser.id, amount_cents: 99 }] }],
  })
  assert(Boolean(invalidCustomRemainder.error), 'RPC exige que valores personalizados fechem sem resto')

  const updatedSplit = sharesFor(1005)
  const updatedShares = updatedSplit.shares
  const updatedInstallments = scheduleFor(1005, updatedSplit, 2, '2026-10-07')
  const forbiddenMemberEdit = await memberSession.client.rpc('update_expense_with_schedule', {
    p_expense_id: createdExpenseId, p_description: 'edição de membro recusada', p_category: 'outros',
    p_amount_cents: 1005, p_paid_by: memberUser.id, p_expense_date: '2026-10-07', p_notes: null, p_split_mode: 'equal', p_rounding_remainder_cents: updatedSplit.remainderCents,
    p_shares: updatedShares,
    p_installments: updatedInstallments,
  })
  assert(Boolean(forbiddenMemberEdit.error), 'membro comum não edita despesa por RPC')
  const forbiddenMemberDelete = await memberSession.client.rpc('delete_expense', { p_expense_id: createdExpenseId })
  assert(Boolean(forbiddenMemberDelete.error), 'membro comum não exclui despesa por RPC')
  await updateExpense(adminSession.client, createdExpenseId, expenseValues(1005, updatedSplit, {
    description: `${prefix} almoço editado`, category: 'atividades', paidBy: member2User.id,
    expenseDate: '2026-10-07', notes: 'edição autorizada', installments: updatedInstallments,
  }))
  const updatedRows = await listGroupExpenses(adminSession.client, group1.id)
  const updatedExpense = updatedRows.find((expense) => expense.id === createdExpenseId)
  assert(updatedExpense?.description.endsWith('almoço editado') && updatedExpense.paid_by === member2User.id
    && updatedExpense.shares.reduce((total, share) => total + share.amount_cents, 0) + updatedExpense.rounding_remainder_cents === 1005
    && updatedExpense.installments.length === 2,
  'admin edita campos, rateio e cronograma em uma operação atômica')

  balances = calculateBalances(updatedRows, memberIds)
  assert(balances.reduce((sum, balance) => sum + balance.balance_cents, 0) === 0
    && balances.find((balance) => balance.user_id === adminUser.id)?.balance_cents === -668,
  'edição atualiza os saldos com o novo pagador e divisão')
  assert(calculateBalances(updatedRows, memberIds, '2026-10').reduce((sum, row) => sum + row.balance_cents, 0) === 0
    && calculateBalances(updatedRows, memberIds, '2026-11').reduce((sum, row) => sum + row.balance_cents, 0) === 0,
  'edição recalcula saldos mensais a partir do novo cronograma')

  const forbiddenEdit = await outsiderSession.client.rpc('update_expense_with_schedule', {
    p_expense_id: createdExpenseId, p_description: 'edição externa', p_category: 'outros',
    p_amount_cents: 1005, p_paid_by: adminUser.id, p_expense_date: '2026-10-07', p_notes: null, p_split_mode: 'equal', p_rounding_remainder_cents: updatedSplit.remainderCents,
    p_shares: updatedShares,
    p_installments: updatedInstallments,
  })
  assert(Boolean(forbiddenEdit.error), 'usuário de outro grupo não edita a despesa')
  const forbiddenDelete = await outsiderSession.client.rpc('delete_expense', { p_expense_id: createdExpenseId })
  assert(Boolean(forbiddenDelete.error), 'usuário de outro grupo não exclui a despesa')
  const memberProbe = await memberSession.client.rpc('is_current_user_group_member', { p_group_id: group2.id })
  const adminProbe = await memberSession.client.rpc('is_current_user_group_admin', { p_group_id: group1.id })
  const profileProbe = await memberSession.client.rpc('can_current_user_view_profile', { p_profile_id: adminUser.id })
  assert(Boolean(memberProbe.error) && Boolean(adminProbe.error) && Boolean(profileProbe.error),
    'funções auxiliares de autorização não podem ser sondadas como RPCs no schema público')
  const privateProbe = await memberSession.client.schema('private').rpc('is_current_user_group_member', { p_group_id: group2.id })
  assert(Boolean(privateProbe.error), 'schema private não é exposto pela API PostgREST')
  const { error: directShareError } = await adminSession.client.from('expense_shares')
    .insert({ expense_id: createdExpenseId, group_id: group1.id, user_id: adminUser.id, amount_cents: 1005 })
  assert(Boolean(directShareError), 'INSERT direto em expense_shares permanece bloqueado')

  const deleteWithExpenses = await adminSession.client.rpc('delete_empty_group', { p_group_id: group1.id })
  assert(Boolean(deleteWithExpenses.error), 'admin não exclui grupo que possui histórico de despesas')
  const outsiderDeleteGroup = await outsiderSession.client.rpc('delete_empty_group', { p_group_id: group1.id })
  assert(Boolean(outsiderDeleteGroup.error), 'pessoa sem acesso não exclui grupo por RPC')

  await deleteExpense(adminSession.client, secondExpenseId)
  await deleteExpense(adminSession.client, createdExpenseId)
  const emptyExpenses = await listGroupExpenses(adminSession.client, group1.id)
  assert(emptyExpenses.length === 0 && calculateBalances(emptyExpenses, memberIds).every((balance) => balance.balance_cents === 0),
    'excluir despesas e parcelas restaura saldo zero para todos os participantes')

  const unauthorizedArchive = await outsiderSession.client.rpc('set_group_archived', { p_group_id: group1.id, p_archived: true })
  assert(Boolean(unauthorizedArchive.error), 'pessoa sem acesso não arquiva grupo por RPC')
  const memberArchive = await memberSession.client.rpc('set_group_archived', { p_group_id: group1.id, p_archived: true })
  assert(!memberArchive.error, 'qualquer participante pode arquivar o grupo por RPC')
  const directArchiveUpdate = await memberSession.client.from('groups').update({ archived_at: null }).eq('id', group1.id).select('id')
  assert(Boolean(directArchiveUpdate.error) || !directArchiveUpdate.data?.length, 'membro não altera arquivo por escrita direta na tabela')
  const { data: archivedGroup, error: archivedGroupError } = await memberSession.client.from('groups').select('archived_at').eq('id', group1.id).single()
  if (archivedGroupError) throw archivedGroupError
  assert(Boolean(archivedGroup.archived_at), 'grupo arquivado permanece consultável com dados preservados')
  const restoreGroup = await adminSession.client.rpc('set_group_archived', { p_group_id: group1.id, p_archived: false })
  assert(!restoreGroup.error, 'membro pode restaurar grupo arquivado')
  const emptyGroup = await createGroup(adminSession.client, adminUser.id, { name: `${prefix} empty`, description: '' })
  const { error: addFixtureMemberError } = await admin.from('group_members').insert({ group_id: emptyGroup.id, user_id: memberUser.id, role: 'member' })
  if (addFixtureMemberError) throw addFixtureMemberError
  const memberDelete = await memberSession.client.rpc('delete_empty_group', { p_group_id: emptyGroup.id })
  assert(Boolean(memberDelete.error), 'membro sem papel admin não exclui grupo vazio por RPC')
  const directGroupDelete = await memberSession.client.from('groups').delete().eq('id', emptyGroup.id).select('id')
  assert(Boolean(directGroupDelete.error) || !directGroupDelete.data?.length, 'DELETE direto em groups continua bloqueado')
  const creatorDelete = await adminSession.client.rpc('delete_empty_group', { p_group_id: emptyGroup.id })
  assert(!creatorDelete.error, 'criador/admin pode excluir definitivamente grupo vazio')

  const { data: outsiderRead, error: outsiderReadError } = await outsiderSession.client
    .from('groups').select('id').eq('id', group1.id).maybeSingle()
  if (outsiderReadError) throw outsiderReadError
  const { data: outsiderMembers, error: outsiderMembersError } = await outsiderSession.client
    .from('group_members').select('user_id').eq('group_id', group1.id)
  if (outsiderMembersError) throw outsiderMembersError
  const { data: outsiderProfiles, error: outsiderProfilesError } = await outsiderSession.client
    .from('profiles').select('id').eq('id', adminUser.id)
  if (outsiderProfilesError) throw outsiderProfilesError
  assert(!outsiderRead && outsiderMembers.length === 0 && outsiderProfiles.length === 0,
    'usuário de outro grupo não lê grupo, participantes nem perfis')

  const { data: isolatedRead, error: isolatedReadError } = await isolatedSession.client
    .from('groups').select('id').eq('id', group1.id).maybeSingle()
  if (isolatedReadError) throw isolatedReadError
  assert(!isolatedRead, 'usuário sem associação não lê o grupo')

  const { error: forgedCreateError } = await outsiderSession.client.from('groups').insert({
    name: `${prefix} forged`, created_by: adminUser.id,
  })
  assert(Boolean(forgedCreateError), 'criação com created_by de outra conta é recusada')

  const { error: adminUpdateError } = await adminSession.client.from('groups')
    .update({ name: `${prefix} G1 atualizado` }).eq('id', group1.id)
  if (adminUpdateError) throw adminUpdateError
  const { data: memberUpdate, error: memberUpdateError } = await memberSession.client.from('groups')
    .update({ name: `${prefix} alterado por membro` }).eq('id', group1.id).select('id')
  if (memberUpdateError && memberUpdateError.code !== '42501') throw memberUpdateError
  const { data: finalGroup, error: finalGroupError } = await adminSession.client
    .from('groups').select('name').eq('id', group1.id).single()
  if (finalGroupError) throw finalGroupError
  assert((memberUpdate ?? []).length === 0 && finalGroup.name === `${prefix} G1 atualizado`,
    'admin edita o grupo e membro comum não altera seu nome')

  const { error: memberPromoteError } = await memberSession.client.from('group_members').insert({
    group_id: group1.id, user_id: memberUser.id, role: 'admin',
  })
  assert(Boolean(memberPromoteError), 'escrita direta em group_members é recusada, inclusive autopromoção')

  const { error: memberRoleUpdateError } = await memberSession.client.from('group_members')
    .update({ role: 'admin' }).eq('group_id', group1.id).eq('user_id', memberUser.id)
  assert(Boolean(memberRoleUpdateError), 'UPDATE direto em group_members é recusado')
  const { error: memberDeleteError } = await adminSession.client.from('group_members')
    .delete().eq('group_id', group1.id).eq('user_id', memberUser.id)
  assert(Boolean(memberDeleteError), 'DELETE direto em group_members é recusado, inclusive por admin')

  const { error: memberInviteError } = await memberSession.client.from('group_invitations').insert({
    group_id: group1.id,
    invited_email: `rls-other-${suffix}@example.test`,
    invited_by: memberUser.id,
    status: 'pending',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
  assert(Boolean(memberInviteError), 'membro comum não cria convite')

  const pendingForOutsider = await createGroupInvitation(adminSession.client, group1.id, accounts.outsider.email)
  const outsiderInbox = await outsiderSession.client.rpc('list_my_group_invitations')
  const isolatedInbox = await isolatedSession.client.rpc('list_my_group_invitations')
  assert(!outsiderInbox.error && outsiderInbox.data.some((row) => row.id === pendingForOutsider.id)
    && !isolatedInbox.error && isolatedInbox.data.length === 0,
  'caixa de entrada mostra apenas convites destinados ao e-mail autenticado')
  const duplicateInvite = await adminSession.client.rpc('manage_group_invitation', {
    p_group_id: group1.id, p_email: accounts.outsider.email, p_action: 'create', p_invitation_id: null,
  })
  assert(Boolean(duplicateInvite.error), 'convites duplicados ativos são recusados pelo servidor')
  const directResend = await adminSession.client.rpc('manage_group_invitation', {
    p_group_id: group1.id, p_email: '', p_action: 'resend', p_invitation_id: pendingForOutsider.id,
  })
  assert(Boolean(directResend.error), 'reenvio direto por RPC é recusado e exige a concessão da Edge Function')
  const outsiderAccept = await outsiderSession.client.rpc('accept_group_invitation', { p_invitation_id: pendingForOutsider.id })
  assert(!outsiderAccept.error && outsiderAccept.data === group1.id, 'destinatário autenticado aceita convite válido')
  const outsiderMembershipNow = await adminSession.client.from('group_members').select('active').eq('group_id', group1.id).eq('user_id', outsiderUser.id).single()
  const acceptedInviteStatus = await adminSession.client.from('group_invitations').select('status').eq('id', pendingForOutsider.id).single()
  assert(outsiderMembershipNow.data?.active && acceptedInviteStatus.data?.status === 'accepted', 'aceite ativa a associação e atualiza o status do convite')
  const wrongInviteAccept = await isolatedSession.client.rpc('accept_group_invitation', { p_invitation_id: pendingForOutsider.id })
  assert(Boolean(wrongInviteAccept.error), 'outra conta não aceita convite alheio')
  const invitationForIsolated = await createGroupInvitation(adminSession.client, group1.id, accounts.isolated.email)
  const firstExpiry = (await adminSession.client.from('group_invitations').select('expires_at').eq('id', invitationForIsolated.id).single()).data.expires_at
  const claimFailureTest = await adminSession.client.rpc('claim_group_invitation_email', {
    p_group_id: group1.id, p_invitation_id: invitationForIsolated.id,
  })
  const firstClaim = claimFailureTest.data?.[0]
  assert(!claimFailureTest.error && Boolean(firstClaim?.claim_token), 'admin ativo obtém concessão temporária para enviar o convite')
  const concurrentClaim = await adminSession.client.rpc('claim_group_invitation_email', {
    p_group_id: group1.id, p_invitation_id: invitationForIsolated.id,
  })
  assert(Boolean(concurrentClaim.error), 'banco impede dois envios concorrentes do mesmo convite')
  const failedDelivery = await admin.rpc('finish_group_invitation_email', {
    p_invitation_id: invitationForIsolated.id, p_claim_token: firstClaim.claim_token, p_sent: false,
  })
  const afterFailure = await adminSession.client.from('group_invitations').select('status,expires_at,sending_token').eq('id', invitationForIsolated.id).single()
  assert(!failedDelivery.error && afterFailure.data?.status === 'pending' && afterFailure.data.expires_at === firstExpiry && afterFailure.data.sending_token === null,
    'falha de envio mantém status e validade e libera recuperação')
  const retryClaim = await adminSession.client.rpc('claim_group_invitation_email', {
    p_group_id: group1.id, p_invitation_id: invitationForIsolated.id,
  })
  const retryToken = retryClaim.data?.[0]?.claim_token
  const successfulDelivery = await admin.rpc('finish_group_invitation_email', {
    p_invitation_id: invitationForIsolated.id, p_claim_token: retryToken, p_sent: true,
  })
  const renewedInvite = await adminSession.client.from('group_invitations').select('status,expires_at').eq('id', invitationForIsolated.id).single()
  assert(!retryClaim.error && !successfulDelivery.error && renewedInvite.data?.status === 'sent' && renewedInvite.data.expires_at > firstExpiry,
    'envio confirmado muda para enviado e renova a validade por 14 dias')
  const canceledInvite = await adminSession.client.rpc('manage_group_invitation', {
    p_group_id: group1.id, p_email: '', p_action: 'cancel', p_invitation_id: invitationForIsolated.id,
  })
  const canceledInbox = await isolatedSession.client.rpc('list_my_group_invitations')
  assert(!canceledInvite.error && canceledInbox.data.every((row) => row.id !== invitationForIsolated.id),
    'admin cancela convite enviado e ele deixa de aparecer na caixa de entrada')
  const canceledAcceptance = await isolatedSession.client.rpc('accept_group_invitation', { p_invitation_id: invitationForIsolated.id })
  assert(Boolean(canceledAcceptance.error), 'convite cancelado não pode ser aceito')
  const expiredInvitation = await createGroupInvitation(adminSession.client, group1.id, accounts.isolated.email)
  await admin.from('group_invitations').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', expiredInvitation.id)
  const expiredInbox = await isolatedSession.client.rpc('list_my_group_invitations')
  const expiredAcceptance = await isolatedSession.client.rpc('accept_group_invitation', { p_invitation_id: expiredInvitation.id })
  const expiredSendClaim = await adminSession.client.rpc('claim_group_invitation_email', {
    p_group_id: group1.id, p_invitation_id: expiredInvitation.id,
  })
  assert(expiredInbox.data?.some((row) => row.id === expiredInvitation.id && row.status === 'expired')
    && Boolean(expiredAcceptance.error) && Boolean(expiredSendClaim.error),
  'convite expirado é exibido como tal e falha no aceite e no novo envio')

  const memberEdit = await adminSession.client.rpc('update_group_member', {
    p_group_id: group1.id, p_user_id: memberUser.id, p_role: 'admin',
  })
  const updatedMember = await adminSession.client.from('group_members').select('role').eq('group_id', group1.id).eq('user_id', memberUser.id).single()
  assert(!memberEdit.error && updatedMember.data?.role === 'admin',
    `admin altera papel do participante via RPC (rpc=${memberEdit.error?.message ?? 'ok'}, row=${updatedMember.data?.role ?? 'missing'})`)
  const lastAdminDemotion = await adminSession.client.rpc('update_group_member', {
    p_group_id: group2.id, p_user_id: outsiderUser.id, p_role: 'member',
  })
  assert(Boolean(lastAdminDemotion.error), 'banco impede rebaixar o último administrador do grupo')

  const preservedExpenseId = await createExpense(adminSession.client, group1.id, expenseValues(600, sharesFor(600), {
    description: `${prefix} histórico preservado`, paidBy: member2User.id,
  }))
  const removal = await adminSession.client.rpc('remove_group_member', { p_group_id: group1.id, p_user_id: member2User.id })
  const preservedShare = await adminSession.client.from('expense_shares').select('user_id').eq('user_id', member2User.id).limit(1)
  const removedMembership = await adminSession.client.from('group_members').select('active').eq('group_id', group1.id).eq('user_id', member2User.id).single()
  const removedUserRead = await member2Session.client.from('groups').select('id').eq('id', group1.id).maybeSingle()
  const formerUserExpenses = await member2Session.client.from('expenses').select('id').eq('id', preservedExpenseId)
  const preservedHistory = await listGroupExpenses(adminSession.client, group1.id)
  const preservedRecord = preservedHistory.find((expense) => expense.id === preservedExpenseId)
  const historyBalances = calculateBalances(preservedHistory, memberIds)
  assert(!removal.error && removedMembership.data?.active === false && preservedShare.data?.length > 0
    && !removedUserRead.data && formerUserExpenses.data?.length === 0
    && preservedRecord?.installments.length === 1 && historyBalances.reduce((sum, row) => sum + row.balance_cents, 0) === 0,
  `remoção encerra acesso e preserva associação e rateios históricos (rpc=${removal.error?.message ?? 'ok'}, active=${removedMembership.data?.active}, shares=${preservedShare.data?.length}, groupReadable=${Boolean(removedUserRead.data)})`)

  const demotionAfterTransfer = await adminSession.client.rpc('update_group_member', {
    p_group_id: group1.id, p_user_id: adminUser.id, p_role: 'member',
  })
  assert(Boolean(demotionAfterTransfer.error), 'admin não pode alterar o próprio papel mesmo após promover outra pessoa')

  assert(group2.id !== group1.id && isolatedUser.id !== adminUser.id,
    'contas e grupos de teste são independentes')
  console.log(`Concluído: ${results.length} verificações locais passaram.`)
} finally {
  await cleanup()
}
