'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/rules')
const sync = require('../src/sync')
const { createSimZoho } = require('../src/zoho/sim')
const { createLiveZoho } = require('../src/zoho/live')
const { createApp } = require('../src/app')
const seed = require('../src/seed')
const { makeStore } = require('./helpers')

const admin = { email: 'admin@example.com', role: 'admin' }
const manager = { email: 'mgr@example.com', role: 'manager' }
const ravi = { email: 'ravi@example.com', role: 'field' }
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code, `expected ${code}`)
const qty = async (store, table, key) => (await store.get(table, key))?.qty
const newMachine = { machine_code: 'VM-006', name: 'Vending Machine 6', location: 'Airport T2', area: 'Devanahalli', custodian: 'Suresh', staff_emails: 'suresh@example.com' }
const send = (store, machine, sku, batch, n) => rules.createTransfer(store, manager, { machine_code: machine, lines: [{ sku, batch_no: batch, qty: n }] })

// ---------- machines ----------

test('an admin adds a machine, and the same code cannot be added twice', async () => {
  const store = await makeStore(seed)
  const m = await rules.saveMachine(store, admin, newMachine, { create: true })
  assert.equal(m.machine_code, 'VM-006')
  assert.equal(m.active, true)
  await rejects(rules.saveMachine(store, admin, newMachine, { create: true }), 'DUPLICATE')
})

test('a machine is edited in place and its code stays the same', async () => {
  const store = await makeStore(seed)
  await rules.saveMachine(store, admin, { machine_code: 'VM-001', name: 'Renamed', location: 'Lobby', staff_emails: 'ravi@example.com', active: false })
  const m = await store.get('machines', 'VM-001')
  assert.equal(m.name, 'Renamed')
  assert.equal(m.active, false)
  await rejects(rules.saveMachine(store, admin, { machine_code: 'VM-999', name: 'Ghost' }), 'NOT_FOUND')
})

test('machine input is checked', async () => {
  const store = await makeStore(seed)
  await rejects(rules.saveMachine(store, admin, { machine_code: '', name: 'X' }, { create: true }), 'INVALID_INPUT')
  await rejects(rules.saveMachine(store, admin, { machine_code: 'VM 7', name: 'X' }, { create: true }), 'INVALID_INPUT')
  await rejects(rules.saveMachine(store, admin, { machine_code: 'VM-007', name: '' }, { create: true }), 'INVALID_INPUT')
  await rejects(rules.saveMachine(store, admin, { machine_code: 'VM-007', name: 'X', staff_emails: 'not-an-email' }, { create: true }), 'INVALID_INPUT')
  await rejects(rules.saveMachine(store, manager, newMachine, { create: true }), 'NOT_ALLOWED')
})

test('a machine with nothing in it and no history can be deleted', async () => {
  const store = await makeStore(seed)
  await rules.saveMachine(store, admin, newMachine, { create: true })
  assert.deepEqual(await rules.deleteMachine(store, admin, 'VM-006'), { deleted: 'VM-006' })
  assert.equal(await store.get('machines', 'VM-006'), null)
})

test('a machine that still holds stock cannot be deleted', async () => {
  const store = await makeStore(seed)
  await assert.rejects(rules.deleteMachine(store, admin, 'VM-001'), (e) => e.code === 'INVALID_INPUT' && /still holds/.test(e.message))
  assert.ok(await store.get('machines', 'VM-001'))
})

test('an empty machine with transfer history cannot be deleted; it should be made inactive', async () => {
  const store = await makeStore(seed)
  await send(store, 'VM-004', 'SNK-001', 'B-2611-A', 5)
  await rules.applyConsumption(store, admin, { consumption_date: '2026-11-25', lines: [{ machine_code: 'VM-004', sku: 'SNK-001', qty: 5 }] })
  await assert.rejects(rules.deleteMachine(store, admin, 'VM-004'), (e) => e.code === 'INVALID_INPUT' && /inactive/.test(e.message))
  await rejects(rules.deleteMachine(store, manager, 'VM-005'), 'NOT_ALLOWED')
  await rejects(rules.deleteMachine(store, admin, 'VM-999'), 'NOT_FOUND')
})

