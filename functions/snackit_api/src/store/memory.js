'use strict'
const fs = require('node:fs')
const { TABLES } = require('../schema')
const { AppError } = require('../errors')

// Local data adapter. Same async interface the Catalyst adapter will have, so the rules never change.
// Pass `file` to keep the data between runs (local development only).
function createMemoryStore({ initial = {}, file } = {}) {
  let data = {}
  for (const name of Object.keys(TABLES)) data[name] = []

  if (file && fs.existsSync(file)) initial = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [name, rows] of Object.entries(initial)) {
    if (TABLES[name]) data[name] = structuredClone(rows)
  }

  const persist = () => {
    if (file) fs.writeFileSync(file, JSON.stringify(data, null, 2))
  }
  const keyOf = (table) => TABLES[table].key
  const need = (table) => {
    if (!TABLES[table]) throw new Error(`Unknown table ${table}`)
  }

  return {
    async get(table, key) {
      need(table)
      const row = data[table].find((r) => r[keyOf(table)] === key)
      return row ? structuredClone(row) : null
    },
    async list(table, predicate) {
      need(table)
      const rows = predicate ? data[table].filter(predicate) : data[table]
      return structuredClone(rows)
    },
    // Create a row. A row with the same key is refused.
    async insert(table, row) {
      need(table)
      const k = keyOf(table)
      if (data[table].some((r) => r[k] === row[k])) {
        throw new AppError('DUPLICATE', `${table} already has ${row[k]}`)
      }
      data[table].push(structuredClone(row))
      persist()
    },
    // Create or replace a row.
    async put(table, row) {
      need(table)
      const k = keyOf(table)
      const i = data[table].findIndex((r) => r[k] === row[k])
      if (i === -1) data[table].push(structuredClone(row))
      else data[table][i] = structuredClone(row)
      persist()
    },
    async remove(table, key) {
      need(table)
      const k = keyOf(table)
      data[table] = data[table].filter((r) => r[k] !== key)
      persist()
    },
    // All-or-nothing: if fn throws, every change it made is undone.
    async transaction(fn) {
      const snapshot = structuredClone(data)
      try {
        return await fn()
      } catch (e) {
        data = snapshot
        persist()
        throw e
      }
    },
  }
}

module.exports = { createMemoryStore }
