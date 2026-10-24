import type { SupabaseClient } from '@supabase/supabase-js'

export type ExpenseCategory = 'hospedagem' | 'alimentacao' | 'transporte' | 'corrida' | 'atividades' | 'outros' | 'aluguel' | 'luz' | 'agua' | 'iptu' | 'internet' | 'viagens' | 'streaming' | 'fitness' | 'fatura_cartao' | 'acerto_outros_grupos' | 'transporte_gasolina' | 'transporte_aluguel_veiculo' | 'transporte_onibus' | 'transporte_aviao' | 'transporte_corrida_app' | 'transporte_pedagio' | 'transporte_multas' | 'transporte_ipva' | 'transporte_manutencao'
export type SplitMode = 'equal' | 'percentage' | 'custom'
export type ExpenseShare = { user_id: string; amount_cents: number; percentage?: number | null }
export type ExpenseInstallment = {
  installment_number: number
  amount_cents: number
  due_date: string
  shares: ExpenseShare[]
}
export type ExpenseInstallmentRecord = Omit<ExpenseInstallment, 'shares'> & {
  id: string
  shares: ExpenseShare[]
}
export type ExpenseRecord = {
  id: string
  group_id: string
  created_by: string
  paid_by: string
  description: string
  category: ExpenseCategory
  amount_cents: number
  currency: 'BRL'
  expense_date: string
  notes: string | null
  created_at: string
  updated_at: string
  split_mode: SplitMode
  rounding_remainder_cents: number
  recurring_series_id: string | null
  shares: ExpenseShare[]
  installments: ExpenseInstallmentRecord[]
}
export type SettlementRecord = {
  id: string
  group_id: string
  created_by: string
  paid_by: string
  received_by: string
  amount_cents: number
  settlement_date: string
  description: string
  payment_method: SettlementPaymentMethod
  status: 'pending' | 'paid'
  paid_at: string | null
  created_at: string
}
export type SettlementPaymentMethod = 'pix' | 'dinheiro' | 'transferencia' | 'cartao' | 'outro' | 'splitwise'
export type ExpenseInput = {
  description: string
  category: ExpenseCategory
  amountCents: number
  paidBy: string
  expenseDate: string
  notes: string
  splitMode: SplitMode
  roundingRemainderCents: number
  shares: ExpenseShare[]
  installments: ExpenseInstallment[]
}
export type GroupBalance = { user_id: string; balance_cents: number }
export type SettlementSuggestion = { from_user_id: string; to_user_id: string; amount_cents: number }

