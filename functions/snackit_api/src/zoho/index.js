'use strict'
const { createSimZoho } = require('./sim')
const { createLiveZoho } = require('./live')

// ZOHO_MODE=live uses the real Zoho (needs credentials). Anything else uses the simulated Zoho, starting from `demo`.
function createZoho(env = process.env, demo = {}) {
  return env.ZOHO_MODE === 'live' ? createLiveZoho(env) : createSimZoho(demo)
}

module.exports = { createZoho, createSimZoho, createLiveZoho }
