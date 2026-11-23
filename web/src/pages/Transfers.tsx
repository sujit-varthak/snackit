import { useState } from 'react'
import { Link } from 'react-router-dom'
import { markTransferSynced, useDb } from '../store'
import { syncTransferToZoho } from '../zoho'

export default function Transfers() {
  const db = useDb()
  const [busy, setBusy] = useState('')

  const sync = async (id: string) => {
    const t = db.transfers.find((x) => x.id === id)
    if (!t) return
    setBusy(id)
    try {
      const { ref } = await syncTransferToZoho(t)
      markTransferSynced(id, ref)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div className="row">
        <div>
          <h2>Transfer Orders</h2>
          <p className="sub">Head office → vending machine. History of what went where.</p>
        </div>
        <span className="spacer" />
        <Link to="/transfers/new"><button className="primary">New transfer order</button></Link>
      </div>
      <div className="card">
        {db.transfers.length === 0 ? (
          <div className="empty">No transfer orders yet.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Order</th><th>Date</th><th>Machine</th><th>Lines</th><th className="num">Units</th><th>Zoho Books</th></tr>
            </thead>
            <tbody>
              {db.transfers.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td><td>{t.date}</td>
                  <td>{t.machineId} · {db.machines.find((m) => m.id === t.machineId)?.location}</td>
                  <td>{t.lines.map((l) => `${l.sku} (${l.batchNo}) ×${l.qty}`).join(', ')}</td>
                  <td className="num">{t.lines.reduce((s, l) => s + l.qty, 0)}</td>
                  <td>
                    {t.zohoSync === 'synced' ? (
                      <span className="badge ok">{t.zohoRef}</span>
                    ) : (
                      <button disabled={busy === t.id} onClick={() => sync(t.id)}>{busy === t.id ? 'Syncing…' : 'Sync (demo)'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