export function calculateBalances(expenses: ExpenseRecord[], memberIds: string[], month?: string, settlements: SettlementRecord[] = []): GroupBalance[] {
  const balances = new Map<string, bigint>([...new Set(memberIds)].map((id) => [id, 0n]))
  const add = (id: string, cents: bigint) => {
    if (!balances.has(id)) throw new Error('Uma despesa referencia alguém que não está no grupo.')
    balances.set(id, balances.get(id)! + cents)
  }
  for (const expense of expenses) {
    if (!Number.isSafeInteger(expense.amount_cents) || expense.amount_cents < 1) throw new Error('Total de despesa inválido.')
    if (!Number.isSafeInteger(expense.rounding_remainder_cents) || expense.rounding_remainder_cents < 0) throw new Error('Ajuste de arredondamento inválido.')
    if (month) {
      for (const installment of expense.installments) {
        if (installment.due_date.slice(0, 7) !== month) continue
        if (!Number.isSafeInteger(installment.amount_cents) || installment.amount_cents < 1) throw new Error('Parcela inválida.')
        add(expense.paid_by, BigInt(installment.amount_cents))
        let sum = 0n
        for (const share of installment.shares) {
          if (!Number.isSafeInteger(share.amount_cents) || share.amount_cents < 0) throw new Error('Rateio de parcela inválido.')
          sum += BigInt(share.amount_cents)
          add(share.user_id, -BigInt(share.amount_cents))
        }
        const adjustment = installment.installment_number === expense.installments.length
          ? BigInt(expense.rounding_remainder_cents) : 0n
        if (sum + adjustment !== BigInt(installment.amount_cents)) throw new Error('As parcelas não fecham com o cronograma.')
        if (adjustment) add(expense.paid_by, -adjustment)
      }
    } else {
      add(expense.paid_by, BigInt(expense.amount_cents))
      let sum = 0n
      for (const share of expense.shares) {
        if (!Number.isSafeInteger(share.amount_cents) || share.amount_cents < 0) throw new Error('Rateio inválido.')
        sum += BigInt(share.amount_cents)
        add(share.user_id, -BigInt(share.amount_cents))
      }
      const adjustment = BigInt(expense.rounding_remainder_cents)
      if (sum + adjustment !== BigInt(expense.amount_cents)) throw new Error('Rateio e ajuste não fecham com o total.')
      if (adjustment) add(expense.paid_by, -adjustment)
    }
  }
  for (const settlement of settlements) {
    if (settlement.status === 'pending') continue
    if (month && settlement.settlement_date.slice(0, 7) !== month) continue
    if (!Number.isSafeInteger(settlement.amount_cents) || settlement.amount_cents < 1) throw new Error('Valor de acerto inválido.')
    add(settlement.paid_by, BigInt(settlement.amount_cents))
    add(settlement.received_by, -BigInt(settlement.amount_cents))
  }
  if ([...balances.values()].reduce((sum, balance) => sum + balance, 0n) !== 0n) throw new Error('Os saldos do grupo não fecham em zero.')
  return [...balances].map(([user_id, balance]) => {
    if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('O saldo acumulado excede o limite de cálculo seguro em centavos.')
    return { user_id, balance_cents: Number(balance) }
  })
}

export function suggestSettlements(balances: GroupBalance[]): SettlementSuggestion[] {
  if (balances.some((balance) => !Number.isSafeInteger(balance.balance_cents)) || balances.reduce((sum, balance) => sum + BigInt(balance.balance_cents), 0n) !== 0n) {
    throw new Error('Os saldos precisam ser inteiros seguros e somar zero.')
  }
  const debtors = balances.filter((balance) => balance.balance_cents < 0).map((balance) => ({ user_id: balance.user_id, remaining: -balance.balance_cents })).sort((a, b) => a.user_id.localeCompare(b.user_id))
  const creditors = balances.filter((balance) => balance.balance_cents > 0).map((balance) => ({ user_id: balance.user_id, remaining: balance.balance_cents })).sort((a, b) => a.user_id.localeCompare(b.user_id))
  const suggestions: SettlementSuggestion[] = []
  let debtorIndex = 0
  let creditorIndex = 0
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount_cents = Math.min(debtors[debtorIndex].remaining, creditors[creditorIndex].remaining)
    suggestions.push({ from_user_id: debtors[debtorIndex].user_id, to_user_id: creditors[creditorIndex].user_id, amount_cents })
    debtors[debtorIndex].remaining -= amount_cents
    creditors[creditorIndex].remaining -= amount_cents
    if (debtors[debtorIndex].remaining === 0) debtorIndex += 1
    if (creditors[creditorIndex].remaining === 0) creditorIndex += 1
  }
  return suggestions
}

export function parseBrlCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor positivo com até duas casas decimais.')
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 999999999999) throw new Error('O valor deve ser positivo e menor que R$ 10 bilhões.')
  return cents
}

export function formatBrlCents(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function splitEvenly(totalCents: number, participantIds: string[]) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 1) throw new Error('O valor precisa ser positivo.')
  const uniqueIds = [...new Set(participantIds)]
  if (!uniqueIds.length) throw new Error('Selecione ao menos uma pessoa para dividir a despesa.')
  const base = Math.floor(totalCents / uniqueIds.length)
  return { shares: uniqueIds.map((user_id) => ({ user_id, amount_cents: base })), remainderCents: totalCents % uniqueIds.length }
}

