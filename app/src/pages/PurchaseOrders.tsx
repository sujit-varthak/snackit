import { useState } from 'react'
import { Link } from 'react-router-dom'
import { receivePurchaseOrder, useDb } from '../store'
import type { POReceipt, PurchaseOrder } from '../types'

export default function PurchaseOrders() {
  const db = useDb()
  const [open, setOpen] = useState<PurchaseOrder | null>(null)
  const [rec, setRec] = useState<POReceipt[]>([])
  const [error, setError] = useState('')

  const startReceive = (po: PurchaseOrder) => {
    setOpen(po)
    setError('')
    setRec(po.lines.map((l) => ({ sku: l.sku, qty: l.qty, batchNo: '', expiry: '' })))
  }
  const patch = (i: number, p: Partial<POReceipt>) => setRec((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)))

  const confirm = () => {
    if (!open) return
    const r = receivePurchaseOrder(open.id, rec)
    if (!r.ok) return setError(r.error)
    setOpen(null)
  }

  const vendorName = (id: string) => db.vendors.find((v) => v.id === id)?.name ?? id
  const itemName = (sku: string) => db.items.find((i) => i.sku === sku)?.name ?? sku

  return (
    <>
      <div className="row">
        <div>
          <h2>Purchase Orders</h2>
          <p className="sub">Receiving a PO adds the batches (with expiry) to head-office stock, ready for transfer orders.</p>
        </div>
        <span className="spacer" />
        <Link to="/purchase-orders/new"><button className="primary">New purchase order</button></Link>
      </div>

      {open && (
        <div className="card suggest">
          <strong>Receive {open.id} · {vendorName(open.vendorId)}</strong>
          <table>
            <thead><tr><th>Item</th><th className="num">Received qty</th><th>Batch no.</th><th>Expiry</th></tr></thead>
            <tbody>
              {rec.map((r, i) => (
                <tr key={r.sku + i}>
                  <td>{r.sku} · {itemName(r.sku)}</td>
                  <td className="num"><input type="number" min={0} style={{ width: 80 }} value={r.qty || ''} onChange={(e) => patch(i, { qty: Number(e.target.value) })} /></td>
                  <td><input placeholder="Batch no." value={r.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} /></td>
                  <td><input type="date" value={r.expiry} onChange={(e) => patch(i, { expiry: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={confirm}>Confirm receipt</button>
            <button onClick={() => setOpen(null)}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </div>
      )}

      <div className="card">
        {db.purchaseOrders.length === 0 ? <div className="empty">No purchase orders yet.</div> : (
          <table>
            <thead><tr><th>PO</th><th>Date</th><th>Vendor</th><th>Lines</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {db.purchaseOrders.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.date}</td><td>{vendorName(p.vendorId)}</td>
                  <td>{p.lines.map((l) => `${l.sku} ×${l.qty}`).join(', ')}</td>
                  <td className="num">₹{p.lines.reduce((s, l) => s + l.qty * l.rate, 0).toFixed(2)}</td>
                  <td><span className={`badge ${p.status === 'received' ? 'ok' : 'warn'}`}>{p.status === 'received' ? 'Received' : 'Open'}</span></td>
                  <td>{p.status === 'open' && <button onClick={() => startReceive(p)}>Receive</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
