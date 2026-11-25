import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, getRole, type ApiTransfer } from '../api'
import { Gate, useLoad } from '../useLoad'

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.')

function ZohoPill({ t }: { t: ApiTransfer }) {
  if (t.zoho_sync === 'synced') return <span className="badge ok">In Zoho</span>
  if (t.zoho_sync === 'failed') return <span className="badge bad">Export failed</span>
  return <span className="badge warn">Not exported</span>
}

export default function Transfers() {
  const canManage = getRole() !== 'field'
  const transfers = useLoad(() => api.transfers())
  const machines = useLoad(() => api.machines())
  const [busy, setBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const exportOne = async (no: string) => {
    setBusy(no)
    setError('')
    setDone('')
    try {
      const t = await api.exportTransfer(no)
      if (t.zoho_sync === 'synced') setDone(`${no} is now in Zoho.`)
      else setError(`${no} was not exported: ${t.zoho_error}`)
      transfers.reload()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }

  const remove = async (no: string) => {
    setBusy(no)
    setError('')
    setDone('')
    try {
      await api.deleteTransfer(no)
      setDone(`Deleted ${no}. Its stock is back at head office.`)
      transfers.reload()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
      setConfirmDelete('')
    }
  }

  return (
    <>
      <div className="row">
        <div>
          <h2>Transfer Orders</h2>
          <p className="sub">Head office → vending machine. "Export to Zoho" creates the same transfer in Zoho, from the main warehouse to the Vending Machine location, with this machine in the "Vending Machine" field. An exported transfer is locked here; correct it with a new transfer.</p>
        </div>
        <span className="spacer" />
        {canManage && <Link to="/transfers/new"><button className="primary">New transfer order</button></Link>}
      </div>
      {error && <p className="err">{error}</p>}
      {done && <p className="okmsg">{done}</p>}
      <Gate states={[transfers, machines]}>
        <div className="card">
          {(transfers.data ?? []).length === 0 ? (
            <div className="empty">No transfer orders yet.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Order</th><th>Date</th><th>Machine</th><th>Lines</th><th className="num">Units</th><th>Zoho</th>{canManage && <th />}</tr>
              </thead>
              <tbody>
                {[...(transfers.data ?? [])].reverse().map((t) => (
                  <tr key={t.transfer_no}>
                    <td>{t.transfer_no}</td><td>{t.transfer_date}</td>
                    <td>{t.machine_code} · {machines.data?.find((m) => m.machine_code === t.machine_code)?.location}</td>
                    <td>{t.lines.map((l) => `${l.sku} (${l.batch_no}) ×${l.qty}`).join(', ')}</td>
                    <td className="num">{t.lines.reduce((s, l) => s + l.qty, 0)}</td>
                    <td>
                      <ZohoPill t={t} />
                      {t.zoho_sync === 'failed' && t.zoho_error && <div className="hint" style={{ maxWidth: 280, whiteSpace: 'normal' }}>{t.zoho_error}</div>}
                    </td>
                    {canManage && (
                      <td>
                        {t.zoho_sync === 'synced' ? (
                          <span className="hint">Locked</span>
                        ) : confirmDelete === t.transfer_no ? (
                          <span className="row" style={{ margin: 0 }}>
                            <span className="err">Delete {t.transfer_no}? Stock returns to head office.</span>
                            <button disabled={busy === t.transfer_no} onClick={() => remove(t.transfer_no)}>Yes, delete</button>
                            <button onClick={() => setConfirmDelete('')}>Cancel</button>
                          </span>
                        ) : (
                          <>
                            <button className="primary" disabled={busy === t.transfer_no} onClick={() => exportOne(t.transfer_no)}>
                              {busy === t.transfer_no ? 'Exporting…' : t.zoho_sync === 'failed' ? 'Retry export' : 'Export to Zoho'}
                            </button>{' '}
                            <Link to={`/transfers/${encodeURIComponent(t.transfer_no)}/edit`}><button>Edit</button></Link>{' '}
                            <button onClick={() => { setConfirmDelete(t.transfer_no); setError(''); setDone('') }}>Delete</button>
                          </>
                        )}
                      </td>
                    )}
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
