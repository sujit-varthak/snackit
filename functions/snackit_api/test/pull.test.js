'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/rules')
const { pullItems, pullVendors, pullBatches } = require('../src/pull')
const { makeStore } = require('./helpers')
const { createSimZoho } = require('../src/zoho')
const { createApp } = require('../src/app')
const seed = require('../src/seed')

const manager = { email: 'mgr@example.com', role: 'manager' }
const zItem = (over) => ({ zoho_item_id: 'Z1', sku: 'NEW-1', name: 'New item', category: '', barcode: '', cost: 10, price: 20, active: true, goods: true, ...over })
const zVendor = (over) => ({ zoho_vendor_id: 'C1', name: 'New Vendor', contact: '', phone: '', email: '', gstin: '', active: true, ...over })
const zBatch = (over) => ({ sku: 'SNK-001', batch_no: 'B-2611-A', expiry: '2027-02-15', qty: 400, batch_id: 'ZB1', ...over })
const stub = ({ items = [], vendors = [], batches = [] }) => ({
  mode: 'live',
  async listItems() { return structuredClone(items) },
  async listVendors() { return structuredClone(vendors) },
  async listBatches(wanted) { return structuredClone(batches.filter((b) => wanted.some((i) => i.sku === b.sku))) },
})
const reasons = (r) => Object.fromEntries(r.skipped.map((s) => [s.ref, s.reason]))
// Calls again with after = next until the work is done, as the web page does.
async function untilDone(fn) {
  const calls = []
  let after = ''
  do {
    const r = await fn(after)
    calls.push(r)
    after = r.next
  } while (after && calls.length < 100)
  return calls
}
const total = (calls, k) => calls.reduce((s, r) => s + r[k], 0)

// ---------- items ----------

test('items: new ones are added, known ones updated, and a second fetch changes nothing', async () => {
  const store = await makeStore(seed)
  const zoho = stub({ items: [zItem(), zItem({ zoho_item_id: 'Z2', sku: 'SNK-001', name: 'Salted Chips 55g', price: 22.499, cost: 14 })] })
  const first = await pullItems(store, zoho)
  assert.deepEqual([first.fetched, first.added, first.updated, first.skipped.length, first.next], [2, 1, 1, 0, ''])
  const chips = await store.get('items', 'SNK-001')
  assert.equal(chips.name, 'Salted Chips 55g')
  assert.equal(chips.price, 22.5) // two decimals
  assert.equal(chips.zoho_item_id, 'Z2')
  assert.equal(chips.category, 'Snacks') // Zoho sent no category, so ours is kept
  assert.equal(chips.subcategory, 'Chips')
  const again = await pullItems(store, zoho)
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 2])
})

test('items: rows the app cannot take are listed with the reason', async () => {
  const store = await makeStore(seed)
  await pullItems(store, stub({ items: [zItem({ zoho_item_id: 'Z9', sku: 'SNK-002', name: 'Chikki' })] }))
  const r = await pullItems(store, stub({
    items: [
      zItem({ zoho_item_id: 'A', sku: '', name: 'No code' }),
      zItem({ zoho_item_id: 'B', sku: 'BAD|SKU' }),
      zItem({ zoho_item_id: 'C', sku: 'OLD-1', active: false }),
      zItem({ zoho_item_id: 'D', sku: 'SVC-1', goods: false }),
      zItem({ zoho_item_id: 'E', sku: 'TWIN-1', active: false, name: 'Retired twin' }),
      zItem({ zoho_item_id: 'F', sku: 'TWIN-1', name: 'Current twin' }),
      zItem({ zoho_item_id: 'Z9', sku: 'RENAMED-1' }),
    ],
  }))
  assert.equal(r.added, 1) // only the active twin
  assert.equal((await store.get('items', 'TWIN-1')).name, 'Current twin')
  const why = reasons(r)
  assert.match(why['No code'], /No SKU/)
  assert.match(why['BAD|SKU'], /\|/)
  assert.match(why['OLD-1'], /Inactive/)
  assert.match(why['SVC-1'], /service/)
  assert.match(why['TWIN-1'], /same SKU/)
  assert.match(why['RENAMED-1'], /changed in Zoho from SNK-002/)
  assert.equal(await store.get('items', 'RENAMED-1'), null)
})