export function allocatePercentage(totalCents: number, percentages: Record<string, number>): ExpenseShare[] {
  const entries = Object.entries(percentages)
  if (!entries.length || entries.some(([, value]) => !Number.isFinite(value) || value < 0) || Math.abs(entries.reduce((sum, [, value]) => sum + value, 0) - 100) > 0.000001) {
    throw new Error('As porcentagens devem ser válidas e somar exatamente 100%.')
  }
  const rows = entries.map(([user_id, percentage]) => {
    const raw = totalCents * percentage / 100
    return { user_id, amount_cents: Math.floor(raw), fraction: raw - Math.floor(raw) }
  })
  let remainder = totalCents - rows.reduce((sum, row) => sum + row.amount_cents, 0)
  const order = [...rows].sort((a, b) => b.fraction - a.fraction || a.user_id.localeCompare(b.user_id))
  for (let i = 0; remainder > 0; i++, remainder--) order[i % order.length].amount_cents++
  return rows.map(({ user_id, amount_cents }, index) => ({ user_id, amount_cents, percentage: entries[index][1] }))
}

export function makeInstallmentShares(shares: ExpenseShare[], installments: Array<{ amount_cents: number; due_date: string }>, remainderCents: number): ExpenseInstallment[] {
  if (!installments.length || installments.length > 60) throw new Error('Use de 1 a 60 parcelas.')
  if (installments.some((row) => !Number.isSafeInteger(row.amount_cents) || row.amount_cents < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(row.due_date))) throw new Error('Confira os valores e vencimentos das parcelas.')
  const totalCents = installments.reduce((sum, row) => sum + row.amount_cents, 0)
  const targetTotal = shares.reduce((sum, share) => sum + share.amount_cents, 0)
  if (totalCents !== targetTotal + remainderCents) throw new Error('A soma das parcelas deve fechar com o total da despesa.')
  const remaining = new Map(shares.map((share) => [share.user_id, share.amount_cents]))
  let remainingTotal = targetTotal
  return installments.map((installment, index) => {
    const adjustment = index === installments.length - 1 ? remainderCents : 0
    const shareTarget = installment.amount_cents - adjustment
    let rowShares: ExpenseShare[]
    if (index === installments.length - 1) {
      rowShares = [...remaining].map(([user_id, amount_cents]) => ({ user_id, amount_cents }))
    } else {
      const allocated = [...remaining].map(([user_id, amount_cents]) => {
        const raw = remainingTotal ? amount_cents * shareTarget / remainingTotal : 0
        return { user_id, amount_cents: Math.floor(raw), fraction: raw - Math.floor(raw), limit: amount_cents }
      })
      let centsLeft = shareTarget - allocated.reduce((sum, row) => sum + row.amount_cents, 0)
      const order = [...allocated].sort((a, b) => b.fraction - a.fraction || a.user_id.localeCompare(b.user_id))
      while (centsLeft > 0) {
        const next = order.find((row) => row.amount_cents < row.limit)
        if (!next) throw new Error('Não foi possível distribuir o cronograma entre os participantes.')
        next.amount_cents++
        centsLeft--
      }
      rowShares = allocated.map(({ user_id, amount_cents }) => ({ user_id, amount_cents }))
    }
    for (const share of rowShares) remaining.set(share.user_id, remaining.get(share.user_id)! - share.amount_cents)
    remainingTotal -= shareTarget
    return { installment_number: index + 1, ...installment, shares: rowShares }
  })
}

export function generateMonthlySchedule(totalCents: number, count: number, firstDueDate: string, shares: ExpenseShare[], remainderCents: number) {
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error('Use de 1 a 60 parcelas.')
  const base = Math.floor(totalCents / count)
  let remainder = totalCents % count
  const [year, month, day] = firstDueDate.split('-').map(Number)
  const schedule = Array.from({ length: count }, (_, index) => {
    const targetMonth = month - 1 + index
    const targetYear = year + Math.floor(targetMonth / 12)
    const normalizedMonth = targetMonth % 12
    const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate()
    return {
      amount_cents: base + (remainder-- > 0 ? 1 : 0),
      due_date: `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`,
    }
  })
  return makeInstallmentShares(shares, schedule, remainderCents)
}

