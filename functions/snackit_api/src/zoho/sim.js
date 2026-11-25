'use strict'
const { AppError } = require('../errors')

// Simulated Zoho. Behaves like the real thing for the calls we make: it holds items, vendors and head-office batches,
// keeps purchase orders and receipts, refuses duplicates, and can be switched to "unreachable".
// Used until real Zoho credentials exist, and in tests.
function createSimZoho({ batches = [], items = [], vendors = [] } = {}) {
  let down = false
  let next = 1000
  const id = (p) => `${p}${next++}`
  const orders = new Map() // po_no -> { purchaseorder_id, line_ids }
  const receives = new Map() // po_no -> { receive_id, batches }
  const itemList = items.map((i, n) => ({
    zoho_item_id: `SIM-I-${n + 1}`, sku: i.sku, name: i.name, category: i.category, barcode: i.barcode, cost: i.cost, price: i.price, active: true, goods: true,
  }))
  const vendorList = new Map() // vendor_id -> vendor as Zoho holds it
  vendors.forEach((v, n) => {
    const vendorId = `SIM-V-${n + 1}`
    vendorList.set(vendorId, { zoho_vendor_id: vendorId, name: v.name, contact: v.contact, phone: v.phone, email: v.email, gstin: v.gstin, active: true })
  })
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
    async listItems() {
      guard()
      return itemList.map((i) => ({ ...i }))
    },
    async listVendors() {
      guard()
      return [...vendorList.values()].map((v) => ({ ...v }))
    },
    async ensureVendor(vendor) {
      guard()
      if (vendor.zoho_vendor_id) return { vendor_id: vendor.zoho_vendor_id }
      const found = [...vendorList.values()].find((v) => v.name === vendor.name)
      if (found) return { vendor_id: found.zoho_vendor_id }
      const vendorId = id('V')
      vendorList.set(vendorId, { zoho_vendor_id: vendorId, name: vendor.name, contact: vendor.contact || '', phone: vendor.phone || '', email: vendor.email || '', gstin: vendor.gstin || '', active: true })
      return { vendor_id: vendorId }
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
    // Head-office batches as Zoho holds them; pass items to read only those.
    async listBatches(wanted) {
      guard()
      const skus = wanted && new Set(wanted.map((i) => i.sku))
      return [...stock.values()].filter((b) => !skus || skus.has(b.sku)).map((b) => ({ ...b }))
    },
  }
}

module.exports = { createSimZoho }
