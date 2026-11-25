'use strict'
const { batchKey } = require('./schema')

// Brings Zoho's items, vendors and head-office batches into our tables. Zoho owns these facts (data contract section 1).
// Safe to run again: only changed rows are written, nothing is deleted, and fields Zoho does not send are kept.
// A Catalyst Advanced I/O function is stopped after 30 seconds, so each call works for a limited time and returns
// `next`; call again with after = next until next is empty.
const BUDGET_MS = 15000

const round2 = (n) => Math.round(n * 100) / 100
const newResult = (kind, mode) => ({ kind, mode, fetched: 0, added: 0, updated: 0, unchanged: 0, skipped: [], next: '', stopped: '' })
const skip = (result, ref, reason) => result.skipped.push({ ref, reason })

// Handles the records after `after` in key order until the time is up. At least one is handled, so every call advances.
async function walk(records, keyOf, after, deadline, handle) {
  const sorted = [...records].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
  const todo = after ? sorted.filter((r) => keyOf(r) > after) : sorted
  let last = after
  for (let i = 0; i < todo.length; i++) {
    if (i > 0 && Date.now() >= deadline) return { next: last }
    try {
      await handle(todo[i])
    } catch (e) {
      if (i === 0) throw e
      return { next: last, stopped: e.message } // keep what was done; the caller can carry on from here
    }
    last = keyOf(todo[i])
  }
  return { next: '' }
}

async function save(store, table, current, next, result, ref) {
  if (current && Object.keys(next).every((k) => next[k] === current[k])) {
    result.unchanged++
    return
  }
  try {
    await store.put(table, next)
    result[current ? 'updated' : 'added']++
  } catch (e) {
    skip(result, ref, `Could not save: ${e.message}`)
  }
}

// Copies the values Zoho actually sent; an empty one never wipes what we have.
function fill(row, values) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '' || Number.isNaN(v)) continue
    row[k] = v
  }
  return row
}

// ---------- items ----------

