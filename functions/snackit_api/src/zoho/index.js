'use strict'
const { createSimZoho } = require('./sim')
const { createLiveZoho } = require('./live')

// ZOHO_MODE=live uses the real Zoho (needs credentials). Anything else uses the simulated Zoho.
function createZoho(env = process.env, { batches = [] } = {}) {
  return env.ZOHO_MODE === 'live' ? createLiveZoho(env) : createSimZoho({ batches })
}

module.exports = { createZoho, createSimZoho, createLiveZoho }
