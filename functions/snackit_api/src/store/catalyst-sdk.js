'use strict'

// The real client for the adapter, built on the Catalyst SDK. It runs inside Catalyst. test/catalyst-sdk.test.js runs the
// real SDK against a local stand-in server, so the calls and error handling are tested, but the server's answers there are
// our assumption: every VERIFY marks a first-run check against the real project.
// `app` is what `catalyst.initialize(req, { scope: 'admin' })` returns inside the function.
const PAGE = 300 // ZCQL returns at most 300 rows a query; VERIFY

// The SDK throws a plain string for a refused request ("Request failed with status 400 and code : X , message : Y").
// Turn it into an Error with a code, so the adapter can recognise a duplicate and the logs show what happened.
function asError(e) {
  if (e instanceof Error) return e
  const text = String(e)
  const error = new Error(text)
  error.code = /and code : (\S+) ,/.exec(text)?.[1]
  return error
}
const guard = async (call) => {
  try {
    return await call()
  } catch (e) {
    throw asError(e)
  }
}

function createSdkClient(app) {
  const zcql = app.zcql()
  const datastore = app.datastore()
  // Table and column names come from our own schema, never from users. Values are escaped.
  const esc = (v) => String(v).replace(/'/g, "''")
  // ZCQL returns [{ tableName: { column: value } }]
  const unwrap = (table, rows) => rows.map((r) => r[table] || Object.values(r)[0])
  const query = async (table, sql) => unwrap(table, await guard(() => zcql.executeZCQLQuery(sql)))

  return {
    async find(table, column, value) {
      const rows = await query(table, `SELECT * FROM ${table} WHERE ${column} = '${esc(value)}'`)
      return rows[0] || null
    },
    async all(table) {
      // Keyed by ROWID: if the offset turns out to count from 1, neighbouring pages share a row and it is kept once. VERIFY
      const out = new Map()
      for (let offset = 0; ; offset += PAGE) {
        const rows = await query(table, `SELECT * FROM ${table} LIMIT ${offset}, ${PAGE}`)
        for (const r of rows) out.set(String(r.ROWID), r)
        if (rows.length < PAGE) return [...out.values()]
      }
    },
    async insert(table, row) {
      return guard(() => datastore.table(table).insertRow(row))
    },
    async update(table, rowId, row) {
      await guard(() => datastore.table(table).updateRow({ ROWID: rowId, ...row }))
    },
    async remove(table, rowId) {
      await guard(() => datastore.table(table).deleteRow(rowId))
    },
  }
}

module.exports = { createSdkClient }
