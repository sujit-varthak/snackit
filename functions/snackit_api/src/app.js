'use strict'
const express = require('express')
const rules = require('./rules')
const { AppError } = require('./errors')
const sync = require('./sync')
const { createSimZoho } = require('./zoho/sim')

// Local sign-in for development: send x-user-email and x-user-role (admin, manager, field).
// TODO(Phase 1, Catalyst): replace with Catalyst Authentication; the role must come from the login, never from the request.
function devAuth(req) {
  const role = req.get('x-user-role')
  const email = req.get('x-user-email')
  if (!['admin', 'manager', 'field'].includes(role) || !email) {
    throw new AppError('NOT_ALLOWED', 'Sign in first (dev headers x-user-email and x-user-role).')
  }
  return { email, role }
}

function createApp({ store, auth = devAuth, zoho = createSimZoho() }) {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  const wrap = (fn) => async (req, res, next) => {
    try {
      req.user = auth(req)
      res.json(await fn(req))
    } catch (e) {
      next(e)
    }
  }

  app.get('/health', (_req, res) => res.json({ ok: true }))

  const api = express.Router()
  api.get('/me', wrap(async (req) => ({ ...req.user, machines: (await rules.visibleMachines(store, req.user)).map((m) => m.machine_code) })))

  api.get('/machines', wrap((req) => rules.visibleMachines(store, req.user)))
  api.post('/machines', wrap((req) => rules.saveMachine(store, req.user, req.body)))
  api.put('/machines/:code', wrap((req) => rules.saveMachine(store, req.user, { ...req.body, machine_code: req.params.code })))

  api.get('/items', wrap(() => store.list('items')))
  api.get('/batches', wrap(async (req) => {
    if (req.user.role === 'field') throw new AppError('NOT_ALLOWED', 'Head-office batches are for managers and admins.')
    return store.list('batches')
  }))
  api.get('/stock', wrap((req) => rules.stockFor(store, req.user, req.query.machine_code)))

  api.post('/transfers', wrap((req) => rules.createTransfer(store, req.user, req.body)))
  api.get('/transfers', wrap(async (req) => {
    const ok = new Set((await rules.visibleMachines(store, req.user)).map((m) => m.machine_code))
    return store.list('transfers', (t) => ok.has(t.machine_code))
  }))

  api.post('/consumption/preview', wrap(async (req) => {
    const c = await rules.checkConsumption(store, req.user, req.body)
    return { ok: c.errors.length === 0, errors: c.errors, units: c.units }
  }))
  api.post('/consumption', wrap((req) => rules.applyConsumption(store, req.user, req.body)))
  api.get('/consumption', wrap(async (req) => {
    const ok = new Set((await rules.visibleMachines(store, req.user)).map((m) => m.machine_code))
    const reports = await store.list('consumption_reports')
    return reports.map((r) => ({ ...r, lines: r.lines.filter((l) => ok.has(l.machine_code)) })).filter((r) => r.lines.length > 0)
  }))

  api.get('/vendors', wrap(async (req) => {
    if (req.user.role === 'field') throw new AppError('NOT_ALLOWED', 'Vendors are for managers and admins.')
    return store.list('vendors')
  }))
  api.post('/vendors', wrap((req) => rules.saveVendor(store, req.user, req.body)))
  api.put('/vendors/:code', wrap((req) => rules.saveVendor(store, req.user, { ...req.body, vendor_code: req.params.code })))

  // Save first, send second: the order is stored, then sent to Zoho. A Zoho failure is stored on the order, not thrown.
  api.post('/purchase-orders', wrap(async (req) => {
    const po = await rules.createPurchaseOrder(store, req.user, req.body)
    return sync.syncPurchaseOrder(store, zoho, po.po_no)
  }))
  api.post('/purchase-orders/:no/receive', wrap(async (req) => {
    await rules.receivePurchaseOrder(store, req.user, req.params.no, req.body)
    return sync.syncReceipt(store, zoho, req.params.no)
  }))
  const managerOnly = (user) => {
    if (user.role === 'field') throw new AppError('NOT_ALLOWED', 'This is for managers and admins.')
  }
  api.post('/purchase-orders/:no/sync', wrap(async (req) => {
    managerOnly(req.user)
    return sync.syncAll(store, zoho, req.params.no)
  }))
  api.get('/zoho/status', wrap(async (req) => {
    managerOnly(req.user)
    try {
      await zoho.ping()
      return { mode: zoho.mode, up: true, error: '' }
    } catch (e) {
      return { mode: zoho.mode, up: false, error: e.message }
    }
  }))
  api.get('/zoho/head-office', wrap(async (req) => {
    managerOnly(req.user)
    return sync.headOfficeComparison(store, zoho)
  }))
  // Test switch for the simulated Zoho only: pretend Zoho is unreachable.
  api.post('/dev/zoho', wrap(async (req) => {
    managerOnly(req.user)
    if (zoho.mode !== 'simulated') throw new AppError('NOT_ALLOWED', 'Only the simulated Zoho can be switched off.')
    zoho.setDown(req.body?.down)
    return { down: zoho.isDown() }
  }))
  api.get('/purchase-orders', wrap(async (req) => {
    if (req.user.role === 'field') throw new AppError('NOT_ALLOWED', 'Purchase orders are for managers and admins.')
    return store.list('purchase_orders')
  }))

  app.use('/api', api)
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'No such endpoint.')))

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'The request body is not valid JSON.', details: {} } })
    }
    console.error(err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.', details: {} } })
  })
  return app
}

module.exports = { createApp }
