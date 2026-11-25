'use strict'

// A stand-in for the Catalyst Data Store that behaves like the real tables created on 25 Nov 2026
// (docs/catalyst-database.md). It is written independently of the adapter on purpose: its column list, unique keys,
// links and delete rules are copied from what exists in Catalyst, so an adapter mistake shows up as a refusal here.
// Like Catalyst it returns numbers and booleans as strings, refuses unknown columns, and checks links.
const S = 'string', T = 'text', I = 'int', D = 'double', B = 'bool', DT = 'date'
const fk = (parent, onDelete, mandatory) => ({ type: 'fk', parent, onDelete, mandatory })

const DEFS = {
  machines: { unique: ['machine_code'], mandatory: ['machine_code', 'name'], cols: { machine_code: S, name: S, location: S, area: S, custodian: S, staff_emails: T, active: B } },
  items: { unique: ['sku'], mandatory: ['sku', 'name'], cols: { sku: S, name: S, category: S, subcategory: S, barcode: S, cost: D, price: D, zoho_item_id: S } },
  vendors: { unique: ['vendor_code'], mandatory: ['vendor_code', 'name'], cols: { vendor_code: S, name: S, contact: S, phone: S, email: S, gstin: S, zoho_vendor_id: S, active: B } },
  batches: { unique: ['batch_key'], mandatory: ['batch_key', 'batch_no', 'qty', 'sku', 'item_id'], cols: { batch_key: S, batch_no: S, expiry: DT, qty: I, zoho_batch_id: S, sku: S, item_id: fk('items', 'cascade', true) } },
  machine_stock: { unique: ['stock_key'], mandatory: ['stock_key', 'machine_code', 'sku', 'batch_no', 'qty', 'machine_id', 'batch_id'], cols: { stock_key: S, machine_code: S, sku: S, batch_no: S, qty: I, machine_id: fk('machines', 'cascade', true), batch_id: fk('batches', 'cascade', true) } },
  transfers: { unique: ['transfer_no'], mandatory: ['transfer_no', 'machine_code', 'transfer_date'], cols: { transfer_no: S, machine_code: S, line_items: T, zoho_id: S, zoho_error: T, transfer_date: DT, zoho_sync: S, machine_id: fk('machines', 'setnull', false) } },
  consumption_reports: { unique: ['report_no'], mandatory: ['report_no', 'consumption_date'], cols: { report_no: S, uploaded_by: S, line_items: T, consumption_date: DT, is_invoiced: B } },
  purchase_orders: { unique: ['po_no'], mandatory: ['po_no', 'vendor_code', 'po_date'], cols: { po_no: S, vendor_code: S, status: S, line_items: T, receipts: T, zoho_lines: T, zoho_sync: S, zoho_id: S, zoho_error: T, zoho_receipt_sync: S, zoho_receipt_id: S, zoho_receipt_error: T, po_date: DT, vendor_id: fk('vendors', 'setnull', false) } },
  settings: { unique: ['setting_key'], mandatory: ['setting_key'], cols: { setting_key: S, setting_value: S } },
}
const TEXT_LIMIT = 10000
const SYSTEM = new Set(['ROWID', 'CREATORID', 'CREATEDTIME', 'MODIFIEDTIME'])

