import { useState } from 'react'
import { api, getRole, type ApiPull, type PullKind } from '../api'
import { Gate, useLoad } from '../useLoad'

const STEPS: [PullKind, string][] = [['items', 'Items'], ['vendors', 'Vendors'], ['batches', 'Head-office batches']]
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

export default function ZohoSync() {
  if (getRole() !== 'admin') {
    return (
      <>
        <h2>Fetch from Zoho</h2>
        <div className="card"><p className="err">Only an admin can fetch from Zoho. Switch role in the sidebar to try it.</p></div>
      </>
    )
  }
  return <Fetch />
}

function Fetch() {
  const status = useLoad(() => api.zohoStatus())
  const [results, setResults] = useState<Partial<Record<PullKind, ApiPull>>>({})
  const [running, setRunning] = useState('')
  const [error, setError] = useState('')

  // One step may take several calls: the server stops after a short while and says where to carry on.
  const pull = async (kind: PullKind) => {
    let after = ''
    let sum: ApiPull | undefined
    do {
      const r = await api.pull(kind, after)
      sum = sum
        ? { ...r, added: sum.added + r.added, updated: sum.updated + r.updated, unchanged: sum.unchanged + r.unchanged, skipped: [...sum.skipped, ...r.skipped], fetched: kind === 'batches' ? sum.fetched + r.fetched : r.fetched }
        : r
      setResults((all) => ({ ...all, [kind]: sum }))
      if (r.stopped) throw new Error(r.stopped)
      after = r.next
    } while (after)
  }

  const run = async () => {
    setError('')
    setResults({})
    let current = ''
    try {
      for (const [kind, label] of STEPS) { // items first: batches belong to items
        current = label
        setRunning(label)
        await pull(kind)
      }
    } catch (e) {
      setError(`${current}: ${message(e)} What was already fetched is saved; fetching again is safe.`)
    } finally {
      setRunning('')
    }
  }

  const skipped = STEPS.flatMap(([kind, label]) => (results[kind]?.skipped ?? []).map((s) => ({ ...s, label })))

  return (
    <>
      <h2>Fetch from Zoho</h2>
      <p className="sub">Copies items, vendors and head-office batches from Zoho into this app. Nothing is changed in Zoho, and nothing is deleted here.</p>
      <Gate states={[status]}>
        <div className="card">
          <div className="row">
            <span className={`badge ${status.data?.mode === 'live' ? 'ok' : 'warn'}`}>{status.data?.mode === 'live' ? 'Live Zoho' : 'Simulated Zoho'}</span>
            {status.data && !status.data.up && <span className="err">{status.data.error}</span>}
            <span className="spacer" />
            <button className="primary" disabled={!!running} onClick={run}>{running ? `Fetching ${running.toLowerCase()}…` : 'Fetch from Zoho'}</button>
          </div>
          {status.data?.mode === 'simulated' && <p className="hint">This is stand-in data inside the app, not your Zoho Books. See docs/connect.md to connect the real one.</p>}
          {error && <p className="err">{error}</p>}
          {Object.keys(results).length > 0 && (
            <table>
              <thead><tr><th>What</th><th className="num">Read from Zoho</th><th className="num">Added</th><th className="num">Updated</th><th className="num">Unchanged</th><th className="num">Not taken</th></tr></thead>
              <tbody>
                {STEPS.map(([kind, label]) => {
                  const r = results[kind]
                  return r && (
                    <tr key={kind}>
                      <td>{label}</td><td className="num">{r.fetched}</td><td className="num">{r.added}</td><td className="num">{r.updated}</td><td className="num">{r.unchanged}</td><td className="num">{r.skipped.length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Gate>
      {skipped.length > 0 && (
        <div className="card">
          <strong>Needs a look ({skipped.length})</strong>
          <table>
            <thead><tr><th>What</th><th>Record</th><th>Reason</th></tr></thead>
            <tbody>
              {skipped.map((s, i) => <tr key={i}><td>{s.label}</td><td>{s.ref}</td><td>{s.reason}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
