import { useState } from 'react'
import { readSheet } from 'read-excel-file/browser'
import { api, ApiError, type ApiConsumptionLine, type ApiReport, type ApiRowError } from '../api'
import { Gate, useLoad } from '../useLoad'

// Expected columns (header row): Machine ID | SKU | Quantity   — TODO: confirm real layout with client.
const HEADERS = ['machine id', 'sku', 'quantity']

async function parseFile(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) {
    return (await file.text()).split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim()))
  }
  const rows = await readSheet(file) // first sheet
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c).trim())))
}

const csvCell = (v: string | number) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

export default function Consumption() {
  const reports = useLoad(() => api.consumption())
  const items = useLoad(() => api.items())
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<ApiConsumptionLine[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileRows, setFileRows] = useState<number[]>([])

  // The server names a line by its position; this turns it back into the row of the file.
  const describe = (list: ApiRowError[], at: number[]) => list.map((e) => (e.row ? `Row ${at[e.row - 1] ?? e.row}: ${e.message}` : e.message))

  const onFile = async (file?: File) => {
    setMsg(''); setErrors([]); setLines([])
    if (!file) return
    setBusy(true)
    try {
      const rows = await parseFile(file)
      const head = (rows[0] ?? []).map((h) => h.toLowerCase())
      if (HEADERS.some((h, i) => head[i] !== h)) {
        return setErrors([`Header row must be: Machine ID, SKU, Quantity`])
      }
      const numbered = rows.map((cells, i) => ({ cells, row: i + 1 })).slice(1).filter((r) => r.cells.some(Boolean))
      const out = numbered.map(({ cells: [machine_code = '', sku = '', qty = ''] }) => ({ machine_code, sku, qty: Number(qty) }))
      const at = numbered.map((r) => r.row)
      const checked = await api.previewConsumption({ consumption_date: date, lines: out }) // the server checks; nothing changes yet
      setFileRows(at)
      setErrors(describe(checked.errors, at))
      setLines(out)
    } catch (e) {
      setErrors([`Could not check the file: ${message(e)}`])
    } finally {
      setBusy(false)
    }
  }

  const apply = async (confirmDuplicate = false) => {
    setBusy(true)
    setMsg('')
    try {
      const report = await api.applyConsumption({ consumption_date: date, lines, confirm_duplicate: confirmDuplicate })
      setMsg(`${report.report_no} applied: ${report.lines.reduce((s, l) => s + l.qty, 0)} units taken from machine stock.`)
      setLines([])
      setErrors([])
      reports.reload()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE' && !confirmDuplicate) {
        if (confirm(`${e.message} Apply again?`)) await apply(true)
        return
      }
      const rows = e instanceof ApiError ? (e.details.errors as ApiRowError[] | undefined) : undefined
      setErrors([message(e), ...describe(rows ?? [], fileRows)])
    } finally {
      setBusy(false)
    }
  }

  // Consolidated per-SKU file for the Zoho Books invoice upload (stock deducts from the single consolidated location).
  const download = (rep: ApiReport) => {
    const bySku = new Map<string, number>()
    rep.lines.forEach((l) => bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + l.qty))
    const csv = ['SKU,Item Name,Quantity,Rate'].concat(
      [...bySku].map(([sku, qty]) => {
        const it = items.data?.find((i) => i.sku === sku)
        return [sku, it?.name ?? '', qty, it?.price ?? ''].map(csvCell).join(',')
      }),
    ).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `consumption-${rep.consumption_date}.csv`
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
          <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {errors.length > 0 && <ul className="err">{errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}{errors.length > 10 && <li>…and {errors.length - 10} more</li>}</ul>}
        {msg && <p className="okmsg">{msg}</p>}
        {busy && <p className="hint">Working…</p>}
        {lines.length > 0 && (
          <>
            <p>{lines.length} lines in the file ({lines.reduce((s, l) => s + (l.qty || 0), 0)} units).</p>
            <button className="primary" disabled={busy || errors.length > 0} onClick={() => apply()}>Apply to machine stock</button>
            {errors.length > 0 && <span className="err"> Fix the file and upload it again.</span>}
          </>
        )}
      </div>

      <Gate states={[reports, items]}>
        <div className="card">
          <strong>Uploaded reports</strong>
          {(reports.data ?? []).length === 0 ? <div className="empty">None yet.</div> : (
            <table>
              <thead><tr><th>Report</th><th>Date</th><th>Uploaded by</th><th className="num">Lines</th><th className="num">Units</th><th /></tr></thead>
              <tbody>
                {[...(reports.data ?? [])].reverse().map((c) => (
                  <tr key={c.report_no}>
                    <td>{c.report_no}</td><td>{c.consumption_date}</td><td>{c.uploaded_by}</td><td className="num">{c.lines.length}</td>
                    <td className="num">{c.lines.reduce((s, l) => s + l.qty, 0)}</td>
                    <td><button onClick={() => download(c)}>Download for Zoho</button></td>
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
