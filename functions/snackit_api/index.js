'use strict'
// Advanced I/O function entry. Chooses the data adapter from the STORE setting.
// memory (default): local demo data, lost on restart. catalyst: Data Store, built in a later step.
const { createApp } = require('./src/app')
const { createMemoryStore } = require('./src/store/memory')

if (process.env.STORE === 'catalyst') {
  throw new Error('The Catalyst Data Store adapter is not built yet. Use STORE=memory for now.')
}

const store = createMemoryStore({ initial: require('./src/seed') })
module.exports = createApp({ store })
