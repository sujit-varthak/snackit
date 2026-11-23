import { useMemo, useState } from 'react'
import { useDb } from '../store'

export default function Dashboard() {
  const db = useDb()
  const [machine, setMachine] = useState('')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return db.machineStock
      .filter((r) => !machine || r.machineId === machine)
      .map((r) => {
        const item = db.items.find((i) => i.sku === r.sku)
        const m = db.machines.find((x) => x.id === r.machineId)
        const batch = db.batches.find((b) => b.sku === r.sku && b.batchNo === r.batchNo)
        return { ...r, item, m, expiry: batch?.expiry ?? '' }
      })
      .filter((r) => !term || `${r.sku} ${r.item?.name} ${r.batchNo}`.toLowerCase().includes(term))
      .sort((a, b) => a.machineId.localeCompare(b.machineId) || a.sku.localeCompare(b.sku))
  }, [db, machine, q])

  const total = rows.reduce((s, r) => s + r.qty, 0)

  return (
    <>
      <h2>Location-wise Stock</h2>
      <p className="sub">Per-machine stock lives in this app only; Zoho Books holds one consolidated “vending machine” location.</p>
      <div className="card">
        <div className="row">
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">All machines</option>
            {db.machines.map((m) => (
              <option key={m.id} value={m.id}>{m.id} · {m.location}</option>
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
              <tr><th>Machine</th><th>Location</th><th>SKU</th><th>Item</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.machineId}|${r.sku}|${r.batchNo}`}>
                  <td>{r.machineId}</td><td>{r.m?.location}</td><td>{r.sku}</td><td>{r.item?.name}</td>
                  <td>{r.batchNo}</td><td>{r.expiry}</td><td className="num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
