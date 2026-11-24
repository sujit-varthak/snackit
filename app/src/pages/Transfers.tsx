import { Link } from 'react-router-dom'
import { api } from '../api'
import { Gate, useLoad } from '../useLoad'

export default function Transfers() {
  const transfers = useLoad(() => api.transfers())
  const machines = useLoad(() => api.machines())

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
      <Gate states={[transfers, machines]}>
        <div className="card">
          {(transfers.data ?? []).length === 0 ? (
            <div className="empty">No transfer orders yet.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Order</th><th>Date</th><th>Machine</th><th>Lines</th><th className="num">Units</th><th>Zoho Books</th></tr>
              </thead>
              <tbody>
                {[...(transfers.data ?? [])].reverse().map((t) => (
                  <tr key={t.transfer_no}>
                    <td>{t.transfer_no}</td><td>{t.transfer_date}</td>
                    <td>{t.machine_code} · {machines.data?.find((m) => m.machine_code === t.machine_code)?.location}</td>
                    <td>{t.lines.map((l) => `${l.sku} (${l.batch_no}) ×${l.qty}`).join(', ')}</td>
                    <td className="num">{t.lines.reduce((s, l) => s + l.qty, 0)}</td>
                    <td>
                      <span className={`badge ${t.zoho_sync === 'synced' ? 'ok' : t.zoho_sync === 'failed' ? 'bad' : 'warn'}`}>
                        {t.zoho_sync === 'synced' ? 'Synced' : t.zoho_sync === 'failed' ? 'Failed' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">Sending orders to Zoho is the next step in this slice. Until then every order stays Pending.</p>
        </div>
      </Gate>
    </>
  )
}
