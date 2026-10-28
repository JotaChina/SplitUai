import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/expenses.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { suggestExpenseCategory } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

const examples = [
  ['diária da pousada', 'hospedagem'],
  ['almoço no restaurante', 'alimentacao'],
  ['estacionamento do carro', 'transporte'],
  ['Uber até o aeroporto', 'transporte_corrida_app'],
  ['inscrição na maratona', 'corrida'],
  ['ingresso do cinema', 'atividades'],
  ['taxa de internet', 'internet'],
  ['conta de água', 'agua'],
  ['conta de luz', 'luz'],
  ['aluguel do apartamento', 'aluguel'],
  ['IPTU da casa', 'iptu'],
  ['pacote de viagem', 'viagens'],
  ['mensalidade Netflix', 'streaming'],
  ['mensalidade da academia', 'fitness'],
  ['fatura do cartão de crédito', 'fatura_cartao'],
  ['acerto do outro grupo', 'acerto_outros_grupos'],
  ['abastecimento gasolina', 'transporte_gasolina'],
  ['aluguel de carro', 'transporte_aluguel_veiculo'],
  ['passagem de ônibus', 'transporte_onibus'],
  ['passagem aérea', 'transporte_aviao'],
  ['pedágio da rodovia', 'transporte_pedagio'],
  ['multa de trânsito', 'transporte_multas'],
  ['IPVA do carro', 'transporte_ipva'],
  ['revisão do carro na oficina', 'transporte_manutencao'],
  ['outros gastos', 'outros'],
]

for (const [description, expected] of examples) {
  assert.equal(suggestExpenseCategory(description), expected, description)
}

for (const ambiguous of [
  'compra', 'conta', 'cartão', 'corrida', 'transporte', 'acerto',
  'hotel e passagem aérea', 'almoço depois do cinema', 'Netflix e internet',
]) {
  assert.equal(suggestExpenseCategory(ambiguous), null, ambiguous)
}

assert.equal(suggestExpenseCategory('ALMOÇO no RESTAURANTE'), 'alimentacao')
assert.equal(suggestExpenseCategory('Cafe da manha'), 'alimentacao')
console.log(`Validada sugestão para ${examples.length} categorias e 9 descrições ambíguas.`)
