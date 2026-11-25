'use strict'
const { AsyncLocalStorage } = require('node:async_hooks')

// In Catalyst the data client belongs to one request (catalyst.initialize(req)). This gives the rest of the code a single
// `store` object that always talks to the store of the request that is running, so the rules and routes stay unchanged.
function createContextStore() {
  const als = new AsyncLocalStorage()
  const current = () => {
    const ctx = als.getStore()
    if (!ctx) throw new Error('No store for this request. Wrap the request in run().')
    return ctx.store
  }
  const store = {
    get: (...a) => current().get(...a),
    list: (...a) => current().list(...a),
    insert: (...a) => current().insert(...a),
    put: (...a) => current().put(...a),
    remove: (...a) => current().remove(...a),
    transaction: (...a) => current().transaction(...a),
  }
  return { store, run: (requestStore, fn) => als.run({ store: requestStore }, fn) }
}

module.exports = { createContextStore }
