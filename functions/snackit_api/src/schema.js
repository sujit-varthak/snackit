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
  purchase_orders: { key: 'po_no', json: ['lines', 'receipts'] },
  settings: { key: 'setting_key' },
}

const batchKey = (sku, batchNo) => `${sku}|${batchNo}`
const stockKey = (machineCode, sku, batchNo) => `${machineCode}|${sku}|${batchNo}`

module.exports = { TABLES, batchKey, stockKey }
