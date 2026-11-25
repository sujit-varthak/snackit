'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/rules')
const sync = require('../src/sync')
const { createMemoryStore } = require('../src/store/memory')
const { createSimZoho, createZoho } = require('../src/zoho')
const seed = require('../src/seed')
const { createApp } = require('../src/app')

const manager = { email: 'mgr@example.com', role: 'manager' }
const setup = () => ({ store: createMemoryStore({ initial: seed }), zoho: createSimZoho({ batches: seed.batches }) })
const order = (store) => rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 100, rate: 14 }] })
const receipt = [{ sku: 'SNK-001', batch_no: 'B-NEW', expiry: '2027-03-31', qty: 100 }]

// Step 1: create the purchase order and send it to Zoho
test('step 1: a new purchase order is saved, then sent to Zoho', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  assert.equal(po.zoho_sync, 'pending') // saved first
  const sent = await sync.syncPurchaseOrder(store, zoho, po.po_no)
  assert.equal(sent.zoho_sync, 'synced')
  assert.ok(sent.zoho_id)
  assert.equal(sent.zoho_lines.length, 1)
  assert.ok((await store.get('vendors', 'V-001')).zoho_vendor_id) // vendor id stored for later
})

test('step 1: when Zoho is down the order is kept and marked failed, and a retry sends it once', async () => {
  const { store, zoho } = setup()
  zoho.setDown(true)
  const po = await order(store)
  const failed = await sync.syncPurchaseOrder(store, zoho, po.po_no)
  assert.equal(failed.zoho_sync, 'failed')
  assert.match(failed.zoho_error, /unreachable/)
  assert.equal((await store.list('purchase_orders')).length, 1)
  zoho.setDown(false)
  const ok = await sync.syncPurchaseOrder(store, zoho, po.po_no)
  assert.equal(ok.zoho_sync, 'synced')
  assert.equal(ok.zoho_error, '')
  const again = await sync.syncPurchaseOrder(store, zoho, po.po_no)
  assert.equal(again.zoho_id, ok.zoho_id) // a second retry does not create another order
})

// Steps 2 and 3: receive and save the receipt
test('steps 2 and 3: receiving adds the batch at head office and closes the order', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  await sync.syncPurchaseOrder(store, zoho, po.po_no)
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt })
  const batch = await store.get('batches', 'SNK-001|B-NEW')
  assert.equal(batch.qty, 100)
  assert.equal(batch.expiry, '2027-03-31')
  const saved = await store.get('purchase_orders', po.po_no)
  assert.equal(saved.status, 'received')
  assert.equal(saved.zoho_receipt_sync, 'pending') // saved first, not sent yet
})

// Step 4: send the receipt to Zoho
test('step 4: the receipt reaches Zoho and the Zoho batch id is stored', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  await sync.syncPurchaseOrder(store, zoho, po.po_no)
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt })
  const done = await sync.syncReceipt(store, zoho, po.po_no)
  assert.equal(done.zoho_receipt_sync, 'synced')
  assert.ok(done.zoho_receipt_id)
  assert.ok((await store.get('batches', 'SNK-001|B-NEW')).zoho_batch_id)
})

test('step 4: a receipt that fails stays in the app, and retrying twice adds stock to Zoho once', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  await sync.syncPurchaseOrder(store, zoho, po.po_no)
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt })
  zoho.setDown(true)
  const failed = await sync.syncReceipt(store, zoho, po.po_no)
  assert.equal(failed.zoho_receipt_sync, 'failed')
  assert.equal((await store.get('batches', 'SNK-001|B-NEW')).qty, 100) // app stock is already correct
  zoho.setDown(false)
  await sync.syncAll(store, zoho, po.po_no)
  await sync.syncAll(store, zoho, po.po_no)
  const z = (await zoho.listBatches()).find((b) => b.batch_no === 'B-NEW')
  assert.equal(z.qty, 100)
})

test('step 4: if the order never reached Zoho, the receipt sends the order first', async () => {
  const { store, zoho } = setup()
  zoho.setDown(true)
  const po = await order(store)
  await sync.syncPurchaseOrder(store, zoho, po.po_no) // fails
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt })
  const first = await sync.syncReceipt(store, zoho, po.po_no)
  assert.equal(first.zoho_receipt_sync, 'failed')
  zoho.setDown(false)
  const done = await sync.syncAll(store, zoho, po.po_no)
  assert.equal(done.zoho_sync, 'synced')
  assert.equal(done.zoho_receipt_sync, 'synced')
})

