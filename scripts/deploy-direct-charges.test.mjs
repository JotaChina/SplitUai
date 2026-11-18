import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFileSync } from 'node:fs'
import { checkDirectChargesAccess, deployDirectCharges } from './deploy-direct-charges.mjs'
const token = 'test-only'
const projectUrl = 'https://yzxeyqutmvjmrglmpcbb.supabase.co'
const ready = { applied:false,charges_exist:false,friendships_ready:true,notifications_ready:true }
test('credential test only reads metadata and cannot apply a migration', async () => {
  const queries=[]
  const result=await checkDirectChargesAccess({token,projectUrl,query:async(sql)=>{queries.push(sql);return [ready]}})
  assert.equal(result.friendships_ready,true)
  assert.equal(queries.length,1)
  assert.ok(queries[0].startsWith('select'))
  assert.doesNotMatch(queries[0],/create|alter|insert|update|delete|drop|begin;/i)
})
test('missing token or unexpected target never sends a query', async () => {
  let calls=0
  const query=async()=>{ calls++; return [] }
  await assert.rejects(deployDirectCharges({token:'',projectUrl,query}))
  await assert.rejects(deployDirectCharges({token,projectUrl:'https://other.supabase.co',query}))
  assert.equal(calls,0)
})
test('untracked production table stops deployment before mutation', async () => {
  let calls=0
  await assert.rejects(deployDirectCharges({token,projectUrl,query:async()=>{calls++;return [{...ready,charges_exist:true}]}}))
  assert.equal(calls,1)
})
test('single-feature migration is transactional and records its ledger entry', async () => {
  const queries=[]
  const result=await deployDirectCharges({token,projectUrl,query:async(sql)=>{
    queries.push(sql)
    if(queries.length===1)return [ready]
    if(queries.length===2)return []
    return [{applied:true,charges_rls:true,private_receipts:true}]
  }})
  assert.equal(result.applied,true)
  assert.match(queries[1],/^begin;/)
  assert.match(queries[1],/commit;$/)
  assert.match(queries[1],/pg_advisory_xact_lock/)
  assert.match(queries[1],/insert into supabase_migrations.schema_migrations/)
  assert.doesNotMatch(queries[1],/create table public.push_deliveries/)
  if(process.env.DIRECT_CHARGES_TEST_SQL_PATH) writeFileSync(process.env.DIRECT_CHARGES_TEST_SQL_PATH,queries[1])
})
test('already-applied migration only verifies, and failed verification blocks publication', async () => {
  const queries=[]
  await assert.rejects(deployDirectCharges({token,projectUrl,query:async(sql)=>{
    queries.push(sql)
    return queries.length===1?[{...ready,applied:true,charges_exist:true}]:[{applied:true,private_receipts:false}]
  }}))
  assert.equal(queries.length,2)
  assert.ok(queries.every(sql=>sql.startsWith('select')))
})
