import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { createGroup, createGroupInvitation } from '../src/lib/groups.ts'
import { calculateBalances, createExpense, deleteExpense, listGroupExpenses, splitEvenly, suggestSettlements, updateExpense } from '../src/lib/expenses.ts'

const apiUrl = process.env.API_URL
const anonKey = process.env.ANON_KEY
const localServiceKey = process.env.SERVICE_ROLE_KEY

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
  const bootstrapEmails = [accounts.admin.email, accounts.outsider.email, accounts.isolated.email]
  if (!bootstrapEmails.every((email) => /^[a-z0-9-]+@example\.test$/.test(email))) {
    throw new Error('Unexpected generated test email format.')
  }
  const values = bootstrapEmails.map((email) => `('${email}', now() + interval '1 day')`).join(', ')
  const sql = `insert into public.bootstrap_invites (email, expires_at) values ${values};`
  execFileSync('docker', [
    'exec', 'supabase_db_splituai', 'psql', '-v', 'ON_ERROR_STOP=1',
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
    adminSession.client, adminUser.id, group1.id, `  ${memberEmail.toUpperCase()}  `,
  )
  assert(createdInvitation.invited_email === memberEmail,
    'função real do app normaliza o e-mail e permite convite a admin')
  const memberUser = await provisionUser(accounts.member)
  const memberSession = await signIn(accounts.member)
  const { data: memberMembership, error: memberMembershipError } = await memberSession.client
    .from('group_members').select('role').eq('group_id', group1.id).eq('user_id', memberUser.id).single()
  if (memberMembershipError) throw memberMembershipError
  assert(memberMembership.role === 'member',
    'criação da conta Auth com convite pendente associa somente o e-mail convidado como membro')

  await createGroupInvitation(adminSession.client, adminUser.id, group1.id, accounts.member2.email)
  const member2User = await provisionUser(accounts.member2)
  const member2Session = await signIn(accounts.member2)
  const { data: member2Membership, error: member2MembershipError } = await member2Session.client
    .from('group_members').select('role').eq('group_id', group1.id).eq('user_id', member2User.id).single()
  if (member2MembershipError) throw member2MembershipError
  assert(member2Membership.role === 'member', 'segundo participante de teste entra no grupo por convite válido')

  const { data: invitation, error: invitationReadError } = await adminSession.client
    .from('group_invitations').select('status').eq('group_id', group1.id).eq('invited_email', memberEmail).single()
  if (invitationReadError) throw invitationReadError
  assert(invitation.status === 'sent', 'trigger consome o convite pendente ao criar a conta Auth')
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

  const memberIds = [adminUser.id, memberUser.id, member2User.id]
  const sharesFor = (amountCents, ids = memberIds) => splitEvenly(amountCents, ids)
  const initialShares = sharesFor(1001)
  assert(initialShares.reduce((sum, share) => sum + share.amount_cents, 0) === 1001
    && initialShares.map((share) => share.amount_cents).join(',') === '334,334,333',
  'divisão de 1001 centavos entre três pessoas distribui os restos e fecha o total')
  const createdExpenseId = await createExpense(adminSession.client, group1.id, {
    description: `${prefix} almoço`, category: 'alimentacao', amountCents: 1001,
    paidBy: adminUser.id, expenseDate: '2026-10-08', notes: '', shares: initialShares,
  })
  const memberExpenses = await listGroupExpenses(memberSession.client, group1.id)
  const createdExpense = memberExpenses.find((expense) => expense.id === createdExpenseId)
  assert(createdExpense?.shares.reduce((total, share) => total + share.amount_cents, 0) === createdExpense?.amount_cents
    && createdExpense?.shares.length === 3,
  'membro autorizado lê a despesa compartilhada e as parcelas fecham o total')

  const secondExpenseId = await createExpense(memberSession.client, group1.id, {
    description: `${prefix} transporte`, category: 'transporte', amountCents: 1000,
    paidBy: memberUser.id, expenseDate: '2026-10-08', notes: '', shares: sharesFor(1000),
  })
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
  const outsiderExpenses = await listGroupExpenses(outsiderSession.client, group1.id)
  assert(outsiderExpenses.length === 0, 'usuário de outro grupo não lista despesas nem parcelas')

  const invalidParticipant = await adminSession.client.rpc('create_expense_with_shares', {
    p_group_id: group1.id, p_description: 'participante inválido', p_category: 'outros',
    p_amount_cents: 100, p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null,
    p_shares: [{ user_id: outsiderUser.id, amount_cents: 100 }],
  })
  assert(Boolean(invalidParticipant.error), 'RPC recusa participante que pertence a outro grupo')
  const invalidAmount = await adminSession.client.rpc('create_expense_with_shares', {
    p_group_id: group1.id, p_description: 'valor inválido', p_category: 'outros',
    p_amount_cents: -1, p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null,
    p_shares: [{ user_id: adminUser.id, amount_cents: 1 }],
  })
  assert(Boolean(invalidAmount.error), 'RPC recusa valor nulo/zero/negativo ou fora do limite')
  const invalidTotal = await adminSession.client.rpc('create_expense_with_shares', {
    p_group_id: group1.id, p_description: 'total inválido', p_category: 'outros',
    p_amount_cents: 100, p_paid_by: adminUser.id, p_expense_date: '2026-10-08', p_notes: null,
    p_shares: [{ user_id: adminUser.id, amount_cents: 99 }],
  })
  assert(Boolean(invalidTotal.error), 'RPC recusa parcelas cuja soma não fecha o total')

  const updatedShares = sharesFor(1005)
  const forbiddenMemberEdit = await memberSession.client.rpc('update_expense_with_shares', {
    p_expense_id: createdExpenseId, p_description: 'edição de membro recusada', p_category: 'outros',
    p_amount_cents: 1005, p_paid_by: memberUser.id, p_expense_date: '2026-10-07', p_notes: null,
    p_shares: updatedShares,
  })
  assert(Boolean(forbiddenMemberEdit.error), 'membro comum não edita despesa por RPC')
  const forbiddenMemberDelete = await memberSession.client.rpc('delete_expense', { p_expense_id: createdExpenseId })
  assert(Boolean(forbiddenMemberDelete.error), 'membro comum não exclui despesa por RPC')
  await updateExpense(adminSession.client, createdExpenseId, {
    description: `${prefix} almoço editado`, category: 'atividades', amountCents: 1005,
    paidBy: member2User.id, expenseDate: '2026-10-07', notes: 'edição autorizada', shares: updatedShares,
  })
  const updatedRows = await listGroupExpenses(adminSession.client, group1.id)
  const updatedExpense = updatedRows.find((expense) => expense.id === createdExpenseId)
  assert(updatedExpense?.description.endsWith('almoço editado') && updatedExpense.paid_by === member2User.id
    && updatedExpense.shares.reduce((total, share) => total + share.amount_cents, 0) === 1005,
  'admin edita os campos e parcelas em uma operação atômica')

  balances = calculateBalances(updatedRows, memberIds)
  assert(balances.reduce((sum, balance) => sum + balance.balance_cents, 0) === 0
    && balances.find((balance) => balance.user_id === adminUser.id)?.balance_cents === -669,
  'edição atualiza os saldos com o novo pagador e divisão')

  const forbiddenEdit = await outsiderSession.client.rpc('update_expense_with_shares', {
    p_expense_id: createdExpenseId, p_description: 'edição externa', p_category: 'outros',
    p_amount_cents: 1005, p_paid_by: adminUser.id, p_expense_date: '2026-10-07', p_notes: null,
    p_shares: updatedShares,
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

  await deleteExpense(adminSession.client, secondExpenseId)
  await deleteExpense(adminSession.client, createdExpenseId)
  const emptyExpenses = await listGroupExpenses(adminSession.client, group1.id)
  assert(emptyExpenses.length === 0 && calculateBalances(emptyExpenses, memberIds).every((balance) => balance.balance_cents === 0),
    'excluir despesas e parcelas restaura saldo zero para todos os participantes')

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

  assert(group2.id !== group1.id && isolatedUser.id !== adminUser.id,
    'contas e grupos de teste são independentes')
  console.log(results.join('\n'))
  console.log(`Concluído: ${results.length} verificações locais passaram.`)
} finally {
  await cleanup()
}
