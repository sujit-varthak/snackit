import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { DEV_USERS, getRole, setRole, type Role } from './api'
import ZohoSync from './pages/ZohoSync'
import Dashboard from './pages/Dashboard'
import Machines from './pages/Machines'
import Transfers from './pages/Transfers'
import NewTransfer from './pages/NewTransfer'
import Consumption from './pages/Consumption'
import Vendors from './pages/Vendors'
import PurchaseOrders from './pages/PurchaseOrders'
import NewPurchaseOrder from './pages/NewPurchaseOrder'

const nav = [
  ['/', 'Stock Dashboard'],
  ['/transfers', 'Transfer Orders'],
  ['/consumption', 'Consumption'],
  ['/machines', 'Machines'],
  ['/vendors', 'Vendors'],
  ['/purchase-orders', 'Purchase Orders'],
  ['/zoho', 'Fetch from Zoho'],
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
        <label className="who">
          Signed in as
          <select
            value={getRole()}
            onChange={(e) => {
              setRole(e.target.value as Role)
              window.location.reload()
            }}
          >
            {(Object.keys(DEV_USERS) as Role[]).map((r) => (
              <option key={r} value={r}>{DEV_USERS[r].label}</option>
            ))}
          </select>
        </label>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/transfers/new" element={<NewTransfer />} />
          <Route path="/transfers/:no/edit" element={<NewTransfer />} />
          <Route path="/consumption" element={<Consumption />} />
          <Route path="/machines" element={<Machines />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/purchase-orders/new" element={<NewPurchaseOrder />} />
          <Route path="/zoho" element={<ZohoSync />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
