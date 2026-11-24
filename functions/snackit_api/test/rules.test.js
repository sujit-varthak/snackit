'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/rules')
const { createMemoryStore } = require('../src/store/memory')
const seed = require('../src/seed')
const { createApp } = require('../src/app')

const manager = { email: 'mgr@example.com', role: 'manager' }
const admin = { email: 'admin@example.com', role: 'admin' }
const ravi = { email: 'ravi@example.com', role: 'field' } // assigned to VM-001 and VM-002
const fresh = () => createMemoryStore({ initial: seed })
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code, `expected ${code}`)
const qty = async (store, table, key, field = 'qty') => (await store.get(table, key))?.[field]

// ---------- transfers ----------

test('a transfer moves stock from head office to the machine', async () => {
  const store = fresh()
  const t = await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 25 }] })
  assert.equal(t.transfer_no, 'TO-0001')
  assert.equal(t.zoho_sync, 'pending')
  assert.equal(await qty(store, 'batches', 'SNK-001|B-2611-A'), 375)
  assert.equal(await qty(store, 'machine_stock', 'VM-004|SNK-001|B-2611-A'), 25)
})

test('a transfer adds to existing machine stock', async () => {
  const store = fresh()
  await rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 5 }] })
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 25)
})

test('asking for more than the batch holds is refused and changes nothing', async () => {
  const store = fresh()
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 151 }] }), 'BATCH_SHORT')
  assert.equal(await qty(store, 'batches', 'SNK-003|B-2611-D'), 150)
  assert.equal((await store.list('transfers')).length, 0)
})

test('repeated lines for one batch are added up before the check', async () => {
  const store = fresh()
  const lines = [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 100 }, { sku: 'SNK-003', batch_no: 'B-2611-D', qty: 100 }]
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-004', lines }), 'BATCH_SHORT')
})

test('a failure on a later line undoes the earlier lines', async () => {
  const store = fresh()
  const lines = [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 10 }, { sku: 'SNK-003', batch_no: 'B-2611-D', qty: 999 }]
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-004', lines }), 'BATCH_SHORT')
  assert.equal(await qty(store, 'batches', 'SNK-001|B-2611-A'), 400)
  assert.equal(await store.get('machine_stock', 'VM-004|SNK-001|B-2611-A'), null)
})

test('bad transfer input is refused', async () => {
  const store = fresh()
  const ok = [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 1 }]
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-999', lines: ok }), 'NOT_FOUND')
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [] }), 'INVALID_INPUT')
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [{ ...ok[0], qty: 0 }] }), 'INVALID_INPUT')
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [{ ...ok[0], qty: 1.5 }] }), 'INVALID_INPUT')
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [{ ...ok[0], qty: -3 }] }), 'INVALID_INPUT')
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [{ sku: 'SNK-001', qty: 1 }] }), 'INVALID_INPUT')
  await rejects(rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: [{ sku: 'SNK-001', batch_no: 'NOPE', qty: 1 }] }), 'NOT_FOUND')
})

test('field staff cannot create transfers', async () => {
  await rejects(rules.createTransfer(fresh(), ravi, { machine_code: 'VM-001', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 1 }] }), 'NOT_ALLOWED')
})

test('transfer numbers keep counting up', async () => {
  const store = fresh()
  const line = [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 1 }]
  await rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: line })
  const second = await rules.createTransfer(store, manager, { machine_code: 'VM-001', lines: line })
  assert.equal(second.transfer_no, 'TO-0002')
})

// ---------- consumption ----------

test('consumption uses the batch that expires first', async () => {
  const store = fresh()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [
    { sku: 'SNK-001', batch_no: 'B-2612-B', qty: 10 }, // expires 2027-04-30
    { sku: 'SNK-001', batch_no: 'B-2611-A', qty: 10 }, // expires 2027-02-15
  ] })
  await rules.applyConsumption(store, admin, { consumption_date: '2026-11-24', lines: [{ machine_code: 'VM-004', sku: 'SNK-001', qty: 12 }] })
  assert.equal(await store.get('machine_stock', 'VM-004|SNK-001|B-2611-A'), null) // earlier batch used up first
  assert.equal(await qty(store, 'machine_stock', 'VM-004|SNK-001|B-2612-B'), 8)
})

