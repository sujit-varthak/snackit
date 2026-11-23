// Domain model derived from the 23 Nov 2026 MOM.
// Zoho Books holds ONE consolidated "vending machine" location; per-machine stock lives only here.

export interface Machine {
  id: string // e.g. "VM-001" – also the lookup value sent to Zoho Books on transfer orders
  name: string
  location: string
  area: string
  custodian: string
}

export interface Item {
  sku: string
  name: string
  category: string
  subcategory: string
  cost: number
  price: number
  barcode?: string
}

/** Batch held at head office (mirrors Zoho Books batch/lot tracking; expiry reporting stays in Zoho). */
export interface Batch {
  batchNo: string
  sku: string
  expiry: string // ISO date
  qty: number // available at head office
}

export interface TransferLine {
  sku: string
  batchNo: string
  qty: number
}

export type SyncStatus = 'pending' | 'synced' | 'failed'

export interface TransferOrder {
  id: string
  date: string
  machineId: string
  lines: TransferLine[]
  zohoSync: SyncStatus
  zohoRef?: string
}

/** Stock at one machine for one item batch. */
export interface MachineStockRow {
  machineId: string
  sku: string
  batchNo: string
  qty: number
}

export interface ConsumptionLine {
  machineId: string
  sku: string
  qty: number
}

export interface ConsumptionReport {
  id: string
  date: string // consumption date
  uploadedAt: string
  lines: ConsumptionLine[]
}

export interface Vendor {
  id: string // e.g. "V-001"
  name: string
  contact: string
  phone: string
  email: string
  gstin: string
  active: boolean
}

export interface POLine {
  sku: string
  qty: number
  rate: number
}

export interface POReceipt {
  sku: string
  batchNo: string
  expiry: string
  qty: number
}

export interface PurchaseOrder {
  id: string
  date: string
  vendorId: string
  lines: POLine[]
  status: 'open' | 'received'
  receipts?: POReceipt[]
}

export interface DbState {
  vendors: Vendor[]
  purchaseOrders: PurchaseOrder[]
  machines: Machine[]
  items: Item[]
  batches: Batch[]
  machineStock: MachineStockRow[]
  transfers: TransferOrder[]
  consumption: ConsumptionReport[]
}
