'use strict'
// Table definitions from docs/data-contract.md section 2. `key` is the unique column.
// `json` columns hold arrays; the Catalyst adapter stores them as text, the memory adapter keeps them as is.
const TABLES = {
  machines: { key: 'machine_code' },
  items: { key: 'sku' },
  vendors: { key: 'vendor_code' },
  batches: { key: 'batch_key' },
  machine_stock: { key: 'stock_key' },
  transfers: { key: 'transfer_no', json: ['lines'] },
  consumption_reports: { key: 'report_no', json: ['lines'] },
  purchase_orders: { key: 'po_no', json: ['lines', 'receipts', 'zoho_lines'] },
  settings: { key: 'setting_key' },
}

// How the tables were created in Catalyst (docs/catalyst-database.md). The Catalyst adapter uses this:
// - columnMap: app field name -> real column name (reserved words were renamed)
// - links: each child row also carries the parent's ROWID in `column`, found by looking the parent up by its code
const CATALYST = {
  columnMap: { lines: 'line_items', invoiced: 'is_invoiced' },
  links: [
    { table: 'batches', column: 'item_id', parent: 'items', code: 'sku', mandatory: true, onDelete: 'cascade' },
    { table: 'machine_stock', column: 'machine_id', parent: 'machines', code: 'machine_code', mandatory: true, onDelete: 'cascade' },
    { table: 'machine_stock', column: 'batch_id', parent: 'batches', code: 'batch_key', childCode: (r) => `${r.sku}|${r.batch_no}`, mandatory: true, onDelete: 'cascade' },
    { table: 'transfers', column: 'machine_id', parent: 'machines', code: 'machine_code', mandatory: false, onDelete: 'setnull' },
    { table: 'purchase_orders', column: 'vendor_id', parent: 'vendors', code: 'vendor_code', mandatory: false, onDelete: 'setnull' },
  ],
}

// Fields that are not plain text. Catalyst returns numbers and booleans as strings, so the adapter converts on read.
const TYPES = {
  machines: { active: 'bool' },
  items: { cost: 'double', price: 'double' },
  vendors: { active: 'bool' },
  batches: { qty: 'int' },
  machine_stock: { qty: 'int' },
  consumption_reports: { invoiced: 'bool' },
}

const batchKey = (sku, batchNo) => `${sku}|${batchNo}`
const stockKey = (machineCode, sku, batchNo) => `${machineCode}|${sku}|${batchNo}`

module.exports = { TABLES, CATALYST, TYPES, batchKey, stockKey }
