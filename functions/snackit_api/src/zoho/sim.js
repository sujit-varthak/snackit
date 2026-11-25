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
  const transfers = new Map() // transfer_no -> { transfer_order_id, machine }
  const vending = new Map() // sku -> quantity at the Vending Machine location
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
    // Main warehouse to the one Vending Machine location. Zoho's head-office stock drops; the machine is only a label.
    async createTransferOrder({ transfer, lines }) {
      guard()
      if (transfers.has(transfer.transfer_no)) return transfers.get(transfer.transfer_no) // a retry never moves stock twice
      for (const l of lines) {
        const b = stock.get(`${l.sku}|${l.batch_no}`)
        if (!b) throw new AppError('ZOHO_ERROR', `Zoho has no batch ${l.batch_no} of ${l.sku} at the main warehouse.`)
        if (b.qty < l.qty) throw new AppError('ZOHO_ERROR', `Zoho's main warehouse holds ${b.qty} of ${l.sku} batch ${l.batch_no}, not ${l.qty}.`)
      }
      for (const l of lines) {
        stock.get(`${l.sku}|${l.batch_no}`).qty -= l.qty
        vending.set(l.sku, (vending.get(l.sku) || 0) + l.qty)
      }
      const rec = { transfer_order_id: id('TO'), machine: transfer.machine_code }
      transfers.set(transfer.transfer_no, rec)
      return rec
    },
    // What the one Vending Machine location holds, per item (test helper).
    vendingStock: () => Object.fromEntries(vending),
    // Head-office batches as Zoho holds them; pass items to read only those.
    async listBatches(wanted) {
      guard()
      const skus = wanted && new Set(wanted.map((i) => i.sku))
      return [...stock.values()].filter((b) => !skus || skus.has(b.sku)).map((b) => ({ ...b }))
    },
  }
}

module.exports = { createSimZoho }
