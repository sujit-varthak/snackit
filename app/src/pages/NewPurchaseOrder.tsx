import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Gate, useLoad } from '../useLoad'

interface Line { key: number; sku: string; qty: string; rate: string }

export default function NewPurchaseOrder() {
  const vendors = useLoad(() => api.vendors())
  const items = useLoad(() => api.items())
  const nav = useNavigate()
  const [vendor, setVendor] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 0, sku: '', qty: '', rate: '' }])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      await api.createPo({
        vendor_code: vendor,
        lines: lines.filter((l) => l.sku || l.qty).map((l) => ({ sku: l.sku, qty: Number(l.qty), rate: Number(l.rate) })),
      })
      nav('/purchase-orders')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>New Purchase Order</h2>
      <p className="sub">Order stock from a vendor. The order is saved here first, then sent to Zoho.</p>
      <Gate states={[vendors, items]}>
        <div className="card">
          <div className="row">
            <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">Select vendor…</option>
              {(vendors.data ?? []).filter((v) => v.active).map((v) => <option key={v.vendor_code} value={v.vendor_code}>{v.vendor_code} · {v.name}</option>)}
            </select>
          </div>
          <table>
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    <select value={l.sku} onChange={(e) => patch(l.key, { sku: e.target.value, rate: String((items.data ?? []).find((i) => i.sku === e.target.value)?.cost ?? '') })}>
                      <option value="">Select item…</option>
                      {(items.data ?? []).map((i) => <option key={i.sku} value={i.sku}>{i.sku} · {i.name}</option>)}
                    </select>
                  </td>
                  <td className="num"><input type="number" min={1} step={1} style={{ width: 80 }} value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></td>
                  <td className="num"><input type="number" min={0} style={{ width: 80 }} value={l.rate} onChange={(e) => patch(l.key, { rate: e.target.value })} /></td>
                  <td className="num">{((Number(l.qty) || 0) * (Number(l.rate) || 0)).toFixed(2)}</td>
                  <td><button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={() => setLines((ls) => [...ls, { key: Date.now(), sku: '', qty: '', rate: '' }])}>+ Add line</button>
            <span className="spacer" />
            <strong>Total ₹{total.toFixed(2)}</strong>
            {error && <span className="err">{error}</span>}
            <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create purchase order'}</button>
          </div>
        </div>
      </Gate>
    </>
  )
}
