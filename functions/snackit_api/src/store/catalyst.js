'use strict'
const { TABLES, CATALYST, TYPES } = require('../schema')
const { AppError } = require('../errors')

// Catalyst Data Store adapter. Same async interface as the memory adapter, so the rules never change.
// It talks to Catalyst through a small `client` (see catalyst-sdk.js for the real one, test/fake-catalyst.js for the test one):
//   find(table, column, value) -> raw row or null      all(table) -> raw rows
//   insert(table, row) -> raw row                      update(table, rowId, row)      remove(table, rowId)
//
// What it does on top of the client (docs/catalyst-database.md):
//  - renames fields the database could not take (lines -> line_items, invoiced -> is_invoiced)
//  - stores JSON fields as text, and refuses anything over the 10,000-character column limit
//  - converts numbers and booleans, which Catalyst returns as strings
//  - fills each link column with the parent row's ROWID, found by the parent's code
//  - undoes a failed multi-step change by replaying inverse operations (Catalyst has no transactions)
const SYSTEM = new Set(['ROWID', 'CREATORID', 'CREATEDTIME', 'MODIFIEDTIME'])
const MAX_TEXT = 10000
const toDbName = CATALYST.columnMap
const toAppName = Object.fromEntries(Object.entries(CATALYST.columnMap).map(([a, d]) => [d, a]))

const cmpId = (a, b) => (BigInt(a.ROWID) < BigInt(b.ROWID) ? -1 : BigInt(a.ROWID) > BigInt(b.ROWID) ? 1 : 0)

function createCatalystStore(client) {
  let undo = null // the undo log while a transaction is open

  const linksOf = (table) => CATALYST.links.filter((l) => l.table === table)
  const need = (table) => {
    if (!TABLES[table]) throw new Error(`Unknown table ${table}`)
  }

  // app row -> database row
  function toDb(table, row) {
    const out = {}
    const json = TABLES[table].json || []
    const types = TYPES[table] || {}
    for (const [k, v] of Object.entries(row)) {
      if (v === undefined) continue
      const col = toDbName[k] || k
      if (json.includes(k)) {
        const text = JSON.stringify(v ?? [])
        if (text.length > MAX_TEXT) throw new AppError('INVALID_INPUT', `${table}.${k} is too long to store (${text.length} characters, limit ${MAX_TEXT}). Split the order into smaller ones.`)
        out[col] = text
      } else if (types[k] === 'date' && v === '') {
        out[col] = null
      } else {
        out[col] = v
      }
    }
    return out
  }

  // database row -> app row
  function fromDb(table, raw) {
    const row = {}
    const linkCols = new Set(linksOf(table).map((l) => l.column))
    const json = TABLES[table].json || []
    const types = TYPES[table] || {}
    for (const [col, val] of Object.entries(raw)) {
      if (SYSTEM.has(col) || linkCols.has(col)) continue
      const k = toAppName[col] || col
      if (json.includes(k)) row[k] = val ? JSON.parse(val) : []
      else if (types[k] === 'int') row[k] = val === null || val === undefined ? 0 : parseInt(val, 10)
      else if (types[k] === 'double') row[k] = val === null || val === undefined ? 0 : Number(val)
      else if (types[k] === 'bool') row[k] = val === true || val === 'true'
      else row[k] = val === null || val === undefined ? '' : val
    }
    return row
  }

  async function findRaw(table, key) {
    return client.find(table, TABLES[table].key, key)
  }

  // The link columns for a row: each one holds the parent's ROWID.
  async function linkValues(table, row) {
    const out = {}
    for (const l of linksOf(table)) {
      const code = l.childCode ? l.childCode(row) : row[l.code]
      const parent = code ? await client.find(l.parent, l.code, code) : null
      if (parent) out[l.column] = parent.ROWID
      else if (l.mandatory) throw new AppError('INVALID_INPUT', `${table}: ${l.parent} "${code}" does not exist.`)
      else out[l.column] = null
    }
    return out
  }

  const stripSystem = (raw) => Object.fromEntries(Object.entries(raw).filter(([c]) => !SYSTEM.has(c)))

  async function doInsert(table, row) {
    const dbRow = { ...toDb(table, row), ...(await linkValues(table, row)) }
    let made
    try {
      made = await client.insert(table, dbRow)
    } catch (e) {
      if (e instanceof AppError) throw e
      if (e?.code === 'DUPLICATE_VALUE' || /duplicate|already exists|unique/i.test(String(e?.message))) { // VERIFY the real SDK's error shape
        throw new AppError('DUPLICATE', `${table} already has ${row[TABLES[table].key]}`)
      }
      throw e
    }
    if (undo) undo.push(() => client.remove(table, made.ROWID))
    return made
  }

  return {
    async get(table, key) {
      need(table)
      const raw = await findRaw(table, key)
      return raw ? fromDb(table, raw) : null
    },
    async list(table, predicate) {
      need(table)
      const rows = (await client.all(table)).sort(cmpId).map((r) => fromDb(table, r))
      return predicate ? rows.filter(predicate) : rows
    },
    async insert(table, row) {
      need(table)
      await doInsert(table, row)
    },
    // Create or replace a row.
    async put(table, row) {
      need(table)
      const existing = await findRaw(table, row[TABLES[table].key])
      if (!existing) return void (await doInsert(table, row))
      const dbRow = { ...toDb(table, row), ...(await linkValues(table, row)) }
      await client.update(table, existing.ROWID, dbRow)
      if (undo) undo.push(() => client.update(table, existing.ROWID, stripSystem(existing)))
    },
    async remove(table, key) {
      need(table)
      const existing = await findRaw(table, key)
      if (!existing) return
      await client.remove(table, existing.ROWID)
      // Rows deleted along with it by a link rule are not restored; the rules never delete parent rows.
      if (undo) undo.push(() => client.insert(table, stripSystem(existing)))
    },
    // Best effort: Catalyst has no transactions, so a failure replays the inverse of every step, newest first.
    async transaction(fn) {
      if (undo) return fn() // already inside one
      undo = []
      try {
        return await fn()
      } catch (e) {
        const log = undo
        undo = null
        for (const step of log.reverse()) {
          try {
            await step()
          } catch (undoError) {
            console.error('Could not undo a step after a failure:', undoError.message)
          }
        }
        throw e
      } finally {
        undo = null
      }
    },
  }
}

module.exports = { createCatalystStore }
