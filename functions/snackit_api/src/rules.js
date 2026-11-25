'use strict'
const { AppError } = require('./errors')
const { batchKey, stockKey } = require('./schema')

// Every stock rule from docs/data-contract.md section 5 lives here. Routes only call these functions.
// A user is { email, role } where role is admin, manager or field.

const isoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
const isQty = (n) => Number.isInteger(n) && n > 0
const today = () => new Date().toISOString().slice(0, 10)

function requireRole(user, ...roles) {
  if (!user || !roles.includes(user.role)) {
    throw new AppError('NOT_ALLOWED', 'You do not have permission to do this.')
  }
}

function canSeeMachine(user, machine) {
  if (user.role === 'admin' || user.role === 'manager') return true
  const emails = String(machine.staff_emails || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return emails.includes(String(user.email || '').toLowerCase())
}

async function nextNumber(store, table, prefix) {
  const rows = await store.list(table)
  const key = { transfers: 'transfer_no', consumption_reports: 'report_no', purchase_orders: 'po_no' }[table]
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r[key]).split('-')[1]) || 0), 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// Combine repeated lines for the same key so quantity checks see the true total.
function mergeLines(lines, keyFn) {
  const out = new Map()
  for (const l of lines) {
    const k = keyFn(l)
    out.set(k, { ...l, qty: (out.get(k)?.qty || 0) + l.qty })
  }
  return [...out.values()]
}

// ---------- reads ----------

async function visibleMachines(store, user) {
  const all = await store.list('machines')
  return all.filter((m) => canSeeMachine(user, m))
}

async function stockFor(store, user, machineCode) {
  const machines = await visibleMachines(store, user)
  const ok = new Set(machines.map((m) => m.machine_code))
  if (machineCode && !ok.has(machineCode)) throw new AppError('NOT_ALLOWED', 'You cannot see that machine.')
  const rows = await store.list('machine_stock', (r) => ok.has(r.machine_code) && (!machineCode || r.machine_code === machineCode))
  // Expiry lives on the head-office batch; attach it so every role can see it without reading batches.
  const batches = new Map((await store.list('batches')).map((b) => [b.batch_key, b]))
  return rows.map((r) => ({ ...r, expiry: batches.get(batchKey(r.sku, r.batch_no))?.expiry || '' }))
}

// ---------- machines and vendors ----------

async function saveMachine(store, user, input) {
  requireRole(user, 'admin')
  if (!input?.machine_code || !input?.name) throw new AppError('INVALID_INPUT', 'machine_code and name are required.')
  const row = {
    machine_code: String(input.machine_code).trim(),
    name: String(input.name).trim(),
    location: input.location || '',
    area: input.area || '',
    custodian: input.custodian || '',
    staff_emails: input.staff_emails || '',
    active: input.active !== false,
  }
  await store.put('machines', row)
  return row
}

async function saveVendor(store, user, input) {
  requireRole(user, 'admin', 'manager')
  if (!input?.name || !String(input.name).trim()) throw new AppError('INVALID_INPUT', 'Vendor name is required.')
  let code = input.vendor_code
  if (!code) {
    const rows = await store.list('vendors')
    const max = rows.reduce((m, r) => Math.max(m, Number(String(r.vendor_code).split('-')[1]) || 0), 0)
    code = `V-${String(max + 1).padStart(3, '0')}`
  }
  const row = {
    vendor_code: code,
    name: String(input.name).trim(),
    contact: input.contact || '',
    phone: input.phone || '',
    email: input.email || '',
    gstin: input.gstin || '',
    zoho_vendor_id: input.zoho_vendor_id || '',
    active: input.active !== false,
  }
  await store.put('vendors', row)
  return row
}

// ---------- transfers ----------

