import { useState } from 'react'
import { readSheet } from 'read-excel-file/browser'
import { applyConsumption, useDb } from '../store'
import type { ConsumptionLine } from '../types'

// Expected columns (header row): Machine ID | SKU | Quantity   — TODO: confirm real layout with client.
const HEADERS = ['machine id', 'sku', 'quantity']

async function parseFile(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) {
    return (await file.text()).split(/\r?\n/).filter(Boolean).map((l) => l.split(',').map((c) => c.trim()))
  }
  const rows = await readSheet(file) // first sheet
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c).trim())))
}

export default function Consumption() {
  const db = useDb()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<ConsumptionLine[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  const onFile = async (file?: File) => {
    setMsg(''); setErrors([]); setLines([])
    if (!file) return
    try {
      const rows = await parseFile(file)
      const head = (rows[0] ?? []).map((h) => h.toLowerCase())
      if (HEADERS.some((h, i) => head[i] !== h)) {
        return setErrors([`Header row must be: Machine ID, SKU, Quantity`])
      }
      const errs: string[] = []
      const out: ConsumptionLine[] = []
      rows.slice(1).forEach((r, i) => {
        const [machineId, sku, q] = r
        const qty = Number(q)
        if (!db.machines.some((m) => m.id === machineId)) errs.push(`Row ${i + 2}: unknown machine "${machineId}"`)
        else if (!db.items.some((x) => x.sku === sku)) errs.push(`Row ${i + 2}: unknown SKU "${sku}"`)
        else if (!Number.isFinite(qty) || qty <= 0) errs.push(`Row ${i + 2}: invalid quantity "${q}"`)
        else out.push({ machineId, sku, qty })
      })
      setErrors(errs); setLines(out)
    } catch (e) {
      setErrors([`Could not read file: ${(e as Error).message}`])
    }
  }

  const apply = () => {
    if (db.consumption.some((c) => c.date === date) && !confirm(`A report for ${date} was already applied. Apply again?`)) return
    const r = applyConsumption(date, lines)
    if (!r.ok) return setErrors([r.error])
    setMsg(`Applied ${lines.length} lines.${r.value.shortfalls.length ? ' Warnings: ' + r.value.shortfalls.join('; ') : ''}`)
    setLines([])
  }

  // Consolidated per-SKU file for the Zoho Books invoice upload (stock deducts from the single consolidated location).
  const download = (reportId: string) => {
    const rep = db.consumption.find((c) => c.id === reportId)
    if (!rep) return
    const bySku = new Map<string, number>()
    rep.lines.forEach((l) => bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + l.qty))
    const csv = ['SKU,Item Name,Quantity,Rate'].concat(
      [...bySku].map(([sku, qty]) => {
        const it = db.items.find((i) => i.sku === sku)
        return `${sku},"${it?.name ?? ''}",${qty},${it?.price ?? ''}`
      }),
    ).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `consumption-${rep.date}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <h2>Daily Consumption</h2>
      <p className="sub">Upload Excel/CSV (Machine ID, SKU, Quantity). Deducts per-machine stock here; download the consolidated file for the Zoho Books invoice.</p>

      <div className="card">
        <div className="row">
          <label>Consumption date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {errors.length > 0 && <ul className="err">{errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}{errors.length > 10 && <li>…and {errors.length - 10} more</li>}</ul>}
        {msg && <p className="okmsg">{msg}</p>}
        {lines.length > 0 && (
          <>
            <p>{lines.length} valid lines ready ({lines.reduce((s, l) => s + l.qty, 0)} units).</p>
            <button className="primary" disabled={errors.length > 0} onClick={apply}>Apply to machine stock</button>
            {errors.length > 0 && <span className="err"> Fix errors first.</span>}
          </>
        )}
      </div>

      <div className="card">
        <strong>Uploaded reports</strong>
        {db.consumption.length === 0 ? <div className="empty">None yet.</div> : (
          <table>
            <thead><tr><th>Report</th><th>Date</th><th className="num">Lines</th><th className="num">Units</th><th /></tr></thead>
            <tbody>
              {db.consumption.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td><td>{c.date}</td><td className="num">{c.lines.length}</td>
                  <td className="num">{c.lines.reduce((s, l) => s + l.qty, 0)}</td>
                  <td><button onClick={() => download(c.id)}>Download for Zoho</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
