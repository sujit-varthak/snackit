'use strict'
const { createMemoryStore } = require('../src/store/memory')
const { createCatalystStore } = require('../src/store/catalyst')
const { createFakeCatalyst } = require('./fake-catalyst')

// STORE_TEST=catalyst runs the same tests against the Catalyst adapter (over the fake Catalyst) instead of the memory store.
const IMPL = process.env.STORE_TEST === 'catalyst' ? 'catalyst' : 'memory'
const ORDER = ['machines', 'items', 'vendors', 'batches', 'machine_stock', 'transfers', 'consumption_reports', 'purchase_orders', 'settings']

async function makeStore(seed) {
  const store = IMPL === 'catalyst' ? createCatalystStore(createFakeCatalyst()) : createMemoryStore()
  for (const table of ORDER) for (const row of seed[table] || []) await store.insert(table, row) // parents before children
  return store
}

module.exports = { makeStore, IMPL }