async function createTransfer(store, user, input) {
  requireRole(user, 'admin', 'manager')
  const machine = await store.get('machines', input?.machine_code)
  if (!machine) throw new AppError('NOT_FOUND', `Machine ${input?.machine_code} not found.`)
  if (!machine.active) throw new AppError('INVALID_INPUT', `Machine ${machine.machine_code} is inactive.`)
  const lines = Array.isArray(input.lines) ? input.lines : []
  if (lines.length === 0) throw new AppError('INVALID_INPUT', 'Add at least one line.')
  for (const l of lines) {
    if (!l.sku || !l.batch_no) throw new AppError('INVALID_INPUT', 'Every line needs an item and a batch.', { line: l })
    if (!isQty(l.qty)) throw new AppError('INVALID_INPUT', `Quantity for ${l.sku} must be a whole number above 0.`, { line: l })
  }
  const merged = mergeLines(lines, (l) => batchKey(l.sku, l.batch_no))

  return store.transaction(async () => {
    for (const l of merged) {
      const batch = await store.get('batches', batchKey(l.sku, l.batch_no))
      if (!batch) throw new AppError('NOT_FOUND', `Batch ${l.batch_no} not found for ${l.sku}.`)
      if (l.qty > batch.qty) {
        throw new AppError('BATCH_SHORT', `Batch ${l.batch_no} has ${batch.qty} available (requested ${l.qty}).`, {
          sku: l.sku, batch_no: l.batch_no, available: batch.qty, requested: l.qty,
        })
      }
      await store.put('batches', { ...batch, qty: batch.qty - l.qty })
      const sk = stockKey(machine.machine_code, l.sku, l.batch_no)
      const row = (await store.get('machine_stock', sk)) || {
        stock_key: sk, machine_code: machine.machine_code, sku: l.sku, batch_no: l.batch_no, qty: 0,
      }
      await store.put('machine_stock', { ...row, qty: row.qty + l.qty })
    }
    const transfer = {
      transfer_no: await nextNumber(store, 'transfers', 'TO'),
      machine_code: machine.machine_code,
      transfer_date: today(),
      lines: merged,
      zoho_sync: 'pending',
      zoho_id: '',
      zoho_error: '',
    }
    await store.insert('transfers', transfer)
    return transfer
  })
}

// ---------- consumption ----------

// Checks a day's file against machines, items and stock. Returns the problems found; changes nothing.
async function checkConsumption(store, user, input) {
  const errors = []
  if (!isoDate(input?.consumption_date)) errors.push({ row: 0, message: 'consumption_date must be YYYY-MM-DD.' })
  const lines = Array.isArray(input?.lines) ? input.lines : []
  if (lines.length === 0) errors.push({ row: 0, message: 'No lines to apply.' })

  const machines = new Map((await store.list('machines')).map((m) => [m.machine_code, m]))
  const items = new Set((await store.list('items')).map((i) => i.sku))
  const good = []
  lines.forEach((l, i) => {
    const row = i + 1
    const m = machines.get(l.machine_code)
    if (!m) errors.push({ row, message: `Unknown machine "${l.machine_code}".` })
    else if (!canSeeMachine(user, m)) errors.push({ row, message: `You cannot report for machine ${l.machine_code}.`, code: 'NOT_ALLOWED' })
    else if (!items.has(l.sku)) errors.push({ row, message: `Unknown item "${l.sku}".` })
    else if (!isQty(l.qty)) errors.push({ row, message: `Quantity "${l.qty}" must be a whole number above 0.` })
    else good.push(l)
  })
  const merged = mergeLines(good, (l) => `${l.machine_code}|${l.sku}`)
  const stock = await store.list('machine_stock')
  for (const l of merged) {
    const have = stock.filter((r) => r.machine_code === l.machine_code && r.sku === l.sku).reduce((s, r) => s + r.qty, 0)
    if (l.qty > have) {
      errors.push({
        row: 0, code: 'STOCK_SHORT',
        message: `${l.machine_code} / ${l.sku}: reported ${l.qty} but only ${have} in stock.`,
        machine_code: l.machine_code, sku: l.sku, available: have, requested: l.qty,
      })
    }
  }
  return { errors, merged, units: merged.reduce((s, l) => s + l.qty, 0) }
}

async function applyConsumption(store, user, input) {
  const check = await checkConsumption(store, user, input)
  if (check.errors.length > 0) {
    const notAllowed = check.errors.find((e) => e.code === 'NOT_ALLOWED')
    if (notAllowed) throw new AppError('NOT_ALLOWED', notAllowed.message, { errors: check.errors })
    const short = check.errors.some((e) => e.code === 'STOCK_SHORT')
    throw new AppError(short ? 'STOCK_SHORT' : 'INVALID_INPUT', 'The file was not applied. Fix the rows listed and upload again.', { errors: check.errors })
  }
  const reports = await store.list('consumption_reports')
  if (reports.some((r) => r.consumption_date === input.consumption_date) && !input.confirm_duplicate) {
    throw new AppError('DUPLICATE', `A report for ${input.consumption_date} was already applied.`)
  }

  return store.transaction(async () => {
    const batches = new Map((await store.list('batches')).map((b) => [b.batch_key, b]))
    for (const l of check.merged) {
      let remaining = l.qty
      const rows = (await store.list('machine_stock', (r) => r.machine_code === l.machine_code && r.sku === l.sku && r.qty > 0))
        .sort((a, b) => (batches.get(batchKey(a.sku, a.batch_no))?.expiry || '9999').localeCompare(batches.get(batchKey(b.sku, b.batch_no))?.expiry || '9999'))
      for (const r of rows) {
        const take = Math.min(r.qty, remaining)
        remaining -= take
        if (r.qty - take === 0) await store.remove('machine_stock', r.stock_key)
        else await store.put('machine_stock', { ...r, qty: r.qty - take })
        if (remaining === 0) break
      }
    }
    const report = {
      report_no: await nextNumber(store, 'consumption_reports', 'CR'),
      consumption_date: input.consumption_date,
      uploaded_by: user.email || '',
      lines: check.merged,
    }
    await store.insert('consumption_reports', report)
    return report
  })
}