test('a file asking for more than a machine holds is refused whole', async () => {
  const store = fresh()
  const lines = [{ machine_code: 'VM-001', sku: 'SNK-001', qty: 5 }, { machine_code: 'VM-002', sku: 'SNK-003', qty: 99 }]
  await assert.rejects(rules.applyConsumption(store, admin, { consumption_date: '2026-11-24', lines }), (e) => {
    return e.code === 'STOCK_SHORT' && e.details.errors.some((x) => x.machine_code === 'VM-002')
  })
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 20) // the good row was not applied either
  assert.equal((await store.list('consumption_reports')).length, 0)
})

test('unknown machine, unknown item and bad quantity are all listed', async () => {
  const store = fresh()
  const lines = [{ machine_code: 'VM-999', sku: 'SNK-001', qty: 1 }, { machine_code: 'VM-001', sku: 'XXX', qty: 1 }, { machine_code: 'VM-001', sku: 'SNK-001', qty: 0 }]
  const r = await rules.checkConsumption(store, admin, { consumption_date: '2026-11-24', lines })
  assert.equal(r.errors.length, 3)
  await rejects(rules.applyConsumption(store, admin, { consumption_date: '2026-11-24', lines }), 'INVALID_INPUT')
})

test('a bad date is refused', async () => {
  await rejects(rules.applyConsumption(fresh(), admin, { consumption_date: '24/11/2026', lines: [{ machine_code: 'VM-001', sku: 'SNK-001', qty: 1 }] }), 'INVALID_INPUT')
})

test('the same day cannot be applied twice without confirming', async () => {
  const store = fresh()
  const input = { consumption_date: '2026-11-24', lines: [{ machine_code: 'VM-001', sku: 'SNK-001', qty: 2 }] }
  await rules.applyConsumption(store, admin, input)
  await rejects(rules.applyConsumption(store, admin, input), 'DUPLICATE')
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 18)
  await rules.applyConsumption(store, admin, { ...input, confirm_duplicate: true })
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 16)
})

test('field staff can only report for their own machines', async () => {
  const store = fresh()
  await rejects(rules.applyConsumption(store, ravi, { consumption_date: '2026-11-24', lines: [{ machine_code: 'VM-003', sku: 'BEV-003', qty: 1 }] }), 'NOT_ALLOWED')
  await rules.applyConsumption(store, ravi, { consumption_date: '2026-11-24', lines: [{ machine_code: 'VM-001', sku: 'SNK-001', qty: 1 }] })
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 19)
})

test('the preview changes nothing', async () => {
  const store = fresh()
  const r = await rules.checkConsumption(store, admin, { consumption_date: '2026-11-24', lines: [{ machine_code: 'VM-001', sku: 'SNK-001', qty: 3 }] })
  assert.equal(r.errors.length, 0)
  assert.equal(r.units, 3)
  assert.equal(await qty(store, 'machine_stock', 'VM-001|SNK-001|B-2611-A'), 20)
})

// ---------- purchase orders ----------

const po = (store) => rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 100, rate: 14 }] })

test('receiving a purchase order adds the batch to head office', async () => {
  const store = fresh()
  const order = await po(store)
  assert.equal(order.po_no, 'PO-0001')
  await rules.receivePurchaseOrder(store, manager, order.po_no, { receipts: [{ sku: 'SNK-001', batch_no: 'B-NEW', expiry: '2027-12-31', qty: 100 }] })
  const batch = await store.get('batches', 'SNK-001|B-NEW')
  assert.equal(batch.qty, 100)
  assert.equal(batch.expiry, '2027-12-31')
  assert.equal((await store.get('purchase_orders', 'PO-0001')).status, 'received')
})

test('a purchase order cannot be received twice', async () => {
  const store = fresh()
  const order = await po(store)
  const receipts = [{ sku: 'SNK-001', batch_no: 'B-NEW', expiry: '2027-12-31', qty: 100 }]
  await rules.receivePurchaseOrder(store, manager, order.po_no, { receipts })
  await rejects(rules.receivePurchaseOrder(store, manager, order.po_no, { receipts }), 'DUPLICATE')
  assert.equal(await qty(store, 'batches', 'SNK-001|B-NEW'), 100)
})

test('a receipt needs a batch number and an expiry', async () => {
  const store = fresh()
  const order = await po(store)
  await rejects(rules.receivePurchaseOrder(store, manager, order.po_no, { receipts: [{ sku: 'SNK-001', batch_no: '', expiry: '2027-12-31', qty: 10 }] }), 'INVALID_INPUT')
  await rejects(rules.receivePurchaseOrder(store, manager, order.po_no, { receipts: [{ sku: 'SNK-001', batch_no: 'B-X', expiry: '', qty: 10 }] }), 'INVALID_INPUT')
  await rejects(rules.receivePurchaseOrder(store, manager, order.po_no, { receipts: [{ sku: 'SNK-001', batch_no: 'B-X', expiry: '2027-12-31', qty: 101 }] }), 'INVALID_INPUT')
  await rejects(rules.receivePurchaseOrder(store, manager, order.po_no, { receipts: [{ sku: 'BEV-001', batch_no: 'B-X', expiry: '2027-12-31', qty: 1 }] }), 'INVALID_INPUT')
  assert.equal((await store.get('purchase_orders', 'PO-0001')).status, 'open')
})

