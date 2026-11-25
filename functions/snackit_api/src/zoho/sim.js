'use strict'
const { AppError } = require('../errors')

// Simulated Zoho. Behaves like the real thing for the calls we make: it keeps purchase orders,
// receipts and head-office batches, refuses duplicates, and can be switched to "unreachable".
// Used until real Zoho credentials exist, and in tests.
function createSimZoho({ batches = [] } = {}) {
  let down = false
  let next = 1000
  const id = (p) => `${p}${next++}`
  const orders = new Map() // po_no -> { purchaseorder_id, line_ids }
  const receives = new Map() // po_no -> { receive_id, batches }
  const vendors = new Map() // vendor_code -> vendor_id
  const stock = new Map() // sku|batch_no -> { sku, batch_no, expiry, qty, batch_id }
  for (const b of batches) stock.set(`${b.sku}|${b.batch_no}`, { sku: b.sku, batch_no: b.batch_no, expiry: b.expiry, qty: b.qty, batch_id: id('B') })

  const guard = () => {
    if (down) throw new AppError('ZOHO_ERROR', 'Zoho is unreachable (simulated). The order is saved here and can be retried.')
  }

  return {
    mode: 'simulated',
    setDown(v) { down = !!v },
    isDown: () => down,
    async ping() { guard(); return true },
    async ensureVendor(vendor) {
      guard()
      if (!vendors.has(vendor.vendor_code)) vendors.set(vendor.vendor_code, id('V'))
      return { vendor_id: vendors.get(vendor.vendor_code) }
    },
    // Lines are sku-based; the real client resolves Zoho item ids itself.
    async createPurchaseOrder({ po }) {
      guard()
      if (orders.has(po.po_no)) return orders.get(po.po_no) // the same order is never created twice
      const rec = { purchaseorder_id: id('PO'), line_ids: po.lines.map((l) => ({ sku: l.sku, line_item_id: id('L') })) }
      orders.set(po.po_no, rec)
      return rec
    },
    async receivePurchaseOrder({ po, receipts }) {
      guard()
      if (!orders.has(po.po_no)) throw new AppError('ZOHO_ERROR', `Purchase order ${po.po_no} does not exist in Zoho.`)
      if (receives.has(po.po_no)) return receives.get(po.po_no) // a retry never adds stock twice
      const out = []
      for (const r of receipts) {
        const k = `${r.sku}|${r.batch_no}`
        const cur = stock.get(k) || { sku: r.sku, batch_no: r.batch_no, expiry: r.expiry, qty: 0, batch_id: id('B') }
        cur.qty += r.qty
        stock.set(k, cur)
        out.push({ sku: r.sku, batch_no: r.batch_no, batch_id: cur.batch_id })
      }
      const rec = { receive_id: id('R'), batches: out }
      receives.set(po.po_no, rec)
      return rec
    },
    // Head-office batches as Zoho holds them.
    async listBatches() {
      guard()
      return [...stock.values()].map((b) => ({ ...b }))
    },
  }
}

module.exports = { createSimZoho }
