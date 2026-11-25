'use strict'
const { AppError } = require('../errors')

// Real Zoho client. NOT YET RUN against a Zoho organisation: it follows Zoho's API pages as summarised
// (docs/data-contract.md section 6). Every VERIFY comment marks something to check on first connection;
// `npm run zoho:check` makes the read calls and shows what Zoho really answers, without writing anything.
// Books (/books/v3): items, contacts, locations, purchase orders. Inventory (/inventory/v1): batches, purchase receives.
const REQUIRED = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID']
const PER_PAGE = 200
const MAX_PAGES = 50

const text = (v) => (v === undefined || v === null ? '' : String(v).trim())
const number = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createLiveZoho(env, { fetch: send = globalThis.fetch, retryMs = 2000, onResponse } = {}) {
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
    // The secrets go in the request body, not the address, so they do not end up in request logs.
    const res = await send(`${accounts}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, refresh_token: env.ZOHO_REFRESH_TOKEN,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) throw new AppError('ZOHO_ERROR', `Zoho sign-in failed: ${data.error || res.status}. An admin needs to reconnect Zoho.`)
    token = data.access_token
    expires = Date.now() + (Number(data.expires_in) || 3600) * 1000
    return token
  }

  async function call(base, org, method, path, { query = {}, body } = {}) {
    const q = new URLSearchParams({ organization_id: org, ...query })
    let res
    for (let attempt = 0; ; attempt++) {
      try {
        res = await send(`${base}${path}?${q}`, {
          method,
          headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}`, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), // VERIFY: Zoho may expect the body as a JSONString form field
          signal: AbortSignal.timeout(15000),
        })
      } catch (e) {
        if (e instanceof AppError) throw e
        throw new AppError('ZOHO_ERROR', 'Cannot reach Zoho.')
      }
      // Over the call limit: wait and try a read again, twice. A write is left for the person to retry.
      if (res.status !== 429 || method !== 'GET' || attempt >= 2) break
      await sleep(retryMs * (attempt + 1))
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 429) throw new AppError('ZOHO_ERROR', 'Zoho call limit reached. Try again in a minute.')
    if (!res.ok || (data.code !== undefined && data.code !== 0)) throw new AppError('ZOHO_ERROR', `Zoho refused the request: ${data.message || res.status}`, { zoho: data })
    onResponse?.(path, data)
    return data
  }

  const bk = (m, p, o) => call(books, orgId, m, p, o)
  const inv = (m, p, o) => call(inventory, invOrgId, m, p, o)

  // Every row of a list, page by page. An answer without the expected list is an error, never an empty result.
  async function list(request, path, key, query = {}) {
    const out = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const d = await request('GET', path, { query: { ...query, page, per_page: PER_PAGE } })
      if (!Array.isArray(d[key])) throw new AppError('ZOHO_ERROR', `Zoho answered ${path} without a "${key}" list.`)
      out.push(...d[key])
      if (!d.page_context?.has_more_page) return out
    }
    throw new AppError('ZOHO_ERROR', `Zoho has more than ${MAX_PAGES * PER_PAGE} rows at ${path}; the page limit needs raising.`)
  }

  async function listItems() {
    // VERIFY: Zoho's current Books page documents this list as /itemmasters; /items is what the data contract names.
    const rows = await list(bk, '/items', 'items')
    return rows.map((i) => ({
      zoho_item_id: text(i.item_id),
      sku: text(i.sku),
      name: text(i.name || i.item_name),
      category: text(i.category_name),
      barcode: text(i.ean || i.upc),
      cost: number(i.purchase_rate),
      price: number(i.rate),
      active: i.status !== 'inactive',
      goods: i.product_type !== 'service',
    }))
  }

  async function listVendors() {
    const rows = await list(bk, '/contacts', 'contacts', { contact_type: 'vendor' })
    return rows.filter((c) => !c.contact_type || c.contact_type === 'vendor').map((c) => ({
      zoho_vendor_id: text(c.contact_id),
      name: text(c.contact_name),
      contact: [c.first_name, c.last_name].map(text).filter(Boolean).join(' '),
      phone: text(c.phone || c.mobile),
      email: text(c.email),
      gstin: text(c.gst_no), // VERIFY: the list may not carry gst_no; the single-contact call does
      active: c.status !== 'inactive',
    }))
  }

  async function listLocations() {
    const rows = await list(bk, '/locations', 'locations')
    return rows.map((l) => ({ location_id: text(l.location_id), name: text(l.location_name), primary: !!l.is_primary }))
  }

  // Head-office stock must not include what already sits at the Vending Machine location.
  // Returns '' when the organisation has at most one location, so a batch's total is the head-office quantity.
  let headOffice
  async function headOfficeId() {
    if (env.ZOHO_HEAD_OFFICE_LOCATION_ID) return env.ZOHO_HEAD_OFFICE_LOCATION_ID
    if (headOffice !== undefined) return headOffice
    const locations = await listLocations()
    if (locations.length <= 1) return (headOffice = '')
    const wanted = text(env.ZOHO_HEAD_OFFICE_NAME || 'Head Office').toLowerCase()
    const hit = locations.find((l) => l.name.toLowerCase() === wanted)
    if (!hit) {
      throw new AppError('ZOHO_ERROR', `Cannot tell which Zoho location is head office. Set ZOHO_HEAD_OFFICE_LOCATION_ID to one of: ${locations.map((l) => `${l.name} (${l.location_id})`).join(', ')}.`)
    }
    return (headOffice = hit.location_id)
  }

  function quantityAt(batch, locationId) {
    if (!locationId) return Number(batch.balance_quantity)
    if (Array.isArray(batch.associated_locations) && batch.associated_locations.length) {
      const here = batch.associated_locations.find((l) => text(l.location_id) === locationId)
      return here ? Number(here.balance_quantity) : 0
    }
    if (batch.location_id) return text(batch.location_id) === locationId ? Number(batch.balance_quantity) : 0
    throw new AppError('ZOHO_ERROR', `Zoho did not say which location batch ${batch.batch_number} is in, so the head-office quantity cannot be worked out.`)
  }

  async function itemIdsBySku() {
    return new Map((await listItems()).filter((i) => i.sku).map((i) => [i.sku, i.zoho_item_id]))
  }

  // Head-office batches. Pass items ({ sku, zoho_item_id }) to read only those; Zoho needs one call or more per item.
  async function listBatches(items) {
    const wanted = items ? items.map((i) => [i.sku, i.zoho_item_id]) : [...(await itemIdsBySku())]
    const locationId = await headOfficeId()
    const out = []
    for (const [sku, itemId] of wanted) {
      const rows = await list(inv, '/items/batches', 'batches', { item_id: itemId, include_empty_batches: true })
      for (const b of rows) {
        out.push({ sku, batch_no: text(b.batch_number), expiry: text(b.expiry_date), qty: quantityAt(b, locationId), batch_id: text(b.batch_id) })
      }
    }
    return out
  }

  return {
    mode: 'live',
    setDown() { throw new AppError('INVALID_INPUT', 'Cannot simulate an outage against live Zoho.') },
    isDown: () => false,
    async ping() { await bk('GET', '/organizations'); return true },
    listItems,
    listVendors,
    listLocations,
    headOfficeId,
    listBatches,

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
      // VERIFY: the receive response must expose batch ids; if not, read them with listBatches() above.
      const rec = d.purchase_receive || {}
      const batches = (rec.batches || []).map((b) => ({ sku: receipts[0]?.sku, batch_no: b.batch_number, batch_id: b.batch_id }))
      return { receive_id: rec.receive_id, batches }
    },
  }
}

module.exports = { createLiveZoho }
