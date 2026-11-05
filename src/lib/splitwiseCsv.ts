import type { ExpenseCategory, SplitwiseImportExpense, SplitwiseImportSettlement } from './expenses'

export type SplitwiseCsvPreview = {
  expenses: SplitwiseImportExpense[]
  settlements: SplitwiseImportSettlement[]
  skipped: Array<{ row: number; description: string; reason: string }>
  memberNames: string[]
}

function readCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index++ }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index++
      row.push(field); field = ''
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
    } else field += character
  }
  if (quoted) throw new Error('O CSV contém um campo entre aspas que não foi fechado.')
  if (field.length || row.length) { row.push(field); if (row.some((cell) => cell.trim())) rows.push(row) }
  return rows
}

function parseMoney(value: string) {
  const normalized = value.trim().replace(/\s/g, '')
  if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null
  const negative = normalized.startsWith('-')
  const [whole, fraction = ''] = normalized.replace('-', '').replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents * (negative ? -1 : 1) : null
}

function categoryFor(value: string, description: string): ExpenseCategory {
  const label = `${value} ${description}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
  if (/corrida|uber|garupa|\btaxi\b|99\s?(pop|app)?/.test(label)) return 'corrida'
  if (/hosped|hotel|airbnb|pousada/.test(label)) return 'hospedagem'
  if (/mercado|aliment|comida|restaurante|refeicao|grocery|food/.test(label)) return 'alimentacao'
  if (/transporte|corrida|taxi|uber|gasolina|combustivel|onibus|passagem/.test(label)) return 'transporte'
  if (/jogo|atividade|lazer|ingresso|cinema|passeio/.test(label)) return 'atividades'
  return 'outros'
}

function normalizeSource(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'export'
}

export function parseSplitwiseCsv(text: string, filename: string, memberIds: Record<string, string>): SplitwiseCsvPreview {
  const rows = readCsv(text)
  if (rows.length < 2) throw new Error('O CSV não tem linhas para importar.')
  const headers = rows[0].map((header) => header.trim().toLocaleLowerCase('pt-BR'))
  const indexes = ['data', 'descrição', 'categoria', 'custo']
  for (const header of indexes) if (!headers.includes(header)) throw new Error(`Não encontrei a coluna “${header}” no arquivo.`)
  const dateIndex = headers.indexOf('data'), descriptionIndex = headers.indexOf('descrição')
  const categoryIndex = headers.indexOf('categoria'), amountIndex = headers.indexOf('custo'), currencyIndex = headers.indexOf('moeda')
  const nameColumns = rows[0].map((header, index) => ({ header: header.trim(), index }))
    .filter(({ header }) => !['data', 'descrição', 'categoria', 'custo', 'moeda'].includes(header.toLocaleLowerCase('pt-BR')))
  if (nameColumns.length < 2) throw new Error('Não encontrei pelo menos duas colunas de participantes no CSV.')
  const memberNames = nameColumns.map(({ header }) => header)
  const expenses: SplitwiseImportExpense[] = []
  const settlements: SplitwiseImportSettlement[] = []
  const skipped: SplitwiseCsvPreview['skipped'] = []
  const sourcePrefix = normalizeSource(filename)
  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2
    const description = (cells[descriptionIndex] ?? '').trim()
    const date = (cells[dateIndex] ?? '').trim()
    const category = (cells[categoryIndex] ?? '').trim()
    const amount = parseMoney(cells[amountIndex] ?? '')
    if (!date && !description && amount === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || amount === null || amount < 1) {
      skipped.push({ row: rowNumber, description: description || '(sem descrição)', reason: 'Data, descrição ou custo ausente/inválido.' })
      return
    }
    if (currencyIndex >= 0 && (cells[currencyIndex] ?? '').trim().toUpperCase() !== 'BRL') {
      skipped.push({ row: rowNumber, description, reason: 'Moeda diferente de BRL.' })
      return
    }
    const impacts = nameColumns.map(({ header, index: columnIndex }) => {
      const value = (cells[columnIndex] ?? '').trim()
      return { name: header, amount: value ? parseMoney(value) : 0 }
    })
    if (impacts.some(({ amount: impact }) => impact === null)) {
      skipped.push({ row: rowNumber, description, reason: 'Há um valor de participante inválido.' })
      return
    }
    const validImpacts = impacts as Array<{ name: string; amount: number }>
    const totalImpact = validImpacts.reduce((total, impact) => total + impact.amount, 0)
    const sourceKey = `splitwise:${sourcePrefix}:${rowNumber}`
    if (category.toLocaleLowerCase('pt-BR') === 'pagamento') {
      const positive = validImpacts.filter((impact) => impact.amount > 0)
      const negative = validImpacts.filter((impact) => impact.amount < 0)
      if (totalImpact !== 0 || positive.length !== 1 || negative.length !== 1 || positive[0].amount !== -negative[0].amount || positive[0].amount !== amount) {
        skipped.push({ row: rowNumber, description, reason: 'Os valores dos participantes não formam um pagamento válido.' })
        return
      }
      const paidBy = positive[0], receivedBy = negative[0]
      const paidById = memberIds[paidBy.name] ?? paidBy.name
      const receivedById = memberIds[receivedBy.name] ?? receivedBy.name
      if (!paidById || !receivedById || paidById === receivedById) throw new Error(`Associe as pessoas do pagamento a participantes diferentes do grupo. Linha ${rowNumber}.`)
      settlements.push({ source_key: sourceKey, paid_by: paidById, received_by: receivedById,
        amount_cents: paidBy.amount, settlement_date: date, description: description || 'Acerto Splitwise' })
      return
    }
    const positive = validImpacts.filter((impact) => impact.amount > 0)
    const owing = validImpacts.filter((impact) => impact.amount < 0)
    const totalOwed = owing.reduce((total, impact) => total + Math.abs(impact.amount), 0)
    if (totalImpact !== 0 || positive.length !== 1 || owing.length === 0 || totalOwed > amount) {
      skipped.push({ row: rowNumber, description, reason: 'Os valores dos participantes não formam uma divisão válida para a despesa.' })
      return
    }
    const paidBy = positive[0]
    const paidById = memberIds[paidBy.name] ?? paidBy.name
    const shares = [
      { user_id: paidById, amount_cents: amount - totalOwed },
      ...owing.map((impact) => ({ user_id: memberIds[impact.name] ?? impact.name, amount_cents: Math.abs(impact.amount) })),
    ]
    if (shares.some((share) => !share.user_id) || new Set(shares.map((share) => share.user_id)).size !== shares.length) {
      throw new Error(`Associe cada pessoa da despesa a um participante diferente do grupo. Linha ${rowNumber}.`)
    }
    expenses.push({ source_key: sourceKey, description, category: categoryFor(category, description), amount_cents: amount,
      paid_by: paidById, expense_date: date,
      notes: `Importado do Splitwise · Categoria original: ${category || 'não informada'}`,
      shares })
  })
  return { expenses, settlements, skipped, memberNames }
}

