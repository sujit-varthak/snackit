import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, getRole } from '../api'
import { HIGH_MARGIN_THRESHOLD_PCT, isHighMargin, marginPct } from '../margin'
import { Gate, useLoad } from '../useLoad'

interface Line { key: number; sku: string; batch: string; qty: string }

// Creates a transfer, or edits one at /transfers/:no/edit.
export default function NewTransfer() {
  const { no } = useParams()
  const editing = Boolean(no)
  const role = getRole()
  const machines = useLoad(() => api.machines())
  const items = useLoad(() => api.items())
  const batches = useLoad(() => (role === 'field' ? Promise.resolve([]) : api.batches()))
  const transfers = useLoad(() => (editing ? api.transfers() : Promise.resolve([])))
  const nav = useNavigate()
  const [machineCode, setMachineCode] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [prefilled, setPrefilled] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cat, setCat] = useState('')
  const [sub, setSub] = useState('')

  const original = editing ? transfers.data?.find((t) => t.transfer_no === no) : undefined

  // Fill the form once with the transfer being edited.
  useEffect(() => {
    if (!original || prefilled) return
    setMachineCode(original.machine_code)
    setLines(original.lines.map((l, i) => ({ key: i, sku: l.sku, batch: l.batch_no, qty: String(l.qty) })))
    setPrefilled(true)
  }, [original, prefilled])

  const itemList = items.data ?? []
  // While editing, the stock this transfer already took goes back to head office on save, so it counts as available.
  const giveBack = (sku: string, batchNo: string) =>
    (original?.lines ?? []).filter((l) => l.sku === sku && l.batch_no === batchNo).reduce((s, l) => s + l.qty, 0)
  const batchesFor = (sku: string) =>
    (batches.data ?? [])
      .filter((b) => b.sku === sku)
      .map((b) => ({ ...b, qty: b.qty + giveBack(b.sku, b.batch_no) }))
      .filter((b) => b.qty > 0)
      .sort((a, b) => a.expiry.localeCompare(b.expiry)) // earliest expiry first

  const addLine = (sku = '') => {
    const first = sku ? batchesFor(sku)[0] : undefined
    setLines((ls) => [...ls, { key: Date.now() + ls.length, sku, batch: first?.batch_no ?? '', qty: '' }])
  }
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))

  const categories = [...new Set(itemList.map((i) => i.category))]
  const subs = [...new Set(itemList.filter((i) => !cat || i.category === cat).map((i) => i.subcategory))]
  const suggestions = itemList
    .filter((i) => isHighMargin(i) && batchesFor(i.sku).length > 0 && !lines.some((l) => l.sku === i.sku))
    .filter((i) => (!cat || i.category === cat) && (!sub || i.subcategory === sub))
    .sort((a, b) => marginPct(b) - marginPct(a))

  const submit = async () => {
    setError('')
    const payload = {
      machine_code: machineCode,
      lines: lines.filter((l) => l.sku || l.batch || l.qty).map((l) => ({ sku: l.sku, batch_no: l.batch, qty: Number(l.qty) })),
    }
    setBusy(true)
    try {
      if (editing && no) await api.updateTransfer(no, payload)
      else await api.createTransfer(payload)
      nav('/transfers')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')
      batches.reload() // quantities may have changed
    } finally {
      setBusy(false)
    }
  }

  const title = editing ? `Edit Transfer ${no}` : 'New Transfer Order'
  if (role === 'field') {
    return (
      <>
        <h2>{title}</h2>
        <div className="card"><p className="err">Transfer orders are for managers and admins. Switch role in the sidebar to try it.</p></div>
      </>
    )
  }
  if (editing && transfers.data && !original) {
    return <><h2>{title}</h2><div className="card"><p className="err">Transfer {no} was not found.</p></div></>
  }
  if (original?.zoho_sync === 'synced') {
    return <><h2>{title}</h2><div className="card"><p className="err">{no} is already in Zoho, so it cannot be changed here. Correct it with a new transfer.</p></div></>
  }

  return (
    <>
      <h2>{title}</h2>
      <p className="sub">
        {editing
          ? 'Saving puts the old quantities back at head office, then moves the new ones. Refused if the machine has already consumed some of this stock.'
          : 'Head office → vending machine. Stock is checked on the server before anything moves.'}
      </p>
      <Gate states={[machines, items, batches, transfers]}>
        <div className="card">
          <div className="row">
            <select value={machineCode} onChange={(e) => setMachineCode(e.target.value)}>
              <option value="">Select vending machine…</option>
              {(machines.data ?? []).filter((m) => m.active || m.machine_code === machineCode).map((m) => <option key={m.machine_code} value={m.machine_code}>{m.machine_code} · {m.location}</option>)}
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
                    <select value={l.sku} onChange={(e) => patch(l.key, { sku: e.target.value, batch: batchesFor(e.target.value)[0]?.batch_no ?? '' })}>
                      <option value="">Select item…</option>
                      {itemList
                        .filter((i) => ((!cat || i.category === cat) && (!sub || i.subcategory === sub)) || i.sku === l.sku)
                        .map((i) => <option key={i.sku} value={i.sku}>{i.sku} · {i.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={l.batch} onChange={(e) => patch(l.key, { batch: e.target.value })}>
                      <option value="">Select batch…</option>
                      {batchesFor(l.sku).map((b) => <option key={b.batch_key} value={b.batch_no}>{b.batch_no} · {b.expiry} · {b.qty}</option>)}
                    </select>
                  </td>
                  <td className="num"><input type="number" min={1} step={1} style={{ width: 80 }} value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></td>
                  <td><button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => addLine()}>+ Add line</button>
            <span className="spacer" />
            {error && <span className="err">{error}</span>}
            {editing && <button onClick={() => nav('/transfers')}>Cancel</button>}
            <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create transfer order'}</button>
          </div>
        </div>
      </Gate>
    </>
  )
}
