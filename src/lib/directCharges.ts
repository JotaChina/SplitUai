import type { SupabaseClient } from '@supabase/supabase-js'

export type ChargeStatus = 'pending' | 'accepted' | 'disputed' | 'payment_reported' | 'paid' | 'cancelled'
export type ChargeAction = 'accept' | 'dispute' | 'reopen' | 'report_payment' | 'confirm_payment' | 'reject_payment' | 'cancel' | 'attach_expense'
export type DirectCharge = {
  id: string; creditor_id: string; debtor_id: string; description: string; amount_cents: number
  category: string; expense_date: string; notes: string | null; split_mode: DirectSplitMode; debtor_percentage: number | null
  total_cents: number | null; due_date: string | null; status: ChargeStatus
  expense_attachment: string | null; payment_attachment: string | null
  created_at: string; updated_at: string; other_name: string; creditor_pix_key: string | null
}
export type ChargeEvent = { id: string; actor_id: string; action: string; note: string | null; attachment: string | null; created_at: string }
export const chargeStatusLabels: Record<ChargeStatus, string> = {
  pending: 'Aguardando reconhecimento', accepted: 'Reconhecida', disputed: 'Contestada',
  payment_reported: 'Pagamento informado', paid: 'Quitada', cancelled: 'Cancelada',
}
export const chargeActionLabels: Record<string, string> = {
  created: 'Cobrança criada', accept: 'Valor reconhecido', dispute: 'Cobrança contestada',
  reopen: 'Reconhecimento solicitado novamente', report_payment: 'Pagamento informado',
  confirm_payment: 'Recebimento confirmado', reject_payment: 'Pagamento não localizado',
  cancel: 'Cobrança cancelada', attach_expense: 'Comprovante da despesa anexado',
}

export function availableChargeActions(charge: Pick<DirectCharge, 'status' | 'creditor_id' | 'debtor_id'>, userId: string): ChargeAction[] {
  if (charge.debtor_id === userId) {
    if (charge.status === 'pending') return ['accept', 'dispute']
    if (charge.status === 'accepted') return ['report_payment', 'dispute']
  }
  if (charge.creditor_id === userId) {
    if (charge.status === 'pending') return ['attach_expense', 'cancel']
    if (charge.status === 'accepted') return ['cancel']
    if (charge.status === 'disputed') return ['reopen', 'cancel']
    if (charge.status === 'payment_reported') return ['confirm_payment', 'reject_payment']
  }
  return []
}

export function directChargeAmount(cents: number, split: boolean) {
  const amount = split ? Math.floor(cents / 2) : cents
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) {
    throw new Error('Informe um valor válido, até R$ 1.000.000,00 por cobrança.')
  }
  return amount
}

export function chargeError(reason: unknown) {
  return reason && typeof reason === 'object' && 'message' in reason
    ? String(reason.message) : 'Não foi possível atualizar as cobranças. Tente novamente.'
}

export async function listDirectCharges(client: SupabaseClient) {
  const { data, error } = await client.rpc('list_my_direct_charges')
  if (error) throw error
  return (data ?? []) as DirectCharge[]
}

export async function createDirectCharge(client: SupabaseClient, input: {
  id: string; friendId: string; description: string; cents: number; split: boolean; dueDate: string
}) {
  if (!Number.isSafeInteger(input.cents) || input.cents < (input.split ? 2 : 1) || input.cents > (input.split ? 200000000 : 100000000)) throw new Error('Informe um valor válido, até R$ 1 milhão por pessoa.')
  const { error } = await client.rpc('create_direct_charge', {
    p_id: input.id, p_friend_id: input.friendId, p_description: input.description.trim(),
    p_amount_cents: directChargeAmount(input.cents, input.split),
    p_total_cents: input.split ? input.cents : null, p_due_date: input.dueDate || null,
  })
  if (error) throw error
}

export async function manageDirectCharge(client: SupabaseClient, id: string, action: ChargeAction, note = '', attachment: string | null = null) {
  const { error } = await client.rpc('manage_direct_charge', { p_id: id, p_action: action, p_note: note.trim() || null, p_attachment: attachment })
  if (error) throw error
}

export async function uploadChargeReceipt(client: SupabaseClient, id: string, userId: string, file: File) {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
  if (!extensions[file.type] || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Escolha JPG, PNG, WebP ou PDF, até 5 MB.')
  const path = `${id}/${userId}/${crypto.randomUUID()}.${extensions[file.type]}`
  const { error } = await client.storage.from('direct-charge-receipts').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

export async function receiptUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from('direct-charge-receipts').createSignedUrl(path, 60)
  if (error) throw error
  return data.signedUrl
}

export type DirectSplitMode = 'charge' | 'equal' | 'percentage' | 'custom'
export function calculateDirectSplit(total: number, mode: DirectSplitMode, value = 0) {
  if (!Number.isSafeInteger(total) || total < 1 || total > 200000000) throw new Error('Informe um total válido, até R$ 2 milhões.')
  const debtor = mode === 'charge' ? total : mode === 'equal' ? Math.floor(total / 2) : mode === 'percentage' ? Math.round(total * value / 10000) : value
  if (mode === 'percentage' && (!Number.isSafeInteger(value) || value < 1 || value > 10000)) throw new Error('Informe um percentual entre 0,01 e 100%.')
  if (!Number.isSafeInteger(debtor) || debtor < 1 || debtor > 100000000 || debtor > total || total - debtor > 100000000) throw new Error('O rateio deve respeitar o total e o limite de R$ 1 milhão por pessoa.')
  return { debtor, creditor: total - debtor }
}
export function personalDirectSpending(rows: DirectCharge[], userId: string, month: string, friendId = '') {
  return rows.filter(r => ['accepted', 'payment_reported', 'paid'].includes(r.status) && r.total_cents !== null && r.expense_date?.startsWith(month)
    && (!friendId || (r.creditor_id === userId ? r.debtor_id : r.creditor_id) === friendId))
    .map(r => ({ category: r.category, cents: r.creditor_id === userId ? r.total_cents! - r.amount_cents : r.amount_cents }))
}
export async function createDetailedDirectCharge(client: SupabaseClient, input: {
  id: string; friendId: string; description: string; total: number; mode: DirectSplitMode; value: number;
  category: string; expenseDate: string; notes: string; dueDate: string
}) {
  const shares = calculateDirectSplit(input.total, input.mode, input.value)
  const { error } = await client.rpc('create_detailed_direct_charge', {
    p_id: input.id, p_friend_id: input.friendId, p_description: input.description.trim(), p_amount_cents: shares.debtor,
    p_total_cents: input.mode === 'charge' ? null : input.total, p_due_date: input.dueDate || null,
    p_category: input.category, p_expense_date: input.expenseDate, p_notes: input.notes.trim() || null,
    p_split_mode: input.mode, p_debtor_percentage: input.mode === 'percentage' ? input.value : null,
  })
  if (error) throw error
}
