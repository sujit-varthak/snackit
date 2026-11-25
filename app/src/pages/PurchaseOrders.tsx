import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type ApiPo, type SyncState } from '../api'
import { Gate, useLoad } from '../useLoad'

interface Rec { sku: string; qty: string; batch_no: string; expiry: string }

function SyncPill({ state, label }: { state: SyncState; label: string }) {
  if (!state) return <span className="badge">{label}: —</span>
  const cls = state === 'synced' ? 'ok' : state === 'failed' ? 'bad' : 'warn'
  return <span className={`badge ${cls}`}>{label}: {state === 'synced' ? 'In Zoho' : state === 'failed' ? 'Failed' : 'Waiting'}</span>
}

export default function PurchaseOrders() {
  const pos = useLoad(() => api.purchaseOrders())
  const vendors = useLoad(() => api.vendors())
  const items = useLoad(() => api.items())
  const [open, setOpen] = useState<ApiPo | null>(null)
  const [rec, setRec] = useState<Rec[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const vendorName = (code: string) => vendors.data?.find((v) => v.vendor_code === code)?.name ?? code
  const itemName = (sku: string) => items.data?.find((i) => i.sku === sku)?.name ?? sku

  const startReceive = (po: ApiPo) => {
    setOpen(po)
    setError('')
    setRec(po.lines.map((l) => ({ sku: l.sku, qty: String(l.qty), batch_no: '', expiry: '' })))
  }
  const patch = (i: number, p: Partial<Rec>) => setRec((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)))

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      pos.reload()
      return true
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')
      return false
    } finally {
      setBusy('')
    }
  }

  const confirm = async () => {
    if (!open) return
    const ok = await run('receive', () => api.receivePo(open.po_no, rec.map((r) => ({ sku: r.sku, batch_no: r.batch_no, expiry: r.expiry, qty: Number(r.qty) }))))
    if (ok) setOpen(null)
  }

  return (
    <>
      <div className="row">
        <div>
          <h2>Purchase Orders</h2>
          <p className="sub">Receiving an order adds its batches (with expiry) to head-office stock. Orders and receipts are saved here first, then sent to Zoho.</p>
        </div>
        <span className="spacer" />
        <Link to="/purchase-orders/new"><button className="primary">New purchase order</button></Link>
      </div>

      {open && (
        <div className="card suggest">
          <strong>Receive {open.po_no} · {vendorName(open.vendor_code)}</strong>
          <table>
            <thead><tr><th>Item</th><th className="num">Received qty</th><th>Batch no.</th><th>Expiry</th></tr></thead>
            <tbody>
              {rec.map((r, i) => (
                <tr key={r.sku}>
                  <td>{r.sku} · {itemName(r.sku)}</td>
                  <td className="num"><input type="number" min={0} step={1} style={{ width: 80 }} value={r.qty} onChange={(e) => patch(i, { qty: e.target.value })} /></td>
                  <td><input placeholder="Batch no." value={r.batch_no} onChange={(e) => patch(i, { batch_no: e.target.value })} /></td>
                  <td><input type="date" value={r.expiry} onChange={(e) => patch(i, { expiry: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy === 'receive'} onClick={confirm}>{busy === 'receive' ? 'Saving…' : 'Confirm receipt'}</button>
            <button onClick={() => setOpen(null)}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </div>
      )}
      {!open && error && <p className="err">{error}</p>}

      <Gate states={[pos, vendors, items]}>
        <div className="card">
          {(pos.data ?? []).length === 0 ? <div className="empty">No purchase orders yet.</div> : (
            <table>
              <thead><tr><th>PO</th><th>Date</th><th>Vendor</th><th>Lines</th><th className="num">Amount</th><th>Status</th><th>Zoho</th><th /></tr></thead>
              <tbody>
                {[...(pos.data ?? [])].reverse().map((p) => {
                  const stuck = p.zoho_sync !== 'synced' || (p.status === 'received' && p.zoho_receipt_sync !== 'synced')
                  const why = p.zoho_error || p.zoho_receipt_error
                  return (
                    <tr key={p.po_no}>
                      <td>{p.po_no}</td><td>{p.po_date}</td><td>{vendorName(p.vendor_code)}</td>
                      <td>{p.lines.map((l) => `${l.sku} ×${l.qty}`).join(', ')}</td>
                      <td className="num">₹{p.lines.reduce((s, l) => s + l.qty * l.rate, 0).toFixed(2)}</td>
                      <td><span className={`badge ${p.status === 'received' ? 'ok' : 'warn'}`}>{p.status === 'received' ? 'Received' : 'Open'}</span></td>
                      <td>
                        <div><SyncPill state={p.zoho_sync} label="Order" /></div>
                        {p.status === 'received' && <div><SyncPill state={p.zoho_receipt_sync} label="Receipt" /></div>}
                        {stuck && why && <div className="hint" style={{ maxWidth: 260, whiteSpace: 'normal' }}>{why}</div>}
                      </td>
                      <td>
                        {p.status === 'open' && <button onClick={() => startReceive(p)}>Receive</button>}{' '}
                        {stuck && <button disabled={busy === p.po_no} onClick={() => run(p.po_no, () => api.syncPo(p.po_no))}>{busy === p.po_no ? 'Sending…' : 'Retry Zoho'}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Gate>
    </>
  )
}
