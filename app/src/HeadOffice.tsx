import { useState } from 'react'
import { api, ApiError, getRole } from './api'
import { useLoad } from './useLoad'

// Head-office stock as the app holds it, next to what Zoho reports. Managers and admins only.
export default function HeadOffice() {
  const role = getRole()
  const ho = useLoad(() => (role === 'field' ? Promise.resolve(null) : api.zohoHeadOffice()))
  const items = useLoad(() => api.items())
  const status = useLoad(() => (role === 'field' ? Promise.resolve(null) : api.zohoStatus()))
  const [msg, setMsg] = useState('')
  if (role === 'field') return null

  const data = ho.data
  const name = (sku: string) => items.data?.find((i) => i.sku === sku)?.name ?? sku
  const rows = data?.rows ?? []
  const checks = rows.filter((r) => r.status === 'check').length

  const toggleDown = async (down: boolean) => {
    setMsg('')
    try {
      await api.devZoho(down)
      status.reload()
      ho.reload()
    } catch (e) {
      setMsg(e instanceof ApiError || e instanceof Error ? e.message : 'Could not change.')
    }
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>Head-office stock: app against Zoho</strong>
          <div className="hint">Fetched from Zoho when you open or refresh this page. Machine stock is not in Zoho and is not shown here.</div>
        </div>
        <span className="spacer" />
        {data && <span className={`badge ${data.mode === 'live' ? 'ok' : 'warn'}`}>{data.mode === 'live' ? 'Live Zoho' : 'Simulated Zoho'}</span>}
        <button onClick={() => ho.reload()} disabled={ho.loading}>{ho.loading ? 'Fetching…' : 'Refresh from Zoho'}</button>
      </div>
      {data?.mode === 'simulated' && (
        <label className="hint"><input type="checkbox" checked={status.data ? !status.data.up : false} onChange={(e) => toggleDown(e.target.checked)} /> Simulate a Zoho outage (test switch)</label>
      )}
      {msg && <p className="err">{msg}</p>}
      {ho.error && <p className="err">{ho.error}</p>}
      {data && !data.ok && <p className="err">Zoho could not be read: {data.error}. The app's own head-office stock is still correct.</p>}
      {data?.ok && (
        <>
          <p className={checks ? 'err' : 'hint'}>{checks ? `${checks} batch${checks > 1 ? 'es need' : ' needs'} checking.` : 'Every difference below is explained, or there are none.'}</p>
          <table>
            <thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th className="num">In the app</th><th className="num">In Zoho</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.batch_key}>
                  <td>{r.sku} · {name(r.sku)}</td><td>{r.batch_no}</td><td>{r.expiry}</td>
                  <td className="num">{r.app_qty}</td><td className="num">{r.zoho_qty}</td>
                  <td>
                    <span className={`badge ${r.status === 'match' ? 'ok' : r.status === 'explained' ? 'warn' : 'bad'}`}>
                      {r.status === 'match' ? 'Match' : r.status === 'explained' ? 'Explained' : 'Check'}
                    </span>{' '}
                    {r.why && <span className="hint">{r.why}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
