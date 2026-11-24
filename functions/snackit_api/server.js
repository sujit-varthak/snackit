'use strict'
// Local development server: node server.js, then http://localhost:3100/health
const { createApp } = require('./src/app')
const { createMemoryStore } = require('./src/store/memory')
const path = require('node:path')

const store = createMemoryStore({ initial: require('./src/seed'), file: path.join(__dirname, '.local-data.json') })
const port = Number(process.env.PORT) || 3100
createApp({ store }).listen(port, () => console.log(`snackit_api listening on http://localhost:${port}`))
