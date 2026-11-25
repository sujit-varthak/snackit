'use strict'
const { AppError } = require('../errors')

// Real Zoho client. NOT TESTED against a Zoho organisation yet: it follows Zoho's API pages as summarised
// (docs/data-contract.md section 6). Every VERIFY comment marks something to check on first connection.
// Books (/books/v3): items, contacts, purchase orders. Inventory (/inventory/v1): purchase receives, batches.
const REQUIRED = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID']

function createLiveZoho(env) {
  const missing = REQUIRED.filter((k) => !env[k])
  if (missing.length) throw new Error(`Zoho live mode needs these settings: ${missing.join(', ')}. Use ZOHO_MODE=sim until they exist.`)

  const dc = env.ZOHO_DC || 'in' // data centre: in, com, eu, ...
  const accounts = `https://accounts.zoho.${dc}`
  const books = `https://www.zohoapis.${dc}/books/v3`
  const inventory = `https://www.zohoapis.${dc}/inventory/v1` // VERIFY the Inventory domain for this data centre
  const orgId = env.ZOHO_ORG_ID // VERIFY whether Books and Inventory use the same organisation id
  const invOrgId = env.ZOHO_INVENTORY_ORG_ID || orgId

  let token = null
  let expires = 0
  async function accessToken() {
    if (token && Date.now() < expires - 60000) return token
    const url = `${accounts}/oauth/v2/token?refresh_token=${encodeURIComponent(env.ZOHO_REFRESH_TOKEN)}&client_id=${encodeURIComponent(env.ZOHO_CLIENT_ID)}&client_secret=${encodeURIComponent(env.ZOHO_CLIENT_SECRET)}&grant_type=refresh_token`
    const res = await fetch(url, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) throw new AppError('ZOHO_ERROR', `Zoho sign-in failed: ${data.error || res.status}. An admin needs to reconnect Zoho.`)
    token = data.access_token
    expires = Date.now() + (Number(data.expires_in) || 3600) * 1000 // VERIFY token lifetime on the OAuth page
    return token
  }

  async function call(base, org, method, path, { query = {}, body } = {}) {
    const q = new URLSearchParams({ organization_id: org, ...query })
    let res
    try {
      res = await fetch(`${base}${path}?${q}`, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), // VERIFY: Zoho may expect the body as a JSONString form field
      })
    } catch (e) {
      if (e instanceof AppError) throw e
      throw new AppError('ZOHO_ERROR', 'Cannot reach Zoho.')
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 429) throw new AppError('ZOHO_ERROR', 'Zoho call limit reached. It will be retried.')
    if (!res.ok || (data.code !== undefined && data.code !== 0)) throw new AppError('ZOHO_ERROR', `Zoho refused the request: ${data.message || res.status}`, { zoho: data })
    return data
  }

  const bk = (m, p, o) => call(books, orgId, m, p, o)
  const inv = (m, p, o) => call(inventory, invOrgId, m, p, o)

  async function itemIdsBySku() {
    const out = new Map()
    for (let page = 1; page <= 20; page++) {
      const d = await bk('GET', '/items', { query: { page, per_page: 200 } })
      for (const i of d.items || []) if (i.sku) out.set(i.sku, i.item_id)
      if (!d.page_context?.has_more_page) break
    }
    return out
  }

  return {
    mode: 'live',
    setDown() { throw new AppError('INVALID_INPUT', 'Cannot simulate an outage against live Zoho.') },
    isDown: () => false,
    async ping() { await bk('GET', '/organizations'); return true },

    // Find the supplier by name, or create it.
    async ensureVendor(vendor) {
      if (vendor.zoho_vendor_id) return { vendor_id: vendor.zoho_vendor_id }
      const found = await bk('GET', '/contacts', { query: { contact_name: vendor.name, contact_type: 'vendor' } })
      const hit = (found.contacts || []).find((c) => c.contact_name === vendor.name)
      if (hit) return { vendor_id: hit.contact_id }
      const made = await bk('POST', '/contacts', { body: { contact_name: vendor.name, contact_type: 'vendor', gst_no: vendor.gstin || undefined } })
      return { vendor_id: made.contact.contact_id }
    },

    async createPurchaseOrder({ po, vendor }) {
      // The order number goes in reference_number so a retry can find the order instead of creating a second one.
      const existing = await bk('GET', '/purchaseorders', { query: { reference_number: po.po_no } })
      const hit = (existing.purchaseorders || []).find((o) => o.reference_number === po.po_no)
      const items = await itemIdsBySku()
      const unknown = po.lines.filter((l) => !items.has(l.sku)).map((l) => l.sku)
      if (unknown.length) throw new AppError('ZOHO_ERROR', `These items do not exist in Zoho (match by SKU): ${unknown.join(', ')}`)
      const body = {
        vendor_id: vendor.zoho_vendor_id,
        reference_number: po.po_no,
        line_items: po.lines.map((l) => ({ item_id: items.get(l.sku), rate: l.rate, quantity: l.qty })),
      }
      const d = hit ? await bk('GET', `/purchaseorders/${hit.purchaseorder_id}`) : await bk('POST', '/purchaseorders', { body })
      const order = d.purchaseorder
      // Zoho returns the lines in the order sent; pair them with our SKUs.
      return { purchaseorder_id: order.purchaseorder_id, line_ids: (order.line_items || []).map((li, i) => ({ sku: po.lines[i]?.sku, line_item_id: li.line_item_id })) }
    },

    async receivePurchaseOrder({ po, receipts }) {
      const body = {
        date: new Date().toISOString().slice(0, 10),
        status: 'received',
        reference_number: po.po_no,
        line_items: (po.zoho_lines || []).map((zl) => ({
          line_item_id: zl.line_item_id,
          quantity: receipts.filter((r) => r.sku === zl.sku).reduce((s, r) => s + r.qty, 0),
          batches: receipts.filter((r) => r.sku === zl.sku).map((r) => ({ batch_number: r.batch_no, quantity_in: r.qty, expiry_date: r.expiry })),
        })),
      }
      const d = await inv('POST', '/purchasereceives', { query: { purchaseorder_id: po.zoho_id }, body })
      // VERIFY: the receive response must expose batch ids; if not, read them with listBatches() below.
      const rec = d.purchase_receive || {}
      const batches = (rec.batches || []).map((b) => ({ sku: receipts[0]?.sku, batch_no: b.batch_number, batch_id: b.batch_id }))
      return { receive_id: rec.receive_id, batches }
    },

    async listBatches() {
      const items = await itemIdsBySku()
      const out = []
      for (const [sku, itemId] of items) {
        const d = await inv('GET', '/items/batches', { query: { item_id: itemId } })
        for (const b of d.batches || []) out.push({ sku, batch_no: b.batch_number, expiry: b.expiry_date, qty: b.balance_quantity, batch_id: b.batch_id })
      }
      return out
    },
  }
}

module.exports = { createLiveZoho }
