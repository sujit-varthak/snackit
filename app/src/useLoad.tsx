import { useEffect, useState, type ReactNode } from 'react'

// Loads data from the API and keeps loading and error state, so every screen handles both.
export function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    fn()
      .then((d) => {
        if (live) {
          setData(d)
          setError('')
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // fn is recreated every render; reload() is the only trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return { data, error, loading, reload: () => setTick((t) => t + 1) }
}

// Shows the loading or error state; renders children only when every query has data.
export function Gate({ states, children }: { states: { loading: boolean; error: string; reload: () => void }[]; children: ReactNode }) {
  const error = states.find((s) => s.error)
  if (error) {
    return (
      <div className="card">
        <p className="err">{error.error}</p>
        <div><button onClick={() => states.forEach((s) => s.reload())}>Try again</button></div>
      </div>
    )
  }
  if (states.some((s) => s.loading)) return <div className="card"><p className="sub">Loading…</p></div>
  return <>{children}</>
}
