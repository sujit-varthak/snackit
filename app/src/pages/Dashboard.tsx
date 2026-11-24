import { useMemo, useState } from 'react'
import { api } from '../api'
import { Gate, useLoad } from '../useLoad'

const LOW = 10 // placeholder alert level; becomes a per-item setting later

export default function Dashboard() {
  const stock = useLoad(() => api.stock())
  const machines = useLoad(() => api.machines())
  const items = useLoad(() => api.items())
  const [machine, setMachine] = useState('')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const totals = new Map<string, number>()
    for (const r of stock.data ?? []) totals.set(`${r.machine_code}|${r.sku}`, (totals.get(`${r.machine_code}|${r.sku}`) ?? 0) + r.qty)
    return (stock.data ?? [])
      .filter((r) => !machine || r.machine_code === machine)
      .map((r) => ({
        ...r,
        item: items.data?.find((i) => i.sku === r.sku),
        m: machines.data?.find((x) => x.machine_code === r.machine_code),
        low: (totals.get(`${r.machine_code}|${r.sku}`) ?? 0) <= LOW,
      }))
      .filter((r) => !term || `${r.sku} ${r.item?.name} ${r.batch_no}`.toLowerCase().includes(term))
      .sort((a, b) => a.machine_code.localeCompare(b.machine_code) || a.sku.localeCompare(b.sku))
  }, [stock.data, machines.data, items.data, machine, q])

  const total = rows.reduce((s, r) => s + r.qty, 0)

  return (
    <>
      <h2>Location-wise Stock</h2>
      <p className="sub">Stock per machine lives in this app only; Zoho Books holds one combined “vending machine” location.</p>
      <Gate states={[stock, machines, items]}>
        <div className="card">
          <div className="row">
            <select value={machine} onChange={(e) => setMachine(e.target.value)}>
              <option value="">All machines</option>
              {(machines.data ?? []).map((m) => (
                <option key={m.machine_code} value={m.machine_code}>{m.machine_code} · {m.location}</option>
              ))}
            </select>
            <input placeholder="Search SKU, item, batch" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="spacer" />
            <strong>{total} units</strong>
          </div>
          {rows.length === 0 ? (
            <div className="empty">No stock yet. Create a transfer order to load a machine.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Machine</th><th>Location</th><th>SKU</th><th>Item</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.stock_key}>
                    <td>{r.machine_code}</td><td>{r.m?.location}</td><td>{r.sku}</td><td>{r.item?.name}</td>
                    <td>{r.batch_no}</td><td>{r.expiry}</td><td className="num">{r.qty}</td>
                    <td>{r.low && <span className="badge warn">Low</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Gate>
    </>
  )
}