// ---------- transfers: change and delete ----------

test('changing a quantity moves only the difference', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-004', 'SNK-003', 'B-2611-D', 100)
  const u = await rules.updateTransfer(store, manager, t.transfer_no, { machine_code: 'VM-004', lines: [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 40 }] })
  assert.equal(u.transfer_no, t.transfer_no)
  assert.equal(await qty(store, 'batches', 'SNK-003|B-2611-D'), 110)
  assert.equal(await qty(store, 'machine_stock', 'VM-004|SNK-003|B-2611-D'), 40)
})

test('a change may use the stock the transfer itself had taken', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-004', 'SNK-003', 'B-2611-D', 100) // batch now 50
  await rules.updateTransfer(store, manager, t.transfer_no, { machine_code: 'VM-004', lines: [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 150 }] })
  assert.equal(await qty(store, 'batches', 'SNK-003|B-2611-D'), 0)
})

test('a change asking for too much is refused and nothing moves', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-004', 'SNK-003', 'B-2611-D', 100)
  await rejects(rules.updateTransfer(store, manager, t.transfer_no, { machine_code: 'VM-004', lines: [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 151 }] }), 'BATCH_SHORT')
  assert.equal(await qty(store, 'batches', 'SNK-003|B-2611-D'), 50)
  assert.equal(await qty(store, 'machine_stock', 'VM-004|SNK-003|B-2611-D'), 100)
  assert.equal((await store.get('transfers', t.transfer_no)).lines[0].qty, 100)
})

test('a transfer can be moved to a different machine', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-004', 'SNK-001', 'B-2611-A', 10)
  await rules.updateTransfer(store, manager, t.transfer_no, { machine_code: 'VM-005', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 10 }] })
  assert.equal(await store.get('machine_stock', 'VM-004|SNK-001|B-2611-A'), null)
  assert.equal(await qty(store, 'machine_stock', 'VM-005|SNK-001|B-2611-A'), 10)
  assert.equal((await store.get('transfers', t.transfer_no)).machine_code, 'VM-005')
})

test('deleting a transfer puts its stock back at head office', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-001', 'SNK-001', 'B-2611-A', 5) // VM-001 already had 20
  assert.deepEqual(await rules.deleteTransfer(store, manager, t.transfer_no), { deleted: t.transfer_no })
  assert.equal(await qty(store, 'batches', 'SNK-001|B-2611-A'), 400)
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 20)
  assert.equal(await store.get('transfers', t.transfer_no), null)
})

test('a transfer whose stock was partly consumed cannot be changed or deleted', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-004', 'SNK-001', 'B-2611-A', 5)
  await rules.applyConsumption(store, admin, { consumption_date: '2026-11-25', lines: [{ machine_code: 'VM-004', sku: 'SNK-001', qty: 2 }] })
  await rejects(rules.deleteTransfer(store, manager, t.transfer_no), 'STOCK_SHORT')
  await rejects(rules.updateTransfer(store, manager, t.transfer_no, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 1 }] }), 'STOCK_SHORT')
  assert.equal(await qty(store, 'machine_stock', 'VM-004|SNK-001|B-2611-A'), 3)
  assert.equal(await qty(store, 'batches', 'SNK-001|B-2611-A'), 395)
})

test('field staff cannot change or delete transfers', async () => {
  const store = await makeStore(seed)
  const t = await send(store, 'VM-001', 'SNK-001', 'B-2611-A', 1)
  await rejects(rules.deleteTransfer(store, ravi, t.transfer_no), 'NOT_ALLOWED')
  await rejects(rules.updateTransfer(store, ravi, t.transfer_no, { machine_code: 'VM-001', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 2 }] }), 'NOT_ALLOWED')
})

// ---------- export to Zoho ----------

