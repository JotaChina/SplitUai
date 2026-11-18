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
