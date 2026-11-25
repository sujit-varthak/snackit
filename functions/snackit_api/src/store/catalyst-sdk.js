'use strict'

// The real client for the adapter, built on the Catalyst SDK. It only runs inside Catalyst (or with Catalyst credentials),
// so it is NOT tested here; the adapter is tested against test/fake-catalyst.js. Every VERIFY marks a first-run check.
// `app` is what `catalyst.initialize(req)` returns inside the function.
const PAGE = 300 // ZCQL returns at most 300 rows a query; VERIFY

function createSdkClient(app) {
  const zcql = app.zcql()
  const datastore = app.datastore()
  // Table and column names come from our own schema, never from users. Values are escaped.
  const esc = (v) => String(v).replace(/'/g, "''") // VERIFY ZCQL's escaping rule for quotes
  // ZCQL returns [{ tableName: { column: value } }]
  const unwrap = (table, rows) => rows.map((r) => r[table] || Object.values(r)[0])

  return {
    async find(table, column, value) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM ${table} WHERE ${column} = '${esc(value)}'`)
      return rows.length ? unwrap(table, rows)[0] : null
    },
    async all(table) {
      const out = []
      for (let offset = 0; ; offset += PAGE) {
        const rows = await zcql.executeZCQLQuery(`SELECT * FROM ${table} LIMIT ${offset}, ${PAGE}`)
        out.push(...unwrap(table, rows))
        if (rows.length < PAGE) return out
      }
    },
    async insert(table, row) {
      return datastore.table(table).insertRow(row)
    },
    async update(table, rowId, row) {
      await datastore.table(table).updateRow({ ROWID: rowId, ...row })
    },
    async remove(table, rowId) {
      await datastore.table(table).deleteRow(rowId)
    },
  }
}

module.exports = { createSdkClient }
