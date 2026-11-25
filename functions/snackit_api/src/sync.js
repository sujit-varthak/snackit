'use strict'
const { AppError } = require('./errors')
const { batchKey } = require('./schema')

// Save first, send second. Every function here is safe to call again: a failure is stored on the order
// with its reason, and a retry never creates a second order or adds stock twice in Zoho.

async function syncPurchaseOrder(store, zoho, poNo) {
  const po = await store.get('purchase_orders', poNo)
  if (!po) throw new AppError('NOT_FOUND', `Purchase order ${poNo} not found.`)
  if (po.zoho_sync === 'synced') return po
  try {
    const vendor = await store.get('vendors', po.vendor_code)
    const v = await zoho.ensureVendor(vendor)
    if (v.vendor_id !== vendor.zoho_vendor_id) await store.put('vendors', { ...vendor, zoho_vendor_id: v.vendor_id })
    const r = await zoho.createPurchaseOrder({ po, vendor: { ...vendor, zoho_vendor_id: v.vendor_id } })
    const done = { ...po, zoho_sync: 'synced', zoho_id: r.purchaseorder_id, zoho_lines: r.line_ids || [], zoho_error: '' }
    await store.put('purchase_orders', done)
    return done
  } catch (e) {
    const failed = { ...po, zoho_sync: 'failed', zoho_error: e.message }
    await store.put('purchase_orders', failed)
    return failed
  }
}

async function syncReceipt(store, zoho, poNo) {
  let po = await store.get('purchase_orders', poNo)
  if (!po) throw new AppError('NOT_FOUND', `Purchase order ${poNo} not found.`)
  if (po.status !== 'received') throw new AppError('INVALID_INPUT', `Purchase order ${poNo} has not been received yet.`)
  if (po.zoho_receipt_sync === 'synced') return po
  if (po.zoho_sync !== 'synced') {
    po = await syncPurchaseOrder(store, zoho, poNo) // the order must exist in Zoho before it can be received
    if (po.zoho_sync !== 'synced') {
      const failed = { ...po, zoho_receipt_sync: 'failed', zoho_receipt_error: 'The purchase order is not in Zoho yet: ' + po.zoho_error }
      await store.put('purchase_orders', failed)
      return failed
    }
  }
  try {
    const r = await zoho.receivePurchaseOrder({ po, receipts: po.receipts })
    for (const b of r.batches || []) {
      const batch = await store.get('batches', batchKey(b.sku, b.batch_no))
      if (batch && batch.zoho_batch_id !== b.batch_id) await store.put('batches', { ...batch, zoho_batch_id: b.batch_id })
    }
    const done = { ...po, zoho_receipt_sync: 'synced', zoho_receipt_id: r.receive_id || '', zoho_receipt_error: '' }
    await store.put('purchase_orders', done)
    return done
  } catch (e) {
    const failed = { ...po, zoho_receipt_sync: 'failed', zoho_receipt_error: e.message }
    await store.put('purchase_orders', failed)
    return failed
  }
}

// Sends whatever is still waiting for this order: the order itself, then its receipt if it was received.
async function syncAll(store, zoho, poNo) {
  let po = await syncPurchaseOrder(store, zoho, poNo)
  if (po.status === 'received') po = await syncReceipt(store, zoho, poNo)
  return po
}

// Head-office stock as the app holds it, next to what Zoho reports.
// A transfer that is not yet in Zoho lowers the app but not Zoho, so that difference is explained.
async function headOfficeComparison(store, zoho) {
  const base = { mode: zoho.mode, fetched_at: new Date().toISOString() }
  let theirs
  try {
    theirs = await zoho.listBatches()
  } catch (e) {
    return { ...base, ok: false, error: e.message, rows: [] }
  }
  const ours = await store.list('batches')
  const pending = new Map()
  for (const t of await store.list('transfers')) {
    if (t.zoho_sync === 'synced') continue
    for (const l of t.lines) pending.set(batchKey(l.sku, l.batch_no), (pending.get(batchKey(l.sku, l.batch_no)) || 0) + l.qty)
  }
  const keys = new Set([...ours.map((b) => b.batch_key), ...theirs.map((b) => batchKey(b.sku, b.batch_no))])
  const rows = [...keys].sort().map((k) => {
    const a = ours.find((b) => b.batch_key === k)
    const z = theirs.find((b) => batchKey(b.sku, b.batch_no) === k)
    const appQty = a ? a.qty : 0
    const zQty = z ? z.qty : 0
    const diff = appQty - zQty
    const waiting = pending.get(k) || 0
    let status = 'match'
    let why = ''
    if (!a) { status = 'check'; why = 'In Zoho only' }
    else if (!z) { status = 'check'; why = 'Not in Zoho yet' }
    else if (diff !== 0) {
      if (diff === -waiting) { status = 'explained'; why = 'Transfers not yet sent to Zoho' }
      else { status = 'check'; why = 'Unexplained difference' }
    }
    return { batch_key: k, sku: (a || z).sku, batch_no: (a || z).batch_no, expiry: (a || z).expiry || '', app_qty: appQty, zoho_qty: zQty, diff, status, why }
  })
  return { ...base, ok: true, rows }
}

module.exports = { syncPurchaseOrder, syncReceipt, syncAll, headOfficeComparison }
