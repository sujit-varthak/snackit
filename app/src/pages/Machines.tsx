import { useState } from 'react'
import { api, ApiError, getRole, type ApiMachine } from '../api'
import { Gate, useLoad } from '../useLoad'

const blank: ApiMachine = { machine_code: '', name: '', location: '', area: '', custodian: '', staff_emails: '', active: true }
const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')

export default function Machines() {
  const isAdmin = getRole() === 'admin'
  const machines = useLoad(() => api.machines())
  const stock = useLoad(() => api.stock())
  const [form, setForm] = useState<ApiMachine | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const units = (code: string) => (stock.data ?? []).filter((r) => r.machine_code === code).reduce((s, r) => s + r.qty, 0)
  const set = (p: Partial<ApiMachine>) => setForm((f) => (f ? { ...f, ...p } : f))
  const open = (m: ApiMachine | null) => {
    setForm(m ? { ...m } : { ...blank })
    setAdding(!m)
    setError('')
    setDone('')
  }

  const save = async () => {
    if (!form) return
    setBusy(true)
    setError('')
    try {
      const saved = adding ? await api.createMachine(form) : await api.updateMachine(form)
      setDone(`${adding ? 'Added' : 'Saved'} ${saved.machine_code}.`)
      setForm(null)
      machines.reload()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (code: string) => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      await api.deleteMachine(code)
      setDone(`Deleted ${code}.`)
      machines.reload()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
      setConfirmDelete('')
    }
  }

  return (
    <>
      <div className="row">
        <div>
          <h2>Vending Machines</h2>
          <p className="sub">The machine code is fixed once added: it is in the stock, the history and the "Vending Machine" field on Zoho transfers.</p>
        </div>
        <span className="spacer" />
        {isAdmin && <button className="primary" onClick={() => open(null)}>Add machine</button>}
      </div>

      {form && (
        <div className="card">
          <strong>{adding ? 'Add a machine' : `Edit ${form.machine_code}`}</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <label>Code <input id="m-code" value={form.machine_code} disabled={!adding} placeholder="VM-006" onChange={(e) => set({ machine_code: e.target.value.toUpperCase() })} /></label>
            <label>Name <input id="m-name" value={form.name} placeholder="Vending Machine 6" onChange={(e) => set({ name: e.target.value })} /></label>
            <label>Location <input id="m-location" value={form.location} placeholder="Tech Park Tower C" onChange={(e) => set({ location: e.target.value })} /></label>
            <label>Area <input id="m-area" value={form.area} onChange={(e) => set({ area: e.target.value })} /></label>
            <label>Custodian <input id="m-custodian" value={form.custodian} onChange={(e) => set({ custodian: e.target.value })} /></label>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>Staff who may see it (emails, comma-separated)
              <input id="m-staff" style={{ width: '100%' }} value={form.staff_emails} placeholder="ravi@example.com, anita@example.com" onChange={(e) => set({ staff_emails: e.target.value })} />
            </label>
            <label><input id="m-active" type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> In service</label>
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : adding ? 'Add machine' : 'Save changes'}</button>
            <button onClick={() => setForm(null)}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </div>
      )}
      {!form && error && <p className="err">{error}</p>}
      {done && <p className="okmsg">{done}</p>}

      <Gate states={[machines, stock]}>
        <div className="card">
          <table>
            <thead>
              <tr><th>Code</th><th>Name</th><th>Location</th><th>Area</th><th>Custodian</th><th className="num">Units</th><th>Status</th>{isAdmin && <th />}</tr>
            </thead>
            <tbody>
              {(machines.data ?? []).map((m) => (
                <tr key={m.machine_code}>
                  <td>{m.machine_code}</td><td>{m.name}</td><td>{m.location}</td><td>{m.area}</td><td>{m.custodian}</td>
                  <td className="num">{units(m.machine_code)}</td>
                  <td><span className={`badge ${m.active ? 'ok' : 'warn'}`}>{m.active ? 'In service' : 'Inactive'}</span></td>
                  {isAdmin && (
                    <td>
                      {confirmDelete === m.machine_code ? (
                        <span className="row" style={{ margin: 0 }}>
                          <span className="err">Delete {m.machine_code}?</span>
                          <button disabled={busy} onClick={() => remove(m.machine_code)}>Yes, delete</button>
                          <button onClick={() => setConfirmDelete('')}>Cancel</button>
                        </span>
                      ) : (
                        <>
                          <button onClick={() => open(m)}>Edit</button>{' '}
                          <button onClick={() => { setConfirmDelete(m.machine_code); setError(''); setDone('') }}>Delete</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">A machine can be deleted only when it holds no stock and has no history. Otherwise untick "In service" so its history stays.</p>
        </div>
      </Gate>
    </>
  )
}
