'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createLiveZoho } = require('../src/zoho/live')

// The live client against canned answers. The answers follow Zoho's documented field names, so this checks our code,
// not Zoho: `npm run zoho:check` is the check against the real organisation.
const env = { ZOHO_CLIENT_ID: 'id', ZOHO_CLIENT_SECRET: 'the-secret', ZOHO_REFRESH_TOKEN: 'the-refresh', ZOHO_ORG_ID: '60000000001' }
const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })

function fakeZoho(routes) {
  const calls = []
  const send = async (url, options) => {
    const u = new URL(url)
    calls.push({ url: u, options })
    if (u.pathname === '/oauth/v2/token') return reply({ access_token: 'token-1', expires_in: 3600 })
    const handler = routes[u.pathname]
    if (!handler) return reply({ code: 5, message: `no such path ${u.pathname}` }, 404)
    return handler(u)
  }
  return { calls, zoho: createLiveZoho(env, { fetch: send, retryMs: 0 }) }
}
const ok = (key, rows, more = false) => reply({ code: 0, [key]: rows, page_context: { has_more_page: more } })

test('the secrets are sent in the request body, never in the address', async () => {
  const { zoho, calls } = fakeZoho({ '/books/v3/organizations': () => ok('organizations', []) })
  await zoho.ping()
  await zoho.ping()
  const signIns = calls.filter((c) => c.url.pathname === '/oauth/v2/token')
  assert.equal(signIns.length, 1) // the token is reused
  assert.equal(signIns[0].url.href, 'https://accounts.zoho.in/oauth/v2/token')
  assert.match(String(signIns[0].options.body), /client_secret=the-secret/)
  assert.ok(calls.every((c) => !c.url.href.includes('the-secret') && !c.url.href.includes('the-refresh')))
  assert.equal(calls[1].url.searchParams.get('organization_id'), '60000000001')
  assert.equal(calls[1].options.headers.Authorization, 'Zoho-oauthtoken token-1')
})

test('items are read page by page and mapped to our names', async () => {
  const { zoho } = fakeZoho({
    '/books/v3/items': (u) => (u.searchParams.get('page') === '1'
      ? ok('items', [{ item_id: 1, sku: 'A', name: 'Alpha', rate: 20, purchase_rate: 14, status: 'active', product_type: 'goods', ean: 8901 }], true)
      : ok('items', [{ item_id: '2', name: 'Beta', status: 'inactive', product_type: 'service' }])),
  })
  const [a, b] = await zoho.listItems()
  assert.deepEqual(a, { zoho_item_id: '1', sku: 'A', name: 'Alpha', category: '', barcode: '8901', cost: 14, price: 20, active: true, goods: true })
  assert.deepEqual([b.sku, b.cost, b.price, b.active, b.goods], ['', undefined, undefined, false, false])
})

test('vendors are asked for as vendors and mapped', async () => {
  const { zoho, calls } = fakeZoho({ '/books/v3/contacts': () => ok('contacts', [{ contact_id: 7, contact_name: 'Acme', contact_type: 'vendor', first_name: 'Asha', last_name: 'K', mobile: '98', status: 'active' }, { contact_id: 8, contact_name: 'Buyer', contact_type: 'customer' }]) })
  const vendors = await zoho.listVendors()
  assert.equal(calls.at(-1).url.searchParams.get('contact_type'), 'vendor')
  assert.deepEqual(vendors, [{ zoho_vendor_id: '7', name: 'Acme', contact: 'Asha K', phone: '98', email: '', gstin: '', active: true }])
})

test('head-office quantity leaves out stock at the other location', async () => {
  const { zoho, calls } = fakeZoho({
    '/books/v3/locations': () => ok('locations', [{ location_id: 'L1', location_name: 'Head Office', is_primary: true }, { location_id: 'L2', location_name: 'Vending Machine' }]),
    '/inventory/v1/items/batches': () => ok('batches', [
      { batch_id: 'b1', batch_number: 'N1', expiry_date: '2027-01-01', balance_quantity: 100, associated_locations: [{ location_id: 'L1', balance_quantity: 60 }, { location_id: 'L2', balance_quantity: 40 }] },
      { batch_id: 'b2', batch_number: 'N2', balance_quantity: 5, associated_locations: [{ location_id: 'L2', balance_quantity: 5 }] },
    ]),
  })
  const batches = await zoho.listBatches([{ sku: 'A', zoho_item_id: '1' }])
  assert.deepEqual(batches.map((b) => [b.batch_no, b.qty, b.batch_id]), [['N1', 60, 'b1'], ['N2', 0, 'b2']])
  const asked = calls.at(-1).url.searchParams
  assert.equal(asked.get('item_id'), '1')
  assert.equal(asked.get('include_empty_batches'), 'true')
})

test('when head office cannot be told apart, nothing is guessed', async () => {
  const two = () => ok('locations', [{ location_id: 'L1', location_name: 'Main' }, { location_id: 'L2', location_name: 'Vending Machine' }])
  await assert.rejects(fakeZoho({ '/books/v3/locations': two }).zoho.listBatches([{ sku: 'A', zoho_item_id: '1' }]), /ZOHO_HEAD_OFFICE_LOCATION_ID.*Main \(L1\)/)
  const noPlace = fakeZoho({
    '/books/v3/locations': () => ok('locations', [{ location_id: 'L1', location_name: 'Head Office' }, { location_id: 'L2', location_name: 'Vending Machine' }]),
    '/inventory/v1/items/batches': () => ok('batches', [{ batch_number: 'N1', balance_quantity: 100 }]),
  })
  await assert.rejects(noPlace.zoho.listBatches([{ sku: 'A', zoho_item_id: '1' }]), /did not say which location/)
})

test('a read over the call limit is tried again; an answer without the list is an error', async () => {
  let n = 0
  const { zoho } = fakeZoho({ '/books/v3/items': () => (++n < 3 ? reply({}, 429) : ok('items', [])) })
  assert.deepEqual(await zoho.listItems(), [])
  assert.equal(n, 3)
  await assert.rejects(fakeZoho({ '/books/v3/items': () => reply({}, 429) }).zoho.listItems(), /call limit/)
  await assert.rejects(fakeZoho({ '/books/v3/items': () => reply({ code: 0, item_masters: [] }) }).zoho.listItems(), /without a "items" list/)
})
