import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HIGH_MARGIN_THRESHOLD_PCT, isHighMargin, marginPct } from '../margin'
import { createTransfer, useDb } from '../store'
import type { TransferLine } from '../types'

interface Line extends TransferLine { key: number }

export default function NewTransfer() {
  const db = useDb()
  const nav = useNavigate()
  const [machineId, setMachineId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState('')
  const [cat, setCat] = useState('')
  const [sub, setSub] = useState('')

  const batchesFor = (sku: string) =>
    db.batches.filter((b) => b.sku === sku && b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry)) // FEFO

  const addLine = (sku = '') => {
    const first = sku ? batchesFor(sku)[0] : undefined
    setLines((ls) => [...ls, { key: Date.now() + ls.length, sku, batchNo: first?.batchNo ?? '', qty: 0 }])
  }
  const patch = (key: number, p: Partial<TransferLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))

  const categories = [...new Set(db.items.map((i) => i.category))]
  const subs = [...new Set(db.items.filter((i) => !cat || i.category === cat).map((i) => i.subcategory))]

  const suggestions = useMemo(
    () =>
      db.items
        .filter((i) => isHighMargin(i) && batchesFor(i.sku).length > 0 && !lines.some((l) => l.sku === i.sku))
        .filter((i) => !cat || i.category === cat)
        .filter((i) => !sub || i.subcategory === sub)
        .sort((a, b) => marginPct(b) - marginPct(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, lines, cat, sub],
  )

  const submit = () => {
    const r = createTransfer(machineId, lines.map(({ sku, batchNo, qty }) => ({ sku, batchNo, qty })))
    if (!r.ok) return setError(r.error)
    nav('/transfers')
  }

  return (
    <>
      <h2>New Transfer Order</h2>
      <p className="sub">Head office → vending machine. Batch selection mirrors Zoho Books (expiry/lot tracking).</p>

      <div className="card">
        <div className="row">
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Select vending machine…</option>
            {db.machines.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.location}</option>)}
          </select>
          <select value={cat} onChange={(e) => { setCat(e.target.value); setSub('') }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">All subcategories</option>
            {subs.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="card suggest">
        <strong>High-margin items (≥ {HIGH_MARGIN_THRESHOLD_PCT}%)</strong>
        <div className="chips" style={{ marginTop: 8 }}>
          {suggestions.length === 0 && <span className="empty">No more suggestions for this filter.</span>}
          {suggestions.map((i) => (
            <button key={i.sku} className="chip" onClick={() => addLine(i.sku)} title={`${i.category} / ${i.subcategory}`}>
              + {i.name} · {marginPct(i).toFixed(0)}%
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Item</th><th>Batch (expiry · available)</th><th className="num">Qty</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <select value={l.sku} onChange={(e) => patch(l.key, { sku: e.target.value, batchNo: batchesFor(e.target.value)[0]?.batchNo ?? '' })}>
                    <option value="">Select item…</option>
                    {db.items
                      .filter((i) => (!cat || i.category === cat) && (!sub || i.subcategory === sub) || i.sku === l.sku)
                      .map((i) => <option key={i.sku} value={i.sku}>{i.sku} · {i.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={l.batchNo} onChange={(e) => patch(l.key, { batchNo: e.target.value })}>
                    <option value="">Select batch…</option>
                    {batchesFor(l.sku).map((b) => <option key={b.batchNo} value={b.batchNo}>{b.batchNo} · {b.expiry} · {b.qty}</option>)}
                  </select>
                </td>
                <td className="num"><input type="number" min={0} style={{ width: 80 }} value={l.qty || ''} onChange={(e) => patch(l.key, { qty: Number(e.target.value) })} /></td>
                <td><button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => addLine()}>+ Add line</button>
          <span className="spacer" />
          {error && <span className="err">{error}</span>}
          <button className="primary" onClick={submit}>Create transfer order</button>
        </div>
      </div>
    </>
  )
}
