// Client for the Catalyst function (docs/data-contract.md section 4). The browser only ever talks to this API, never to Zoho.

export type Role = 'admin' | 'manager' | 'field'

// Local sign-in stand-in. Catalyst Authentication replaces this; the role must then come from the login.
export const DEV_USERS: Record<Role, { email: string; label: string }> = {
  admin: { email: 'sujit@example.com', label: 'Sujit (Admin)' },
  manager: { email: 'meena@example.com', label: 'Meena (Manager)' },
  field: { email: 'ravi@example.com', label: 'Ravi (Field staff)' },
}
const ROLE_KEY = 'snackit-dev-role'

export function getRole(): Role {
  try {
    const r = localStorage.getItem(ROLE_KEY)
    if (r === 'admin' || r === 'manager' || r === 'field') return r
  } catch {
    /* storage unavailable */
  }
  return 'admin'
}
export function setRole(role: Role) {
  try {
    localStorage.setItem(ROLE_KEY, role)
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  code: string
  status: number
  details: Record<string, unknown>
  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

export interface ApiMachine { machine_code: string; name: string; location: string; area: string; custodian: string; staff_emails: string; active: boolean }
export interface ApiItem { sku: string; name: string; category: string; subcategory: string; barcode: string; cost: number; price: number }
export interface ApiBatch { batch_key: string; sku: string; batch_no: string; expiry: string; qty: number }
export interface ApiStock { stock_key: string; machine_code: string; sku: string; batch_no: string; qty: number; expiry: string }
export interface ApiTransferLine { sku: string; batch_no: string; qty: number }
export interface ApiTransfer { transfer_no: string; machine_code: string; transfer_date: string; lines: ApiTransferLine[]; zoho_sync: 'pending' | 'synced' | 'failed'; zoho_id: string; zoho_error: string }

export interface ApiVendor { vendor_code: string; name: string; contact: string; phone: string; email: string; gstin: string; zoho_vendor_id: string; active: boolean }
export interface ApiPoLine { sku: string; qty: number; rate: number }
export interface ApiReceipt { sku: string; batch_no: string; expiry: string; qty: number }
export type SyncState = 'pending' | 'synced' | 'failed' | ''
export interface ApiPo {
  po_no: string; vendor_code: string; po_date: string; status: 'open' | 'received'
  lines: ApiPoLine[]; receipts: ApiReceipt[]
  zoho_sync: SyncState; zoho_id: string; zoho_error: string
  zoho_receipt_sync: SyncState; zoho_receipt_id: string; zoho_receipt_error: string
}
export interface ApiHoRow { batch_key: string; sku: string; batch_no: string; expiry: string; app_qty: number; zoho_qty: number; diff: number; status: 'match' | 'explained' | 'check'; why: string }
export interface ApiHo { mode: 'simulated' | 'live'; fetched_at: string; ok: boolean; error?: string; rows: ApiHoRow[] }
export interface ApiConsumptionLine { machine_code: string; sku: string; qty: number }
export interface ApiReport { report_no: string; consumption_date: string; uploaded_by: string; lines: ApiConsumptionLine[]; invoiced: boolean }
export interface ApiRowError { row: number; message: string }
export type PullKind = 'items' | 'vendors' | 'batches'
export interface ApiPull { kind: PullKind; mode: 'simulated' | 'live'; fetched: number; added: number; updated: number; unchanged: number; skipped: { ref: string; reason: string }[]; next: string; stopped: string }

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const role = getRole()
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-user-email': DEV_USERS[role].email, 'x-user-role': role },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('OFFLINE', 'Cannot reach the server. Start the function (npm start in functions/snackit_api) and try again.', 0)
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error
    throw new ApiError(e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status}).`, res.status, e?.details ?? {})
  }
  return data as T
}

export const api = {
  machines: () => call<ApiMachine[]>('GET', '/machines'),
  items: () => call<ApiItem[]>('GET', '/items'),
  batches: () => call<ApiBatch[]>('GET', '/batches'),
  stock: (machineCode?: string) => call<ApiStock[]>('GET', `/stock${machineCode ? `?machine_code=${encodeURIComponent(machineCode)}` : ''}`),
  transfers: () => call<ApiTransfer[]>('GET', '/transfers'),
  vendors: () => call<ApiVendor[]>('GET', '/vendors'),
  saveVendor: (v: Partial<ApiVendor> & { name: string }) =>
    v.vendor_code ? call<ApiVendor>('PUT', `/vendors/${encodeURIComponent(v.vendor_code)}`, v) : call<ApiVendor>('POST', '/vendors', v),
  purchaseOrders: () => call<ApiPo[]>('GET', '/purchase-orders'),
  createPo: (input: { vendor_code: string; lines: ApiPoLine[] }) => call<ApiPo>('POST', '/purchase-orders', input),
  receivePo: (no: string, receipts: ApiReceipt[]) => call<ApiPo>('POST', `/purchase-orders/${encodeURIComponent(no)}/receive`, { receipts }),
  syncPo: (no: string) => call<ApiPo>('POST', `/purchase-orders/${encodeURIComponent(no)}/sync`),
  zohoHeadOffice: () => call<ApiHo>('GET', '/zoho/head-office'),
  zohoStatus: () => call<{ mode: 'simulated' | 'live'; up: boolean; error: string }>('GET', '/zoho/status'),
  devZoho: (down: boolean) => call<{ down: boolean }>('POST', '/dev/zoho', { down }),
  createTransfer: (input: { machine_code: string; lines: ApiTransferLine[] }) => call<ApiTransfer>('POST', '/transfers', input),
  updateTransfer: (no: string, input: { machine_code: string; lines: ApiTransferLine[] }) => call<ApiTransfer>('PUT', `/transfers/${encodeURIComponent(no)}`, input),
  deleteTransfer: (no: string) => call<{ deleted: string }>('DELETE', `/transfers/${encodeURIComponent(no)}`),
  exportTransfer: (no: string) => call<ApiTransfer>('POST', `/transfers/${encodeURIComponent(no)}/sync`),
  createMachine: (m: ApiMachine) => call<ApiMachine>('POST', '/machines', m),
  updateMachine: (m: ApiMachine) => call<ApiMachine>('PUT', `/machines/${encodeURIComponent(m.machine_code)}`, m),
  deleteMachine: (code: string) => call<{ deleted: string }>('DELETE', `/machines/${encodeURIComponent(code)}`),
  consumption: () => call<ApiReport[]>('GET', '/consumption'),
  previewConsumption: (input: { consumption_date: string; lines: ApiConsumptionLine[] }) =>
    call<{ ok: boolean; errors: ApiRowError[]; units: number }>('POST', '/consumption/preview', input),
  applyConsumption: (input: { consumption_date: string; lines: ApiConsumptionLine[]; confirm_duplicate?: boolean }) => call<ApiReport>('POST', '/consumption', input),
  pull: (kind: PullKind, after: string) => call<ApiPull>('POST', `/sync/${kind}`, { after }),
}
