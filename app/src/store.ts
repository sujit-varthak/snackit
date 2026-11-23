import { useSyncExternalStore } from 'react'
import { seed } from './seed'
import type { ConsumptionLine, DbState, POLine, POReceipt, PurchaseOrder, TransferLine, TransferOrder, Vendor } from './types'

// Local persistence layer (localStorage). Every mutation here maps 1:1 to a future
// Catalyst Data Store / Function call – swap the internals, keep the signatures.
const KEY = 'snackit-db-v1'

function load(): DbState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...structuredClone(seed), ...(JSON.parse(raw) as Partial<DbState>) } // fills in newer collections
  } catch {
    /* fall through to seed */
  }
  return structuredClone(seed)
}

let state: DbState = load()
const listeners = new Set<() => void>()

function commit(next: DbState) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable – keep in memory */
  }
  listeners.forEach((l) => l())
}

export const useDb = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )

export const resetDemoData = () => commit(structuredClone(seed))

const today = () => new Date().toISOString().slice(0, 10)

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/** Create a transfer order: validates batch availability, moves stock head office -> machine. */
export function createTransfer(machineId: string, lines: TransferLine[]): Result<TransferOrder> {
  const clean = lines.filter((l) => l.qty > 0)
  if (!machineId) return { ok: false, error: 'Select a vending machine.' }
  if (clean.length === 0) return { ok: false, error: 'Add at least one line with quantity.' }

  const batches = state.batches.map((b) => ({ ...b }))
  const stock = state.machineStock.map((r) => ({ ...r }))

  const wanted = new Map<string, number>()
  for (const l of clean) {
    if (!l.batchNo) return { ok: false, error: `Select a batch for ${l.sku}.` }
    const k = `${l.sku}|${l.batchNo}`
    wanted.set(k, (wanted.get(k) ?? 0) + l.qty)
  }
  for (const [k, qty] of wanted) {
    const [sku, batchNo] = k.split('|')
    const b = batches.find((x) => x.sku === sku && x.batchNo === batchNo)
    if (!b) return { ok: false, error: `Batch ${batchNo} not found for ${sku}.` }
    if (qty > b.qty) return { ok: false, error: `Batch ${batchNo} has only ${b.qty} available (requested ${qty}).` }
    b.qty -= qty
    const row = stock.find((r) => r.machineId === machineId && r.sku === sku && r.batchNo === batchNo)
    if (row) row.qty += qty
    else stock.push({ machineId, sku, batchNo, qty })
  }

  const order: TransferOrder = {
    id: `TO-${String(state.transfers.length + 1).padStart(4, '0')}`,
    date: today(),
    machineId,
    lines: clean,
    zohoSync: 'pending',
  }
  commit({ ...state, batches, machineStock: stock, transfers: [order, ...state.transfers] })
  return { ok: true, value: order }
}

export const markTransferSynced = (id: string, zohoRef: string) =>
  commit({
    ...state,
    transfers: state.transfers.map((t) => (t.id === id ? { ...t, zohoSync: 'synced', zohoRef } : t)),
  })

/** Apply a daily consumption report: deducts machine stock FEFO (earliest expiry first). */
export function applyConsumption(date: string, lines: ConsumptionLine[]): Result<{ shortfalls: string[] }> {
  if (lines.length === 0) return { ok: false, error: 'No lines to apply.' }
  const stock = state.machineStock.map((r) => ({ ...r }))
  const expiry = (sku: string, batchNo: string) => state.batches.find((b) => b.sku === sku && b.batchNo === batchNo)?.expiry ?? ''
  const shortfalls: string[] = []

  for (const l of lines) {
    let remaining = l.qty
    const rows = stock
      .filter((r) => r.machineId === l.machineId && r.sku === l.sku && r.qty > 0)
      .sort((a, b) => expiry(a.sku, a.batchNo).localeCompare(expiry(b.sku, b.batchNo)))
    for (const r of rows) {
      const take = Math.min(r.qty, remaining)
      r.qty -= take
      remaining -= take
      if (remaining === 0) break
    }
    if (remaining > 0) shortfalls.push(`${l.machineId} / ${l.sku}: ${remaining} more consumed than in stock`)
  }

  commit({
    ...state,
    machineStock: stock.filter((r) => r.qty > 0),
    consumption: [
      { id: `CR-${String(state.consumption.length + 1).padStart(4, '0')}`, date, uploadedAt: new Date().toISOString(), lines },
      ...state.consumption,
    ],
  })
  return { ok: true, value: { shortfalls } }
}

export function saveVendor(v: Omit<Vendor, 'id'> & { id?: string }): Result<Vendor> {
  if (!v.name.trim()) return { ok: false, error: 'Vendor name is required.' }
  if (v.id) {
    const updated = { ...v, id: v.id } as Vendor
    commit({ ...state, vendors: state.vendors.map((x) => (x.id === v.id ? updated : x)) })
    return { ok: true, value: updated }
  }
  const created: Vendor = { ...v, id: `V-${String(state.vendors.length + 1).padStart(3, '0')}` }
  commit({ ...state, vendors: [...state.vendors, created] })
  return { ok: true, value: created }
}

export function createPurchaseOrder(vendorId: string, lines: POLine[]): Result<PurchaseOrder> {
  const clean = lines.filter((l) => l.sku && l.qty > 0)
  if (!vendorId) return { ok: false, error: 'Select a vendor.' }
  if (clean.length === 0) return { ok: false, error: 'Add at least one line with quantity.' }
  const po: PurchaseOrder = {
    id: `PO-${String(state.purchaseOrders.length + 1).padStart(4, '0')}`,
    date: today(),
    vendorId,
    lines: clean,
    status: 'open',
  }
  commit({ ...state, purchaseOrders: [po, ...state.purchaseOrders] })
  return { ok: true, value: po }
}

/** Goods receipt: marks the PO received and adds the received batches to head-office stock. */
export function receivePurchaseOrder(id: string, receipts: POReceipt[]): Result {
  const po = state.purchaseOrders.find((p) => p.id === id)
  if (!po || po.status === 'received') return { ok: false, error: 'Purchase order not open.' }
  const got = receipts.filter((r) => r.qty > 0)
  if (got.length === 0) return { ok: false, error: 'Enter received quantity for at least one line.' }
  if (got.some((r) => !r.batchNo.trim() || !r.expiry)) return { ok: false, error: 'Batch number and expiry are required for every received line.' }
  const batches = state.batches.map((b) => ({ ...b }))
  for (const r of got) {
    const b = batches.find((x) => x.sku === r.sku && x.batchNo === r.batchNo.trim())
    if (b) b.qty += r.qty
    else batches.push({ sku: r.sku, batchNo: r.batchNo.trim(), expiry: r.expiry, qty: r.qty })
  }
  commit({
    ...state,
    batches,
    purchaseOrders: state.purchaseOrders.map((p) => (p.id === id ? { ...p, status: 'received', receipts: got } : p)),
  })
  return { ok: true, value: undefined }
}