test('exporting a transfer reaches Zoho and Zoho\'s head office drops by the same amount', async () => {
  const store = await makeStore(seed)
  const zoho = createSimZoho(seed)
  const t = await send(store, 'VM-004', 'SNK-001', 'B-2611-A', 25)
  const before = (await sync.headOfficeComparison(store, zoho)).rows.find((r) => r.batch_no === 'B-2611-A')
  assert.equal(before.status, 'explained') // waiting to be exported
  const done = await sync.syncTransfer(store, zoho, t.transfer_no)
  assert.equal(done.zoho_sync, 'synced')
  assert.ok(done.zoho_id)
  assert.deepEqual(zoho.vendingStock(), { 'SNK-001': 25 })
  const after = await sync.headOfficeComparison(store, zoho)
  assert.ok(after.rows.every((r) => r.status === 'match'))
})

test('an export that fails is kept with its reason, and exporting twice moves stock once', async () => {
  const store = await makeStore(seed)
  const zoho = createSimZoho(seed)
  const t = await send(store, 'VM-004', 'SNK-001', 'B-2611-A', 10)
  zoho.setDown(true)
  const failed = await sync.syncTransfer(store, zoho, t.transfer_no)
  assert.equal(failed.zoho_sync, 'failed')
  assert.match(failed.zoho_error, /unreachable/)
  zoho.setDown(false)
  await sync.syncTransfer(store, zoho, t.transfer_no)
  // pretend our record of success was lost, then export again
  await store.put('transfers', { ...(await store.get('transfers', t.transfer_no)), zoho_sync: 'pending', zoho_id: '' })
  const again = await sync.syncTransfer(store, zoho, t.transfer_no)
  assert.equal(again.zoho_sync, 'synced')
  assert.deepEqual(zoho.vendingStock(), { 'SNK-001': 10 })
})

test('a transfer that is already in Zoho cannot be changed or deleted', async () => {
  const store = await makeStore(seed)
  const zoho = createSimZoho(seed)
  const t = await send(store, 'VM-004', 'SNK-001', 'B-2611-A', 10)
  await sync.syncTransfer(store, zoho, t.transfer_no)
  await assert.rejects(rules.deleteTransfer(store, manager, t.transfer_no), (e) => e.code === 'INVALID_INPUT' && /already in Zoho/.test(e.message))
  await rejects(rules.updateTransfer(store, manager, t.transfer_no, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }] }), 'INVALID_INPUT')
})

test('a batch Zoho does not have yet is reported, not hidden', async () => {
  const store = await makeStore(seed)
  const zoho = createSimZoho(seed)
  const po = await rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 10, rate: 14 }] })
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: [{ sku: 'SNK-001', batch_no: 'B-LOCAL', expiry: '2027-06-30', qty: 10 }] }) // receipt never sent
  const t = await send(store, 'VM-004', 'SNK-001', 'B-LOCAL', 4)
  const failed = await sync.syncTransfer(store, zoho, t.transfer_no)
  assert.equal(failed.zoho_sync, 'failed')
  assert.match(failed.zoho_error, /no batch B-LOCAL/)
})

// ---------- the real Zoho request (no network: a stand-in answers) ----------

function stubFetch(answers, calls) {
  return async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body })
    const hit = answers.find(([match]) => String(url).includes(match))
    return { ok: true, status: 200, json: async () => (hit ? hit[1] : { code: 0 }) }
  }
}
const liveEnv = { ZOHO_CLIENT_ID: 'c', ZOHO_CLIENT_SECRET: 's', ZOHO_REFRESH_TOKEN: 'r', ZOHO_ORG_ID: '1', ZOHO_HEAD_OFFICE_LOCATION_ID: 'L-MAIN' }
const liveLines = [{ sku: 'SNK-001', batch_no: 'B-1', qty: 20, item: { zoho_item_id: 'I-1', name: 'Salted Chips 50g' }, batch: { zoho_batch_id: 'ZB-1' } }]