function fail(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

function createFakeCatalyst() {
  const tables = Object.fromEntries(Object.keys(DEFS).map((t) => [t, new Map()])) // ROWID -> stored row
  let next = 29680000000500000n
  const newId = () => String(next++)
  const now = () => '2026-11-25 15:00:00:000'

  // Catalyst stores everything as text-like values and hands them back as strings.
  function store(table, col, val) {
    const def = DEFS[table].cols[col]
    if (val === null || val === undefined) return null
    const kind = def.type || def
    if (kind === I) { if (!/^-?\d+$/.test(String(val))) throw fail('INVALID_INPUT', `Invalid input value for ${col}. int value expected`); return String(val) }
    if (kind === D) { if (Number.isNaN(Number(val))) throw fail('INVALID_INPUT', `Invalid input value for ${col}. double value expected`); return Number(val).toFixed(2) }
    if (kind === B) return String(val === true || val === 'true')
    if (kind === T) { if (String(val).length > TEXT_LIMIT) throw fail('INVALID_INPUT', `Value too long for ${col}`); return String(val) }
    if (kind === 'fk') {
      if (!tables[def.parent].has(String(val))) throw fail('INVALID_INPUT', `Invalid Foreign key value for column ${col}. ROWID of table ${def.parent} is expected`)
      return String(val)
    }
    return String(val)
  }

  function checkRow(table, row, ignoreId) {
    const def = DEFS[table]
    for (const col of Object.keys(row)) if (!(col in def.cols) && !SYSTEM.has(col)) throw fail('INVALID_OPERATION', `Column ${col} does not exist in ${table}`)
    for (const u of def.unique) {
      for (const [id, existing] of tables[table]) if (id !== ignoreId && existing[u] === String(row[u])) throw fail('DUPLICATE_VALUE', `Duplicate value for ${u}`)
    }
  }

  const copy = (r) => ({ ...r })

  return {
    // test helpers
    dump: (table) => [...tables[table].values()].map(copy),
    // the client the adapter uses
    async find(table, column, value) {
      for (const r of tables[table].values()) if (r[column] === String(value)) return copy(r)
      return null
    },
    async all(table) {
      return [...tables[table].values()].map(copy)
    },
    async insert(table, row) {
      const def = DEFS[table]
      const stored = {}
      for (const [c, v] of Object.entries(row)) {
        if (!(c in def.cols)) throw fail('INVALID_OPERATION', `Column ${c} does not exist in ${table}`)
        stored[c] = store(table, c, v)
      }
      for (const m of def.mandatory) if (stored[m] === null || stored[m] === undefined) throw fail('MANDATORY_NOT_FOUND', `${m} is mandatory in ${table}`)
      for (const c of Object.keys(def.cols)) if (!(c in stored)) stored[c] = def.cols[c] === B ? (c === 'is_invoiced' ? 'false' : 'true') : null // the real boolean defaults
      if (table === 'transfers' && stored.zoho_sync === null) stored.zoho_sync = 'pending'
      checkRow(table, stored)
      const ROWID = newId()
      const full = { ROWID, CREATORID: '1', CREATEDTIME: now(), MODIFIEDTIME: now(), ...stored }
      tables[table].set(ROWID, full)
      return copy(full)
    },
    async update(table, rowId, row) {
      const cur = tables[table].get(String(rowId))
      if (!cur) throw fail('INVALID_INPUT', `No row ${rowId} in ${table}`)
      const stored = {}
      for (const [c, v] of Object.entries(row)) {
        if (!(c in DEFS[table].cols)) throw fail('INVALID_OPERATION', `Column ${c} does not exist in ${table}`)
        stored[c] = store(table, c, v)
      }
      for (const m of DEFS[table].mandatory) if (m in stored && stored[m] === null) throw fail('MANDATORY_NOT_FOUND', `${m} is mandatory in ${table}`)
      checkRow(table, { ...cur, ...stored }, String(rowId))
      tables[table].set(String(rowId), { ...cur, ...stored, MODIFIEDTIME: now() })
    },
    async remove(table, rowId) {
      const id = String(rowId)
      if (!tables[table].delete(id)) return
      // the delete rule of every link that points at this table
      for (const [child, def] of Object.entries(DEFS)) {
        for (const [col, c] of Object.entries(def.cols)) {
          if (c.type !== 'fk' || c.parent !== table) continue
          for (const [cid, row] of [...tables[child]]) {
            if (row[col] !== id) continue
            if (c.onDelete === 'cascade') await this.remove(child, cid)
            else tables[child].set(cid, { ...row, [col]: null })
          }
        }
      }
    },
  }
}

module.exports = { createFakeCatalyst }
