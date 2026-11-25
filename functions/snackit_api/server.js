'use strict'
// Local development server: node server.js, then http://localhost:3100/health
const { createApp } = require('./src/app')
const { createMemoryStore } = require('./src/store/memory')
const { loadLocalSettings } = require('./scripts/local-env')
const path = require('node:path')

const { createZoho } = require('./src/zoho')
const seed = require('./src/seed')

loadLocalSettings()
// Zoho is simulated unless ZOHO_MODE=live and the credentials are set. The simulated Zoho starts from the demo data.
const zoho = createZoho(process.env, seed)
// With live Zoho the data goes in its own file and starts with the demo machines only, so real and demo stock never mix.
const live = zoho.mode === 'live'
const store = createMemoryStore({
  initial: live ? { machines: seed.machines } : seed,
  file: path.join(__dirname, live ? '.local-data.live.json' : '.local-data.json'),
})
console.log(`Zoho mode: ${zoho.mode}`)
const port = Number(process.env.PORT) || 3100
createApp({ store, zoho }).listen(port, () => console.log(`snackit_api listening on http://localhost:${port}`))
