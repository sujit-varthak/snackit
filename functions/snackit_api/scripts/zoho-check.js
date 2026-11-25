'use strict'
// First-connection check: npm run zoho:check
// Reads from the real Zoho and prints what came back. It changes nothing, in Zoho or in our data, and prints no secrets.
const { loadLocalSettings } = require('./local-env')
const { createLiveZoho } = require('../src/zoho/live')

async function main() {
  loadLocalSettings()
  const fields = new Map() // list name -> field names Zoho sent on the first row
  const zoho = createLiveZoho(process.env, {
    onResponse(_path, data) {
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value) && value[0] && typeof value[0] === 'object' && !fields.has(key)) fields.set(key, Object.keys(value[0]))
      }
    },
  })

  let failed = 0
  const step = async (name, fn) => {
    try {
      console.log(`OK    ${name}: ${await fn()}`)
    } catch (e) {
      failed++
      console.log(`FAIL  ${name}: ${e.message}`)
    }
  }
  const count = (rows, test) => rows.filter(test).length

  await step('Sign in and organisation', async () => { await zoho.ping(); return 'reachable' })
  await step('Locations', async () => (await zoho.listLocations()).map((l) => `${l.name} (${l.location_id})`).join(', ') || 'none')
  await step('Head-office location', async () => (await zoho.headOfficeId()) || 'one location only, totals are used')
  let items = []
  await step('Items', async () => {
    items = await zoho.listItems()
    return `${items.length} found, ${count(items, (i) => i.active)} active, ${count(items, (i) => !i.sku)} without SKU, ${count(items, (i) => i.category)} with a category, ${count(items, (i) => i.cost > 0)} with a cost`
  })
  await step('Vendors', async () => {
    const v = await zoho.listVendors()
    return `${v.length} found, ${count(v, (x) => x.gstin)} with GSTIN`
  })
  const sample = items.filter((i) => i.sku && i.active && i.goods).slice(0, 3)
  await step(`Batches of the first ${sample.length} items`, async () => {
    if (!sample.length) return 'no item with a SKU to try'
    const b = await zoho.listBatches(sample)
    return b.length ? b.map((x) => `${x.sku} ${x.batch_no}: ${x.qty} at head office, expires ${x.expiry || 'not set'}`).join('; ') : 'none returned'
  })

  console.log('\nField names Zoho sent (to compare with src/zoho/live.js):')
  for (const [key, names] of fields) console.log(`  ${key}: ${names.join(', ')}`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
