import type { SupabaseClient } from '@supabase/supabase-js'

export type ExpenseCategory = 'hospedagem' | 'alimentacao' | 'transporte' | 'atividades' | 'outros'

export type ExpenseShare = {
  user_id: string
  amount_cents: number
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
  shares: ExpenseShare[]
}

export type ExpenseInput = {
  description: string
  category: ExpenseCategory
  amountCents: number
  paidBy: string
  expenseDate: string
  notes: string
  shares: ExpenseShare[]
}

export type GroupBalance = { user_id: string; balance_cents: number }
export type SettlementSuggestion = { from_user_id: string; to_user_id: string; amount_cents: number }

export function calculateBalances(expenses: ExpenseRecord[], memberIds: string[]): GroupBalance[] {
  const balances = new Map<string, bigint>([...new Set(memberIds)].map((id) => [id, 0n]))
  for (const expense of expenses) {
    if (!balances.has(expense.paid_by)) throw new Error('O pagador não pertence à lista de participantes.')
    if (!Number.isSafeInteger(expense.amount_cents) || expense.amount_cents < 1) throw new Error('Total de despesa inválido.')
    let sharesTotal = 0n
    for (const share of expense.shares) {
      if (!balances.has(share.user_id)) throw new Error('Uma parcela pertence a alguém que não está no grupo.')
      if (!Number.isSafeInteger(share.amount_cents) || share.amount_cents < 1) throw new Error('Parcela inválida.')
      sharesTotal += BigInt(share.amount_cents)
      balances.set(share.user_id, balances.get(share.user_id)! - BigInt(share.amount_cents))
    }
    if (sharesTotal !== BigInt(expense.amount_cents)) throw new Error('As parcelas não fecham com o total da despesa.')
    balances.set(expense.paid_by, balances.get(expense.paid_by)! + BigInt(expense.amount_cents))
  }
  if ([...balances.values()].reduce((sum, balance) => sum + balance, 0n) !== 0n) {
    throw new Error('Os saldos do grupo não fecham em zero.')
  }
  return [...balances].map(([user_id, balance]) => {
    if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('O saldo acumulado excede o limite de cálculo seguro em centavos.')
    }
    return { user_id, balance_cents: Number(balance) }
  })
}

export function suggestSettlements(balances: GroupBalance[]): SettlementSuggestion[] {
  if (balances.some((balance) => !Number.isSafeInteger(balance.balance_cents))
    || balances.reduce((sum, balance) => sum + BigInt(balance.balance_cents), 0n) !== 0n) {
    throw new Error('Os saldos precisam ser inteiros seguros e somar zero.')
  }
  const debtors = balances.filter((balance) => balance.balance_cents < 0)
    .map((balance) => ({ user_id: balance.user_id, remaining: -balance.balance_cents }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id))
  const creditors = balances.filter((balance) => balance.balance_cents > 0)
    .map((balance) => ({ user_id: balance.user_id, remaining: balance.balance_cents }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id))
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
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 999999999999) {
    throw new Error('O valor deve ser positivo e menor que R$ 10 bilhões.')
  }
  return cents
}

export function formatBrlCents(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function splitEvenly(totalCents: number, participantIds: string[]): ExpenseShare[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 1) throw new Error('O valor precisa ser positivo.')
  const uniqueIds = [...new Set(participantIds)]
  if (!uniqueIds.length) throw new Error('Selecione ao menos uma pessoa para dividir a despesa.')
  const base = Math.floor(totalCents / uniqueIds.length)
  const remainder = totalCents % uniqueIds.length
  return uniqueIds.map((user_id, index) => ({ user_id, amount_cents: base + (index < remainder ? 1 : 0) }))
}

export async function listGroupExpenses(client: SupabaseClient, groupId: string) {
  const { data: expenseRows, error: expensesError } = await client.from('expenses')
    .select('id, group_id, created_by, paid_by, description, category, amount_cents, currency, expense_date, notes, created_at, updated_at')
    .eq('group_id', groupId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (expensesError) throw expensesError

  const expenses = (expenseRows ?? []) as Omit<ExpenseRecord, 'shares'>[]
  if (!expenses.length) return [] as ExpenseRecord[]

  const { data: shareRows, error: sharesError } = await client.from('expense_shares')
    .select('expense_id, user_id, amount_cents')
    .eq('group_id', groupId)
    .in('expense_id', expenses.map((expense) => expense.id))
  if (sharesError) throw sharesError

  const shares = new Map<string, ExpenseShare[]>()
  for (const row of shareRows ?? []) {
    const rows = shares.get(row.expense_id) ?? []
    rows.push({ user_id: row.user_id, amount_cents: Number(row.amount_cents) })
    shares.set(row.expense_id, rows)
  }
  return expenses.map((expense) => ({
    ...expense,
    amount_cents: Number(expense.amount_cents),
    shares: shares.get(expense.id) ?? [],
  })) as ExpenseRecord[]
}

function rpcValues(input: ExpenseInput) {
  const description = input.description.trim()
  if (!description || description.length > 200) throw new Error('A descrição deve ter entre 1 e 200 caracteres.')
  if (!input.expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) throw new Error('Informe uma data válida.')
  if (!input.shares.length || input.shares.some((share) => share.amount_cents < 1)) throw new Error('As parcelas precisam ser positivas.')
  if (input.shares.reduce((total, share) => total + share.amount_cents, 0) !== input.amountCents) throw new Error('A soma das parcelas deve fechar com o total.')
  return {
    p_description: description,
    p_category: input.category,
    p_amount_cents: input.amountCents,
    p_paid_by: input.paidBy,
    p_expense_date: input.expenseDate,
    p_notes: input.notes.trim() || null,
    p_shares: input.shares,
  }
}

export async function createExpense(client: SupabaseClient, groupId: string, input: ExpenseInput) {
  const { data, error } = await client.rpc('create_expense_with_shares', {
    p_group_id: groupId,
    ...rpcValues(input),
  })
  if (error) throw error
  return data as string
}

export async function updateExpense(client: SupabaseClient, expenseId: string, input: ExpenseInput) {
  const { error } = await client.rpc('update_expense_with_shares', {
    p_expense_id: expenseId,
    ...rpcValues(input),
  })
  if (error) throw error
}

export async function deleteExpense(client: SupabaseClient, expenseId: string) {
  const { error } = await client.rpc('delete_expense', { p_expense_id: expenseId })
  if (error) throw error
}