async function pullItems(store, zoho, { after = '', budgetMs = BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs
  const theirs = await zoho.listItems()
  const result = { ...newResult('items', zoho.mode), fetched: theirs.length }
  const ours = await store.list('items')
  const bySku = new Map(ours.map((i) => [i.sku, i]))
  const byZohoId = new Map(ours.filter((i) => i.zoho_item_id).map((i) => [i.zoho_item_id, i]))
  // Which Zoho item a SKU belongs to, when several carry it: an active one first, then the lowest id.
  const owner = new Map()
  const ranked = [...theirs].sort((a, b) => Number(b.active) - Number(a.active) || a.zoho_item_id.localeCompare(b.zoho_item_id))
  for (const z of ranked) if (z.sku && z.goods !== false && !owner.has(z.sku)) owner.set(z.sku, z.zoho_item_id)

  const end = await walk(theirs, (z) => z.zoho_item_id, after, deadline, async (z) => {
    const ref = z.sku || z.name || z.zoho_item_id
    if (z.goods === false) return skip(result, ref, 'A service, not a stock item.')
    if (!z.sku) return skip(result, ref, 'No SKU in Zoho. Add one there; the app matches items by SKU.')
    if (z.sku.includes('|')) return skip(result, ref, 'The SKU contains "|", which the app cannot use.')
    if (owner.get(z.sku) !== z.zoho_item_id) return skip(result, ref, 'Another Zoho item has the same SKU.')
    const linked = byZohoId.get(z.zoho_item_id)
    if (linked && linked.sku !== z.sku) return skip(result, ref, `The SKU changed in Zoho from ${linked.sku} to ${z.sku}; the app still uses ${linked.sku}.`)
    const current = bySku.get(z.sku)
    if (!current && !z.active) return skip(result, ref, 'Inactive in Zoho.')
    const next = fill(
      current ? { ...current } : { sku: z.sku, name: '', category: '', subcategory: '', barcode: '', cost: 0, price: 0, zoho_item_id: '' },
      {
        name: z.name, category: z.category, barcode: z.barcode, zoho_item_id: z.zoho_item_id,
        cost: z.cost === undefined ? undefined : round2(z.cost),
        price: z.price === undefined ? undefined : round2(z.price),
      },
    )
    if (!next.name) return skip(result, ref, 'No name in Zoho.')
    await save(store, 'items', current, next, result, ref)
  })
  return { ...result, ...end }
}

// ---------- vendors ----------

async function pullVendors(store, zoho, { after = '', budgetMs = BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs
  const theirs = await zoho.listVendors()
  const result = { ...newResult('vendors', zoho.mode), fetched: theirs.length }
  const ours = await store.list('vendors')
  const byZohoId = new Map(ours.filter((v) => v.zoho_vendor_id).map((v) => [v.zoho_vendor_id, v]))
  // A vendor typed into the app before it was linked is matched by name, once.
  const unlinked = new Map(ours.filter((v) => !v.zoho_vendor_id).map((v) => [v.name.trim().toLowerCase(), v]))
  let last = ours.reduce((m, v) => Math.max(m, Number(String(v.vendor_code).split('-')[1]) || 0), 0)

  const end = await walk(theirs, (z) => z.zoho_vendor_id, after, deadline, async (z) => {
    if (!z.name) return skip(result, z.zoho_vendor_id, 'No name in Zoho.')
    let current = byZohoId.get(z.zoho_vendor_id)
    if (!current) {
      current = unlinked.get(z.name.toLowerCase())
      unlinked.delete(z.name.toLowerCase())
    }
    if (!current && !z.active) return skip(result, z.name, 'Inactive in Zoho.')
    const next = fill(
      current ? { ...current } : { vendor_code: `V-${String(++last).padStart(3, '0')}`, name: '', contact: '', phone: '', email: '', gstin: '', zoho_vendor_id: '', active: true },
      { name: z.name, contact: z.contact, phone: z.phone, email: z.email, gstin: z.gstin, zoho_vendor_id: z.zoho_vendor_id, active: z.active },
    )
    await save(store, 'vendors', current, next, result, z.name)
  })
  return { ...result, ...end }
}

// ---------- head-office batches ----------

// What the app has moved that Zoho has not been told about yet, per batch.
async function notYetInZoho(store) {
  const out = new Map() // sent to machines
  const received = new Map() // received from suppliers
  const add = (map, l) => map.set(batchKey(l.sku, l.batch_no), (map.get(batchKey(l.sku, l.batch_no)) || 0) + l.qty)
  for (const t of await store.list('transfers')) if (t.zoho_sync !== 'synced') t.lines.forEach((l) => add(out, l))
  for (const po of await store.list('purchase_orders')) {
    if (po.status === 'received' && po.zoho_receipt_sync !== 'synced') po.receipts.forEach((r) => add(received, r))
  }
  return { out, received }
}

// App quantity = Zoho head-office quantity, less transfers and plus receipts that Zoho does not have yet.
async function pullBatches(store, zoho, { after = '', budgetMs = BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs
  const result = newResult('batches', zoho.mode)
  const items = (await store.list('items')).filter((i) => i.zoho_item_id)
  if (items.length === 0) return { ...result, stopped: 'No items are linked to Zoho yet. Fetch items first.' }
  const ours = await store.list('batches')

  const end = await walk(items, (i) => i.sku, after, deadline, async (item) => {
    const theirs = await zoho.listBatches([item])
    result.fetched += theirs.length
    const waiting = await notYetInZoho(store)
    const count = new Map()
    for (const z of theirs) count.set(z.batch_no, (count.get(z.batch_no) || 0) + 1)
    const seen = new Set()
    for (const z of theirs) {
      const key = batchKey(item.sku, z.batch_no)
      if (seen.has(key)) continue
      seen.add(key)
      if (!z.batch_no || z.batch_no.includes('|')) { skip(result, key, 'The batch number is empty or contains "|".'); continue }
      if (count.get(z.batch_no) > 1) { skip(result, key, 'Zoho has more than one batch with this number; left as it is.'); continue }
      if (!Number.isInteger(z.qty) || z.qty < 0) { skip(result, key, `Zoho quantity "${z.qty}" is not a whole number, 0 or more.`); continue }
      const qty = z.qty - (waiting.out.get(key) || 0) + (waiting.received.get(key) || 0)
      if (qty < 0) { skip(result, key, 'Zoho shows less than the transfers still waiting to be sent; left as it is.'); continue }
      const current = await store.get('batches', key)
      if (!current && qty === 0) continue // an empty batch we never held
      const expiry = /^\d{4}-\d{2}-\d{2}$/.test(z.expiry) ? z.expiry : current?.expiry || ''
      const next = { batch_key: key, sku: item.sku, batch_no: z.batch_no, expiry, qty, zoho_batch_id: z.batch_id || current?.zoho_batch_id || '' }
      await save(store, 'batches', current, next, result, key)
    }
    for (const b of ours) {
      if (b.sku === item.sku && b.qty > 0 && !seen.has(b.batch_key) && !waiting.received.has(b.batch_key)) {
        skip(result, b.batch_key, 'In the app but not in Zoho; left as it is.')
      }
    }
  })
  return { ...result, ...end }
}

module.exports = { pullItems, pullVendors, pullBatches }