test('items: work stops when the time is up and carries on from there', async () => {
  const store = await makeStore({})
  const items = ['c', 'a', 'b'].map((x) => zItem({ zoho_item_id: x, sku: `SKU-${x}` }))
  const calls = await untilDone((after) => pullItems(store, stub({ items }), { after, budgetMs: 0 }))
  assert.equal(calls.length, 3)
  assert.equal(total(calls, 'added'), 3)
  assert.equal((await store.list('items')).length, 3)
})

// ---------- vendors ----------

test('vendors: matched by name once, then by Zoho id; new ones get the next code', async () => {
  const store = await makeStore(seed)
  const vendors = [zVendor({ zoho_vendor_id: 'C1', name: 'crunchy foods pvt ltd', phone: '9999999999' }), zVendor({ zoho_vendor_id: 'C2', name: 'New Vendor' }), zVendor({ zoho_vendor_id: 'C3', name: 'Gone', active: false })]
  const r = await pullVendors(store, stub({ vendors }))
  assert.deepEqual([r.added, r.updated, r.skipped.length], [1, 1, 1])
  const linked = await store.get('vendors', 'V-001')
  assert.equal(linked.zoho_vendor_id, 'C1')
  assert.equal(linked.phone, '9999999999')
  assert.equal(linked.gstin, '29AAAAA0000A1Z5') // Zoho sent none, so ours is kept
  assert.equal((await store.get('vendors', 'V-003')).name, 'New Vendor')
  vendors[0].name = 'Crunchy Foods Limited' // renamed in Zoho: same row, because the id matches
  vendors[1].active = false
  const again = await pullVendors(store, stub({ vendors }))
  assert.deepEqual([again.added, again.updated], [0, 2])
  assert.equal((await store.get('vendors', 'V-001')).name, 'Crunchy Foods Limited')
  assert.equal((await store.get('vendors', 'V-003')).active, false)
  assert.equal((await store.list('vendors')).length, 3)
})

test('vendors: codes stay unique when the work is split over several calls', async () => {
  const store = await makeStore(seed)
  const vendors = ['x', 'y', 'z'].map((x) => zVendor({ zoho_vendor_id: x, name: `Vendor ${x}` }))
  await untilDone((after) => pullVendors(store, stub({ vendors }), { after, budgetMs: 0 }))
  assert.deepEqual((await store.list('vendors')).map((v) => v.vendor_code).sort(), ['V-001', 'V-002', 'V-003', 'V-004', 'V-005'])
})

// ---------- head-office batches ----------

async function linked(skus = ['SNK-001']) {
  const store = await makeStore(seed)
  for (const [n, sku] of skus.entries()) await store.put('items', { ...(await store.get('items', sku)), zoho_item_id: `Z${n}` })
  return store
}

test('batches: nothing is read until items are linked to Zoho', async () => {
  const r = await pullBatches(await makeStore(seed), stub({ batches: [zBatch()] }))
  assert.match(r.stopped, /Fetch items first/)
  assert.equal(r.fetched, 0)
})

test('batches: quantities, expiry and the Zoho batch id come from Zoho; a new batch is added', async () => {
  const store = await linked()
  const r = await pullBatches(store, stub({ batches: [zBatch({ qty: 380 }), zBatch({ batch_no: 'B-2612-B', expiry: '', qty: 600, batch_id: 'ZB2' }), zBatch({ batch_no: 'Z-NEW', expiry: '', qty: 7, batch_id: 'ZB3' }), zBatch({ batch_no: 'Z-EMPTY', qty: 0 })] }))
  assert.deepEqual([r.added, r.updated, r.skipped.length], [1, 2, 0])
  assert.equal((await store.get('batches', 'SNK-001|B-2611-A')).qty, 380)
  assert.equal((await store.get('batches', 'SNK-001|B-2612-B')).expiry, '2027-04-30') // kept
  assert.equal((await store.get('batches', 'SNK-001|B-2612-B')).zoho_batch_id, 'ZB2')
  assert.equal((await store.get('batches', 'SNK-001|Z-NEW')).expiry, '')
  assert.equal(await store.get('batches', 'SNK-001|Z-EMPTY'), null)
})