test('if Zoho got the call but our record of it was lost, resending creates nothing twice', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  const first = await sync.syncPurchaseOrder(store, zoho, po.po_no)
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt })
  const rec1 = await sync.syncReceipt(store, zoho, po.po_no)
  // Pretend the app crashed before it saved the "synced" result.
  await store.put('purchase_orders', { ...(await store.get('purchase_orders', po.po_no)), zoho_sync: 'pending', zoho_id: '', zoho_receipt_sync: 'pending', zoho_receipt_id: '' })
  const again = await sync.syncAll(store, zoho, po.po_no)
  assert.equal(again.zoho_id, first.zoho_id)
  assert.equal(again.zoho_receipt_id, rec1.zoho_receipt_id)
  assert.equal((await zoho.listBatches()).find((b) => b.batch_no === 'B-NEW').qty, 100)
})

test('a receipt is refused until the order has been received', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  await assert.rejects(sync.syncReceipt(store, zoho, po.po_no), (e) => e.code === 'INVALID_INPUT')
})

// Step 5: head office in the app against Zoho
test('step 5: after a full cycle head office matches Zoho', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  await sync.syncPurchaseOrder(store, zoho, po.po_no)
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt })
  await sync.syncReceipt(store, zoho, po.po_no)
  const c = await sync.headOfficeComparison(store, zoho)
  assert.equal(c.ok, true)
  assert.ok(c.rows.length >= 10)
  assert.ok(c.rows.every((r) => r.status === 'match'), JSON.stringify(c.rows.filter((r) => r.status !== 'match')))
})

test('step 5: a received order that has not reached Zoho shows as a difference to check', async () => {
  const { store, zoho } = setup()
  const po = await order(store)
  await sync.syncPurchaseOrder(store, zoho, po.po_no)
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: receipt }) // not sent
  const row = (await sync.headOfficeComparison(store, zoho)).rows.find((r) => r.batch_no === 'B-NEW')
  assert.equal(row.app_qty, 100)
  assert.equal(row.zoho_qty, 0)
  assert.equal(row.status, 'check')
})

test('step 5: a transfer not yet in Zoho is explained, not flagged', async () => {
  const { store, zoho } = setup()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 25 }] })
  const row = (await sync.headOfficeComparison(store, zoho)).rows.find((r) => r.batch_no === 'B-2611-A')
  assert.equal(row.diff, -25)
  assert.equal(row.status, 'explained')
})

test('step 5: when Zoho cannot be read the comparison says so', async () => {
  const { store, zoho } = setup()
  zoho.setDown(true)
  const c = await sync.headOfficeComparison(store, zoho)
  assert.equal(c.ok, false)
  assert.match(c.error, /unreachable/)
})

// Configuration and the HTTP layer
test('live Zoho refuses to start without its settings and says which are missing', () => {
  assert.throws(() => createZoho({ ZOHO_MODE: 'live' }), /ZOHO_CLIENT_ID.*ZOHO_ORG_ID/)
  assert.equal(createZoho({}, { batches: [] }).mode, 'simulated')
})

test('the whole flow works through the API, and field staff cannot use it', async () => {
  const { store, zoho } = setup()
  const server = createApp({ store, zoho }).listen(0)
  const base = `http://localhost:${server.address().port}/api`
  const h = { 'content-type': 'application/json', 'x-user-email': 'mgr@example.com', 'x-user-role': 'manager' }
  const f = { 'x-user-email': 'ravi@example.com', 'x-user-role': 'field' }
  try {
    const created = await (await fetch(`${base}/purchase-orders`, { method: 'POST', headers: h, body: JSON.stringify({ vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 100, rate: 14 }] }) })).json()
    assert.equal(created.zoho_sync, 'synced')
    const rec = await (await fetch(`${base}/purchase-orders/${created.po_no}/receive`, { method: 'POST', headers: h, body: JSON.stringify({ receipts: receipt }) })).json()
    assert.equal(rec.status, 'received')
    assert.equal(rec.zoho_receipt_sync, 'synced')
    const cmp = await (await fetch(`${base}/zoho/head-office`, { headers: h })).json()
    assert.equal(cmp.mode, 'simulated')
    assert.ok(cmp.rows.every((r) => r.status === 'match'))
    await fetch(`${base}/dev/zoho`, { method: 'POST', headers: h, body: JSON.stringify({ down: true }) })
    const st = await (await fetch(`${base}/zoho/status`, { headers: h })).json()
    assert.equal(st.up, false)
    for (const p of ['/zoho/status', '/zoho/head-office', '/purchase-orders']) assert.equal((await fetch(base + p, { headers: f })).status, 403)
  } finally {
    server.close()
  }
})
