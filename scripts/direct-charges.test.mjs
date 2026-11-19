import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync('src/lib/directCharges.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const api = {}
vm.runInNewContext(code, { exports: api, crypto: { randomUUID: () => 'receipt-id' } })
test('Charge and split values are sent as exact integer cents, with creditor absorbing odd cent', async () => {
  const calls = []
  const client = { rpc: async (...args) => { calls.push(args); return { error: null } } }
  const input = { id: 'id', friendId: 'friend', description: ' Lanche ', cents: 8001, split: true, dueDate: '' }
  await api.createDirectCharge(client, input)
  assert.equal(calls[0][1].p_amount_cents, 4000)
  assert.equal(calls[0][1].p_total_cents, 8001)
  assert.equal(calls[0][1].p_due_date, null)
  assert.equal(calls[0][1].p_description, 'Lanche')
  await api.createDirectCharge(client, { ...input, split: false })
  assert.equal(calls[1][1].p_amount_cents, 8001)
  assert.equal(calls[1][1].p_total_cents, null)
  for (const cents of [0, -1, 1.2, NaN, Infinity, 100000001]) {
    await assert.rejects(api.createDirectCharge(client, { ...input, cents, split: false }))
  }
  await assert.rejects(api.createDirectCharge(client, { ...input, cents: 1 }))
  assert.equal(calls.length, 2)
})
test('Server refusals propagate instead of falsely confirming creation or payment', async () => {
  const error = { message: 'Só é possível cobrar amizades aceitas.' }
  const client = { rpc: async () => ({ error }) }
  await assert.rejects(api.createDirectCharge(client, { id:'id', friendId:'friend', description:'Lanche', cents:3000, split:false, dueDate:'' }), e => e === error)
  await assert.rejects(api.manageDirectCharge(client, 'id', 'confirm_payment'), e => e === error)
  await assert.rejects(api.listDirectCharges(client), e => e === error)
})
test('Receipts use a private bucket, immutable unique paths and expiring signed links', async () => {
  const calls = []
  const client = { storage: { from: bucket => {
    assert.equal(bucket, 'direct-charge-receipts')
    return { upload: async (...args) => { calls.push(args); return { error:null } }, createSignedUrl: async (path, seconds) => { assert.equal(seconds,60); return { data:{ signedUrl:`https://example.test/${path}` },error:null } } }
  } } }
  await assert.rejects(api.uploadChargeReceipt(client,'charge','user',{ type:'text/html', size:1 }))
  await assert.rejects(api.uploadChargeReceipt(client,'charge','user',{ type:'application/pdf', size:5242881 }))
  const path = await api.uploadChargeReceipt(client,'charge','user',{ type:'application/pdf', size:123 })
  assert.equal(path,'charge/user/receipt-id.pdf')
  assert.equal(calls[0][2].upsert,false)
  assert.equal(await api.receiptUrl(client,path),`https://example.test/${path}`)
})

test('Detailed shares preserve cents and reject invalid allocations', () => {
  assert.equal(api.calculateDirectSplit(8001, 'equal').debtor, 4000)
  assert.equal(api.calculateDirectSplit(8001, 'equal').creditor, 4001)
  assert.equal(api.calculateDirectSplit(8001, 'percentage', 3000).debtor, 2400)
  assert.equal(api.calculateDirectSplit(101, 'percentage', 5000).debtor, 51)
  assert.equal(api.calculateDirectSplit(8001, 'custom', 2000).creditor, 6001)
  assert.equal(api.calculateDirectSplit(1, 'custom', 1).creditor, 0)
  for (const [total, mode, value] of [[100,'custom',101],[100,'custom',0],[100,'custom',1.5],[100,'percentage',10001],[100,'percentage',NaN],[1,'equal',0],[200000001,'equal',0],[100000001,'charge',0]]) {
    assert.throws(() => api.calculateDirectSplit(total, mode, value))
  }
})
test('Personal spending counts shares once, excludes transfers and filters month and friend', () => {
  const row = { creditor_id:'me', debtor_id:'friend', total_cents:8001, amount_cents:4000, category:'alimentacao', expense_date:'2026-11-18', status:'paid' }
  const rows = [row, ...['pending','disputed','cancelled'].map(status => ({...row,status})), {...row,total_cents:null}, {...row,expense_date:'2026-10-18'}]
  assert.equal(api.personalDirectSpending(rows,'me','2026-11').reduce((s,r)=>s+r.cents,0),4001)
  assert.equal(api.personalDirectSpending(rows,'friend','2026-11').reduce((s,r)=>s+r.cents,0),4000)
  assert.equal(api.personalDirectSpending(rows,'me','2026-11','other').length,0)
  for (const status of ['accepted','payment_reported','paid']) assert.equal(api.personalDirectSpending([{...row,status}],'me','2026-11','friend')[0].cents,4001)
})
test('Detailed RPC persists category, date, notes and percentage basis points', async () => {
  let args
  const client={rpc:async (name,input)=>{assert.equal(name,'create_detailed_direct_charge');args=input;return {error:null}}}
  await api.createDetailedDirectCharge(client,{id:'id',friendId:'friend',description:' Jantar ',total:8001,mode:'percentage',value:3000,category:'alimentacao',expenseDate:'2026-11-18',notes:' Detalhes ',dueDate:''})
  assert.equal(args.p_amount_cents,2400)
  assert.equal(args.p_total_cents,8001)
  assert.equal(args.p_debtor_percentage,3000)
  assert.equal(args.p_notes,'Detalhes')
  assert.equal(args.p_expense_date,'2026-11-18')
})
