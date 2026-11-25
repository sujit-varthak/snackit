'use strict'
// Advanced I/O function entry. The data store is chosen by the STORE setting:
//   memory (default): local demo data, lost on restart.
//   catalyst: the Catalyst Data Store tables (docs/catalyst-database.md). Runs inside Catalyst.
// Zoho is simulated unless ZOHO_MODE=live (see src/zoho). The simulated Zoho keeps its state in memory, so use live Zoho in Catalyst.
const express = require('express')
const { createApp } = require('./src/app')
const { createZoho } = require('./src/zoho')
const seed = require('./src/seed')

const zoho = createZoho(process.env, { batches: seed.batches })

if (process.env.STORE === 'catalyst') {
  const catalyst = require('zcatalyst-sdk-node')
  const { createCatalystStore } = require('./src/store/catalyst')
  const { createSdkClient } = require('./src/store/catalyst-sdk')
  const { createContextStore } = require('./src/store/context')

  const ctx = createContextStore()
  const app = createApp({ store: ctx.store, zoho })
  const outer = express()
  // Each request gets its own Catalyst client; the shared `store` object above always uses the current request's.
  outer.use((req, res, next) => ctx.run(createCatalystStore(createSdkClient(catalyst.initialize(req))), next))
  outer.use(app)
  module.exports = outer
} else {
  const { createMemoryStore } = require('./src/store/memory')
  module.exports = createApp({ store: createMemoryStore({ initial: seed }), zoho })
}