test('live export: main warehouse to the Vending Machine location, machine in the custom field, batch by id', async () => {
  const calls = []
  const zoho = createLiveZoho({ ...liveEnv, ZOHO_MACHINE_FIELD_ID: 'CF-9' }, {
    fetch: stubFetch([
      ['/oauth/v2/token', { access_token: 't', expires_in: 3600 }],
      ['/locations', { code: 0, locations: [{ location_id: 'L-MAIN', location_name: 'Main Warehouse' }, { location_id: 'L-VEND', location_name: 'Vending Machine' }], page_context: { has_more_page: false } }],
      ['/transferorders?', { code: 0, transfer_orders: [], transfer_order: { transfer_order_id: 'Z-TO-1' } }],
    ], calls),
  })
  const r = await zoho.createTransferOrder({ transfer: { transfer_no: 'TO-0001', transfer_date: '2026-11-25', machine_code: 'VM-017' }, lines: liveLines })
  assert.equal(r.transfer_order_id, 'Z-TO-1')
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/transferorders'))
  assert.ok(post.url.includes('/inventory/v1/'))
  const body = JSON.parse(post.body)
  assert.equal(body.from_location_id, 'L-MAIN')
  assert.equal(body.to_location_id, 'L-VEND')
  assert.equal(body.transfer_order_number, 'TO-0001')
  assert.deepEqual(body.custom_fields, [{ customfield_id: 'CF-9', value: 'VM-017' }])
  assert.deepEqual(body.line_items[0].batches, [{ batch_id: 'ZB-1', out_quantity: 20 }])
})

test('live export says what is missing before calling Zoho', async () => {
  const calls = []
  const noField = createLiveZoho(liveEnv, { fetch: stubFetch([], calls) })
  await assert.rejects(noField.createTransferOrder({ transfer: { transfer_no: 'TO-1' }, lines: liveLines }), /ZOHO_MACHINE_FIELD_ID/)
  assert.equal(calls.length, 0)
  const zoho = createLiveZoho({ ...liveEnv, ZOHO_MACHINE_FIELD_ID: 'CF-9', ZOHO_VENDING_LOCATION_ID: 'L-VEND' }, { fetch: stubFetch([['/oauth/v2/token', { access_token: 't' }]], calls) })
  await assert.rejects(zoho.createTransferOrder({ transfer: { transfer_no: 'TO-1' }, lines: [{ ...liveLines[0], batch: {} }] }), /Fetch from Zoho/)
})

// ---------- through the API ----------

test('the API: managers edit, delete and export transfers; only admins delete machines', async () => {
  const store = await makeStore(seed)
  const server = createApp({ store, zoho: createSimZoho(seed) }).listen(0)
  const base = `http://localhost:${server.address().port}/api`
  const as = (role, email) => ({ 'content-type': 'application/json', 'x-user-role': role, 'x-user-email': email })
  const m = as('manager', 'mgr@example.com')
  try {
    const t = await (await fetch(`${base}/transfers`, { method: 'POST', headers: m, body: JSON.stringify({ machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }] }) })).json()
    const put = await fetch(`${base}/transfers/${t.transfer_no}`, { method: 'PUT', headers: m, body: JSON.stringify({ machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 7 }] }) })
    assert.equal(put.status, 200)
    const exp = await (await fetch(`${base}/transfers/${t.transfer_no}/sync`, { method: 'POST', headers: m })).json()
    assert.equal(exp.zoho_sync, 'synced')
    assert.equal((await fetch(`${base}/transfers/${t.transfer_no}`, { method: 'DELETE', headers: m })).status, 400)
    assert.equal((await fetch(`${base}/machines/VM-005`, { method: 'DELETE', headers: m })).status, 403)
    assert.equal((await fetch(`${base}/machines/VM-005`, { method: 'DELETE', headers: as('admin', 'a@example.com') })).status, 200)
    const field = as('field', 'ravi@example.com')
    assert.equal((await fetch(`${base}/transfers/${t.transfer_no}/sync`, { method: 'POST', headers: field })).status, 403)
  } finally {
    server.close()
  }
})