test('batches: transfers and receipts Zoho does not have yet are kept in the app quantity', async () => {
  const store = await linked()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 30 }] })
  const po = await rules.createPurchaseOrder(store, manager, { vendor_code: 'V-001', lines: [{ sku: 'SNK-001', qty: 50, rate: 14 }] })
  await rules.receivePurchaseOrder(store, manager, po.po_no, { receipts: [{ sku: 'SNK-001', batch_no: 'B-2612-B', expiry: '2027-04-30', qty: 50 }] })
  const zoho = stub({ batches: [zBatch({ qty: 400 }), zBatch({ batch_no: 'B-2612-B', expiry: '2027-04-30', qty: 600, batch_id: 'ZB2' })] })
  await pullBatches(store, zoho)
  assert.equal((await store.get('batches', 'SNK-001|B-2611-A')).qty, 370) // 400 in Zoho, 30 already sent to a machine
  assert.equal((await store.get('batches', 'SNK-001|B-2612-B')).qty, 650) // 600 in Zoho, 50 received here
  await pullBatches(store, zoho) // running it again must not move anything
  assert.equal((await store.get('batches', 'SNK-001|B-2611-A')).qty, 370)
  assert.equal((await store.get('batches', 'SNK-001|B-2612-B')).qty, 650)
})

test('batches: doubtful rows are reported and left alone', async () => {
  const store = await linked()
  await rules.createTransfer(store, manager, { machine_code: 'VM-004', lines: [{ sku: 'SNK-001', batch_no: 'B-2611-A', qty: 30 }] })
  const r = await pullBatches(store, stub({ batches: [zBatch({ qty: 10 }), zBatch({ batch_no: 'HALF', qty: 1.5 }), zBatch({ batch_no: 'TWICE', qty: 1 }), zBatch({ batch_no: 'TWICE', qty: 2 })] }))
  const why = reasons(r)
  assert.match(why['SNK-001|B-2611-A'], /less than the transfers/)
  assert.match(why['SNK-001|HALF'], /whole number/)
  assert.match(why['SNK-001|TWICE'], /more than one/)
  assert.match(why['SNK-001|B-2612-B'], /not in Zoho/)
  assert.equal((await store.get('batches', 'SNK-001|B-2611-A')).qty, 370)
  assert.equal((await store.get('batches', 'SNK-001|B-2612-B')).qty, 600)
})

test('batches: if Zoho stops part way, what was done is kept and the next call carries on', async () => {
  const store = await linked(['BEV-001', 'SNK-001'])
  let limited = true
  const base = stub({ batches: [zBatch({ sku: 'BEV-001', batch_no: 'B-2611-E', expiry: '2027-05-01', qty: 450 }), zBatch({ qty: 390 })] })
  const zoho = { ...base, async listBatches(w) { if (limited && w[0].sku === 'SNK-001') throw new Error('Zoho call limit reached.'); return base.listBatches(w) } }
  const first = await pullBatches(store, zoho)
  assert.equal(first.next, 'BEV-001')
  assert.match(first.stopped, /call limit/)
  assert.equal((await store.get('batches', 'BEV-001|B-2611-E')).qty, 450)
  await assert.rejects(pullBatches(store, zoho, { after: first.next }), /call limit/) // nothing at all could be done
  limited = false
  const rest = await pullBatches(store, zoho, { after: first.next })
  assert.equal(rest.next, '')
  assert.equal((await store.get('batches', 'SNK-001|B-2611-A')).qty, 390)
})

// ---------- through the API ----------

async function withApi(options, fn) {
  const server = createApp({ store: await makeStore(seed), ...options }).listen(0)
  const post = async (path, role) => {
    const res = await fetch(`http://localhost:${server.address().port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user-email': 'a@example.com', 'x-user-role': role }, body: '{}',
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    await fn(post)
  } finally {
    server.close()
  }
}

test('API: an admin fetches items, vendors and batches from the simulated Zoho', async () => {
  await withApi({ zoho: createSimZoho(seed) }, async (post) => {
    for (const [what, count] of [['items', 8], ['vendors', 2], ['batches', 9]]) {
      const r = await post(`/api/sync/${what}`, 'admin')
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(r.body.fetched, count)
      assert.equal(r.body.updated, count) // each demo row gains its Zoho id
      assert.equal(r.body.skipped.length, 0)
    }
  })
})

test('API: only admins fetch, unknown names are refused, and demo data never goes into the real tables', async () => {
  await withApi({ zoho: createSimZoho(seed) }, async (post) => {
    assert.equal((await post('/api/sync/items', 'manager')).status, 403)
    assert.equal((await post('/api/sync/toString', 'admin')).status, 404)
  })
  await withApi({ zoho: createSimZoho(seed), allowSimulatedPull: false }, async (post) => {
    const r = await post('/api/sync/items', 'admin')
    assert.equal(r.status, 403)
    assert.match(r.body.error.message, /simulated/)
  })
})