export async function listGroupExpenses(client: SupabaseClient, groupId: string) {
  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const generated = await client.rpc('ensure_recurring_expenses_through', { p_group_id: groupId, p_through_month: currentMonth })
  if (generated.error && !['42883','PGRST202'].includes(generated.error.code ?? '')) throw generated.error
  const { data: expenseRows, error: expensesError } = await client.from('expenses')
    .select('id, group_id, created_by, paid_by, description, category, amount_cents, currency, expense_date, notes, created_at, updated_at, split_mode, rounding_remainder_cents, recurring_series_id')
    .eq('group_id', groupId).order('expense_date', { ascending: false }).order('created_at', { ascending: false })
  if (expensesError) throw expensesError
  const expenses = (expenseRows ?? []) as Omit<ExpenseRecord, 'shares' | 'installments'>[]
  if (!expenses.length) return [] as ExpenseRecord[]
  const ids = expenses.map((expense) => expense.id)
  const batches = <T,>(values: T[], size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
  const idBatches = batches(ids)
  const [shareResults, installmentResults] = await Promise.all([
    Promise.all(idBatches.map((batch) => client.from('expense_shares')
      .select('expense_id,user_id,amount_cents,split_percentage').eq('group_id', groupId).in('expense_id', batch))),
    Promise.all(idBatches.map((batch) => client.from('expense_installments')
      .select('id,expense_id,installment_number,amount_cents,due_date').in('expense_id', batch).order('installment_number'))),
  ])
  for (const result of [...shareResults, ...installmentResults]) if (result.error) throw result.error
  const installmentRows = installmentResults.flatMap((result) => result.data ?? [])
  const installmentIdBatches = batches(installmentRows.map((row) => row.id))
  const installmentShareResults = await Promise.all(installmentIdBatches.map((batch) => client.from('expense_installment_shares')
    .select('installment_id,user_id,amount_cents').in('installment_id', batch)))
  for (const result of installmentShareResults) if (result.error) throw result.error
  const shares = new Map<string, ExpenseShare[]>()
  for (const row of shareResults.flatMap((result) => result.data ?? [])) shares.set(row.expense_id, [...(shares.get(row.expense_id) ?? []), { user_id: row.user_id, amount_cents: Number(row.amount_cents), percentage: row.split_percentage == null ? null : Number(row.split_percentage) }])
  const installmentShares = new Map<string, ExpenseShare[]>()
  for (const row of installmentShareResults.flatMap((result) => result.data ?? [])) installmentShares.set(row.installment_id, [...(installmentShares.get(row.installment_id) ?? []), { user_id: row.user_id, amount_cents: Number(row.amount_cents) }])
  const installments = new Map<string, ExpenseInstallmentRecord[]>()
  for (const row of installmentRows) installments.set(row.expense_id, [...(installments.get(row.expense_id) ?? []), {
    id: row.id, installment_number: row.installment_number, amount_cents: Number(row.amount_cents), due_date: row.due_date,
    shares: installmentShares.get(row.id) ?? [],
  }])
  return expenses.map((expense) => ({ ...expense, amount_cents: Number(expense.amount_cents), rounding_remainder_cents: Number(expense.rounding_remainder_cents),
    shares: shares.get(expense.id) ?? [], installments: installments.get(expense.id) ?? [] })) as ExpenseRecord[]
}

export async function listGroupSettlements(client: SupabaseClient, groupId: string) {
  const { data, error } = await client.from('group_settlements')
    .select('id,group_id,created_by,paid_by,received_by,amount_cents,settlement_date,description,payment_method,status,paid_at,created_at')
    .eq('group_id', groupId).order('settlement_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({ ...row, amount_cents: Number(row.amount_cents) })) as SettlementRecord[]
}

export async function createGroupSettlement(client: SupabaseClient, input: {
  groupId: string
  receivedBy: string
  amountCents: number
  settlementDate: string
  paymentMethod: Exclude<SettlementPaymentMethod, 'splitwise'>
  status: 'pending' | 'paid'
}) {
  if (!input.receivedBy) throw new Error('Escolha quem recebeu o pagamento.')
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) throw new Error('Informe um valor válido para o acerto.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.settlementDate)) throw new Error('Informe uma data válida para o pagamento.')
  const { data, error } = await client.rpc('create_group_settlement', {
    p_group_id: input.groupId,
    p_received_by: input.receivedBy,
    p_amount_cents: input.amountCents,
    p_settlement_date: input.settlementDate,
    p_payment_method: input.paymentMethod,
    p_status: input.status,
  })
  if (error) throw new Error(error.message || `Falha ao registrar acerto (${error.code ?? 'erro desconhecido'}).`)
  return data as string
}

export async function markGroupSettlementPaid(client: SupabaseClient, settlementId: string) {
  const { error } = await client.rpc('mark_group_settlement_paid', { p_settlement_id: settlementId })
  if (error) throw new Error(error.message || `Falha ao confirmar pagamento (${error.code ?? 'erro desconhecido'}).`)
}

export type SplitwiseImportExpense = {
  source_key: string
  description: string
  category: ExpenseCategory
  amount_cents: number
  paid_by: string
  expense_date: string
  notes: string | null
  shares: ExpenseShare[]
}
export type SplitwiseImportSettlement = {
  source_key: string
  paid_by: string
  received_by: string
  amount_cents: number
  settlement_date: string
  description: string
}

export async function importSplitwiseHistory(client: SupabaseClient, groupId: string, expenses: SplitwiseImportExpense[], settlements: SplitwiseImportSettlement[]) {
  const { data, error } = await client.rpc('import_splitwise_history', {
    p_group_id: groupId, p_expenses: expenses, p_settlements: settlements,
  })
  if (error) throw new Error(error.message || `Falha na importação (${error.code ?? 'erro desconhecido'}).`)
  return data as { expenses_added: number; settlements_added: number; expenses_existing: number; settlements_existing: number }
}

function rpcValues(input: ExpenseInput) {
  const description = input.description.trim()
  if (!description || description.length > 200) throw new Error('A descrição deve ter entre 1 e 200 caracteres.')
  if (!input.expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) throw new Error('Informe uma data válida.')
  if (!input.shares.length || input.shares.some((share) => share.amount_cents < 0)) throw new Error('As cotas precisam ser válidas.')
  if (input.shares.reduce((total, share) => total + share.amount_cents, 0) + input.roundingRemainderCents !== input.amountCents) throw new Error('As cotas e o ajuste devem fechar com o total.')
  if (input.installments.reduce((sum, installment) => sum + installment.amount_cents, 0) !== input.amountCents) throw new Error('As parcelas devem fechar com o total da despesa.')
  return {
    p_description: description, p_category: input.category, p_amount_cents: input.amountCents, p_paid_by: input.paidBy,
    p_expense_date: input.expenseDate, p_notes: input.notes.trim() || null, p_split_mode: input.splitMode,
    p_rounding_remainder_cents: input.roundingRemainderCents,
    p_shares: input.shares,
    p_installments: input.installments,
  }
}

export async function createExpense(client: SupabaseClient, groupId: string, input: ExpenseInput) {
  const { data, error } = await client.rpc('create_expense_with_schedule', { p_group_id: groupId, ...rpcValues(input) })
  if (error) throw error
  return data as string
}
export async function createRecurringExpense(client: SupabaseClient, groupId: string, input: ExpenseInput) {
  if (input.installments.length !== 1) throw new Error('Uma despesa recorrente usa um valor mensal e uma ocorrência por competência.')
  const { data, error } = await client.rpc('create_recurring_expense', { p_group_id: groupId, p_template: rpcValues(input) })
  if (error) throw error
  return data as string
}
export async function updateExpense(client: SupabaseClient, expenseId: string, input: ExpenseInput) {
  const { error } = await client.rpc('update_expense_with_schedule', { p_expense_id: expenseId, ...rpcValues(input) })
  if (error) throw error
}
export async function deleteExpense(client: SupabaseClient, expenseId: string) {
  const { error } = await client.rpc('delete_expense', { p_expense_id: expenseId })
  if (error) throw error
}