// ---------- purchase orders ----------

async function createPurchaseOrder(store, user, input) {
  requireRole(user, 'admin', 'manager')
  const vendor = await store.get('vendors', input?.vendor_code)
  if (!vendor) throw new AppError('NOT_FOUND', `Vendor ${input?.vendor_code} not found.`)
  if (!vendor.active) throw new AppError('INVALID_INPUT', `Vendor ${vendor.vendor_code} is inactive.`)
  const lines = Array.isArray(input.lines) ? input.lines : []
  if (lines.length === 0) throw new AppError('INVALID_INPUT', 'Add at least one line.')
  const items = new Set((await store.list('items')).map((i) => i.sku))
  for (const l of lines) {
    if (!items.has(l.sku)) throw new AppError('INVALID_INPUT', `Unknown item "${l.sku}".`, { line: l })
    if (!isQty(l.qty)) throw new AppError('INVALID_INPUT', `Quantity for ${l.sku} must be a whole number above 0.`, { line: l })
    if (typeof l.rate !== 'number' || l.rate < 0) throw new AppError('INVALID_INPUT', `Rate for ${l.sku} must be a number, 0 or more.`, { line: l })
  }
  const po = {
    po_no: await nextNumber(store, 'purchase_orders', 'PO'),
    vendor_code: vendor.vendor_code,
    po_date: today(),
    status: 'open',
    lines,
    receipts: [],
    zoho_sync: 'pending',
    zoho_id: '',
    zoho_error: '',
    zoho_lines: [],
    zoho_receipt_sync: '',
    zoho_receipt_id: '',
    zoho_receipt_error: '',
  }
  await store.insert('purchase_orders', po)
  return po
}

async function receivePurchaseOrder(store, user, poNo, input) {
  requireRole(user, 'admin', 'manager')
  const po = await store.get('purchase_orders', poNo)
  if (!po) throw new AppError('NOT_FOUND', `Purchase order ${poNo} not found.`)
  if (po.status !== 'open') throw new AppError('DUPLICATE', `Purchase order ${poNo} was already received.`)
  const receipts = (Array.isArray(input?.receipts) ? input.receipts : []).filter((r) => r.qty > 0)
  if (receipts.length === 0) throw new AppError('INVALID_INPUT', 'Enter a received quantity for at least one line.')
  const ordered = new Map(po.lines.map((l) => [l.sku, l.qty]))
  const got = new Map()
  for (const r of receipts) {
    if (!ordered.has(r.sku)) throw new AppError('INVALID_INPUT', `${r.sku} is not on ${poNo}.`, { line: r })
    if (!r.batch_no || !String(r.batch_no).trim()) throw new AppError('INVALID_INPUT', `A batch number is required for ${r.sku}.`, { line: r })
    if (!isoDate(r.expiry)) throw new AppError('INVALID_INPUT', `An expiry date (YYYY-MM-DD) is required for ${r.sku}.`, { line: r })
    if (!isQty(r.qty)) throw new AppError('INVALID_INPUT', `Quantity for ${r.sku} must be a whole number above 0.`, { line: r })
    got.set(r.sku, (got.get(r.sku) || 0) + r.qty)
  }
  for (const [sku, qty] of got) {
    if (qty > ordered.get(sku)) throw new AppError('INVALID_INPUT', `Received ${qty} of ${sku} but only ${ordered.get(sku)} were ordered.`)
  }

  return store.transaction(async () => {
    for (const r of receipts) {
      const batchNo = String(r.batch_no).trim()
      const bk = batchKey(r.sku, batchNo)
      const existing = await store.get('batches', bk)
      if (existing && existing.expiry !== r.expiry) {
        throw new AppError('INVALID_INPUT', `Batch ${batchNo} of ${r.sku} already exists with expiry ${existing.expiry}.`)
      }
      await store.put('batches', existing
        ? { ...existing, qty: existing.qty + r.qty }
        : { batch_key: bk, sku: r.sku, batch_no: batchNo, expiry: r.expiry, qty: r.qty, zoho_batch_id: '' })
    }
    const updated = {
      ...po,
      status: 'received',
      receipts: receipts.map((r) => ({ ...r, batch_no: String(r.batch_no).trim() })),
      zoho_receipt_sync: 'pending',
      zoho_receipt_id: '',
      zoho_receipt_error: '',
    }
    await store.put('purchase_orders', updated)
    return updated
  })
}

module.exports = {
  canSeeMachine, visibleMachines, stockFor,
  saveMachine, saveVendor,
  createTransfer,
  checkConsumption, applyConsumption,
  createPurchaseOrder, receivePurchaseOrder,
}
