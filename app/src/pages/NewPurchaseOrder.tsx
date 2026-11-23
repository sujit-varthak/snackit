import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPurchaseOrder, useDb } from '../store'
import type { POLine } from '../types'

interface Line extends POLine { key: number }

export default function NewPurchaseOrder() {
  const db = useDb()
  const nav = useNavigate()
  const [vendorId, setVendorId] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 0, sku: '', qty: 0, rate: 0 }])
  const [error, setError] = useState('')

  const patch = (key: number, p: Partial<POLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0)

  const submit = () => {
    const r = createPurchaseOrder(vendorId, lines.map(({ sku, qty, rate }) => ({ sku, qty, rate })))
    if (!r.ok) return setError(r.error)
    nav('/purchase-orders')
  }

  return (
    <>
      <h2>New Purchase Order</h2>
      <p className="sub">Order stock from a vendor. Receive it later to add batches to head-office stock.</p>
      <div className="card">
        <div className="row">
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {db.vendors.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.id} · {v.name}</option>)}
          </select>
        </div>
        <table>
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <select value={l.sku} onChange={(e) => patch(l.key, { sku: e.target.value, rate: db.items.find((i) => i.sku === e.target.value)?.cost ?? 0 })}>
                    <option value="">Select item…</option>
                    {db.items.map((i) => <option key={i.sku} value={i.sku}>{i.sku} · {i.name}</option>)}
                  </select>
                </td>
                <td className="num"><input type="number" min={0} style={{ width: 80 }} value={l.qty || ''} onChange={(e) => patch(l.key, { qty: Number(e.target.value) })} /></td>
                <td className="num"><input type="number" min={0} style={{ width: 80 }} value={l.rate || ''} onChange={(e) => patch(l.key, { rate: Number(e.target.value) })} /></td>
                <td className="num">{(l.qty * l.rate).toFixed(2)}</td>
                <td><button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => setLines((ls) => [...ls, { key: Date.now(), sku: '', qty: 0, rate: 0 }])}>+ Add line</button>
          <span className="spacer" />
          <strong>Total ₹{total.toFixed(2)}</strong>
          {error && <span className="err">{error}</span>}
          <button className="primary" onClick={submit}>Create purchase order</button>
        </div>
      </div>
    </>
  )
}
