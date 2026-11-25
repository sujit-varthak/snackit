'use strict'
// Local development server: node server.js, then http://localhost:3100/health
const { createApp } = require('./src/app')
const { createMemoryStore } = require('./src/store/memory')
const path = require('node:path')

const { createZoho } = require('./src/zoho')
const seed = require('./src/seed')

const store = createMemoryStore({ initial: seed, file: path.join(__dirname, '.local-data.json') })
// Zoho is simulated unless ZOHO_MODE=live and the credentials are set. The simulated Zoho starts from the same head-office batches.
const zoho = createZoho(process.env, { batches: seed.batches })
console.log(`Zoho mode: ${zoho.mode}`)
const port = Number(process.env.PORT) || 3100
createApp({ store, zoho }).listen(port, () => console.log(`snackit_api listening on http://localhost:${port}`))
