'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/rules')
const { createCatalystStore } = require('../src/store/catalyst')
const { createFakeCatalyst } = require('./fake-catalyst')
const seed = require('../src/seed')

const manager = { email: 'mgr@example.com', role: 'manager' }
const admin = { email: 'admin@example.com', role: 'admin' }
const ORDER = ['machines', 'items', 'vendors', 'batches', 'machine_stock']

async function setup() {
  const db = createFakeCatalyst()
  const store = createCatalystStore(db)
  for (const t of ORDER) for (const r of seed[t]) await store.insert(t, r)
  return { db, store }
}
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code, `expected ${code}`)

test('app field names are stored under the real column names', async () => {
  const { db, store } = await setup()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }] })
  const row = db.dump('transfers')[0]
  assert.ok('line_items' in row)
  assert.ok(!('lines' in row))
  assert.deepEqual(JSON.parse(row.line_items), [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }])
  await rules.applyConsumption(store, admin, { consumption_date: '2026-11-25', lines: [{ machine_code: 'VM-001', sku: 'SNK-001', qty: 1 }] })
  assert.equal(db.dump('consumption_reports')[0].is_invoiced, 'false') // app field "invoiced" is stored as is_invoiced
})

test('reads give back the app field names, real numbers and booleans', async () => {
  const { store } = await setup()
  const m = await store.get('machines', 'VM-001')
  assert.equal(m.active, true)
  assert.equal(typeof (await store.get('items', 'SNK-001')).cost, 'number')
  const b = await store.get('batches', 'SNK-001|B-2611-A')
  assert.equal(b.qty, 400)
  assert.equal(typeof b.qty, 'number')
  const keys = Object.keys(b)
  assert.ok(!keys.includes('ROWID') && !keys.includes('item_id')) // internal and link columns stay hidden
})

test('every row is linked to its parent by the parent\'s row id', async () => {
  const { db, store } = await setup()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }] })
  const idOf = (table, col, val) => db.dump(table).find((r) => r[col] === val).ROWID
  assert.equal(db.dump('batches').find((b) => b.batch_key === 'SNK-001|B-2611-A').item_id, idOf('items', 'sku', 'SNK-001'))
  const stock = db.dump('machine_stock').find((r) => r.stock_key === 'VM-004|SNK-001|B-2611-A')
  assert.equal(stock.machine_id, idOf('machines', 'machine_code', 'VM-004'))
  assert.equal(stock.batch_id, idOf('batches', 'batch_key', 'SNK-001|B-2611-A'))
  assert.equal(db.dump('transfers')[0].machine_id, idOf('machines', 'machine_code', 'VM-004'))
})

test('a row whose parent does not exist is refused', async () => {
  const { store } = await setup()
  await rejects(store.insert('batches', { batch_key: 'NOPE|X', sku: 'NOPE', batch_no: 'X', expiry: '2027-01-01', qty: 1, zoho_batch_id: '' }), 'INVALID_INPUT')
  await rejects(store.put('machine_stock', { stock_key: 'VM-001|SNK-001|NOPE', machine_code: 'VM-001', sku: 'SNK-001', batch_no: 'NOPE', qty: 1 }), 'INVALID_INPUT')
})

test('a duplicate key is reported as DUPLICATE', async () => {
  const { store } = await setup()
  await rejects(store.insert('machines', { machine_code: 'VM-001', name: 'Again', location: '', area: '', custodian: '', staff_emails: '', active: true }), 'DUPLICATE')
})

test('an order too big for its text column is refused with a clear message', async () => {
  const { store } = await setup()
  const lines = Array.from({ length: 400 }, () => ({ sku: 'SNK-001', qty: 1, rate: 14 }))
  await assert.rejects(rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines }), (e) => e.code === 'INVALID_INPUT' && /too long/.test(e.message))
})

test('put creates a row the first time and replaces it after', async () => {
  const { db, store } = await setup()
  await store.put('settings', { setting_key: 'high_margin_threshold_pct', setting_value: '40' })
  await store.put('settings', { setting_key: 'high_margin_threshold_pct', setting_value: '45' })
  assert.equal(db.dump('settings').length, 1)
  assert.equal((await store.get('settings', 'high_margin_threshold_pct')).setting_value, '45')
})

test('a failed multi-step change is undone, including a row it removed', async () => {
  const { db, store } = await setup()
  await assert.rejects(store.transaction(async () => {
    await store.put('batches', { ...(await store.get('batches', 'SNK-001|B-2611-A')), qty: 1 })
    await store.remove('machine_stock', 'VM-001|SNK-001|B-2611-A')
    await store.insert('settings', { setting_key: 'temp', setting_value: '1' })
    throw new Error('boom')
  }), /boom/)
  assert.equal((await store.get('batches', 'SNK-001|B-2611-A')).qty, 400)
  assert.equal((await store.get('machine_stock', 'VM-001|SNK-001|B-2611-A')).qty, 20)
  assert.equal(await store.get('settings', 'temp'), null)
  assert.equal(db.dump('machine_stock').length, seed.machine_stock.length)
})

test('removing a machine keeps its transfer history, and removing an item takes its batches with it', async () => {
  const { db, store } = await setup()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }] })
  await store.remove('machines', 'VM-004')
  const t = (await store.list('transfers'))[0]
  assert.equal(t.machine_code, 'VM-004') // history still reads fine
  assert.equal(db.dump('transfers')[0].machine_id, null)
  assert.equal(db.dump('machine_stock').filter((r) => r.machine_code === 'VM-004').length, 0) // its stock went with it
  await store.remove('items', 'SNK-001')
  assert.equal((await store.list('batches')).filter((b) => b.sku === 'SNK-001').length, 0)
})

test('list returns rows in the order they were created', async () => {
  const { store } = await setup()
  const codes = (await store.list('machines')).map((m) => m.machine_code)
  assert.deepEqual(codes, ['VM-001', 'VM-002', 'VM-003', 'VM-004', 'VM-005'])
})