test('a batch cannot be received again with a different expiry', async () => {
  const store = fresh()
  const order = await po(store)
  await rejects(rules.receivePurchaseOrder(store, manager, order.po_no, { receipts: [{ sku: 'SNK-001', batch_no: 'B-2611-A', expiry: '2030-01-01', qty: 5 }] }), 'INVALID_INPUT')
})

test('purchase order input is checked', async () => {
  const store = fresh()
  await rejects(rules.createPurchaseOrder(store, manager, { vendor_code: 'V-999', lines: [{ sku: 'SNK-001', qty: 1, rate: 1 }] }), 'NOT_FOUND')
  await rejects(rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [] }), 'INVALID_INPUT')
  await rejects(rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [{ sku: 'NOPE', qty: 1, rate: 1 }] }), 'INVALID_INPUT')
  await rejects(rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 1, rate: -1 }] }), 'INVALID_INPUT')
  await rejects(rules.createPurchaseOrder(store, ravi, { vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 1, rate: 1 }] }), 'NOT_ALLOWED')
})

// ---------- who sees what ----------

test('field staff see only their machines and stock', async () => {
  const store = fresh()
  const machines = await rules.visibleMachines(store, ravi)
  assert.deepEqual(machines.map((m) => m.machine_code).sort(), ['VM-001', 'VM-002'])
  const stock = await rules.stockFor(store, ravi)
  assert.ok(stock.every((r) => ['VM-001', 'VM-002'].includes(r.machine_code)))
  await rejects(rules.stockFor(store, ravi, 'VM-003'), 'NOT_ALLOWED')
  assert.equal((await rules.visibleMachines(store, manager)).length, 5)
})

test('stock rows carry the batch expiry', async () => {
  const rows = await rules.stockFor(fresh(), ravi, 'VM-001')
  assert.equal(rows.find((r) => r.sku === 'SNK-001').expiry, '2027-02-15')
})

test('only admins add machines', async () => {
  const store = fresh()
  await rejects(rules.saveMachine(store, manager, { machine_code: 'VM-006', name: 'New' }), 'NOT_ALLOWED')
  await rules.saveMachine(store, admin, { machine_code: 'VM-006', name: 'New', staff_emails: 'x@example.com' })
  assert.equal((await store.list('machines')).length, 6)
})

// ---------- the HTTP layer ----------

test('the API answers with the contract error shape and checks the login', async () => {
  const app = createApp({ store: fresh() })
  const server = app.listen(0)
  const base = `http://localhost:${server.address().port}`
  try {
    const noLogin = await fetch(`${base}/api/machines`)
    assert.equal(noLogin.status, 403)
    const h = { 'content-type': 'application/json', 'x-user-email': 'mgr@example.com', 'x-user-role': 'manager' }
    const bad = await fetch(`${base}/api/transfers`, { method: 'POST', headers: h, body: JSON.stringify({ machine_code: 'VM-004', lines: [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 500 }] }) })
    assert.equal(bad.status, 409)
    const body = await bad.json()
    assert.equal(body.error.code, 'BATCH_SHORT')
    assert.equal(body.error.details.available, 150)
    const good = await fetch(`${base}/api/transfers`, { method: 'POST', headers: h, body: JSON.stringify({ machine_code: 'VM-004', lines: [{ sku: 'SNK-003', batch_no: 'B-2611-D', qty: 10 }] }) })
    assert.equal(good.status, 200)
    assert.equal((await good.json()).transfer_no, 'TO-0001')
    const junk = await fetch(`${base}/api/transfers`, { method: 'POST', headers: h, body: '{nope' })
    assert.equal(junk.status, 400)
    const field = { 'x-user-email': 'ravi@example.com', 'x-user-role': 'field' }
    const mine = await (await fetch(`${base}/api/machines`, { headers: field })).json()
    assert.equal(mine.length, 2)
    const vendors = await fetch(`${base}/api/vendors`, { headers: field })
    assert.equal(vendors.status, 403)
  } finally {
    server.close()
  }
})
