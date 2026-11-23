import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { resetDemoData } from './store'
import Dashboard from './pages/Dashboard'
import Machines from './pages/Machines'
import Transfers from './pages/Transfers'
import NewTransfer from './pages/NewTransfer'
import Consumption from './pages/Consumption'

const nav = [
  ['/', 'Stock Dashboard'],
  ['/transfers', 'Transfer Orders'],
  ['/consumption', 'Consumption'],
  ['/machines', 'Machines'],
] as const

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Snackit</h1>
        <nav>
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          className="link"
          onClick={() => confirm('Reset all demo data?') && resetDemoData()}
          title="Local demo data only"
        >
          Reset demo data
        </button>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/transfers/new" element={<NewTransfer />} />
          <Route path="/consumption" element={<Consumption />} />
          <Route path="/machines" element={<Machines />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
