import { useState } from 'react'
import { saveVendor, useDb } from '../store'
import type { Vendor } from '../types'

const blank: Omit<Vendor, 'id'> = { name: '', contact: '', phone: '', email: '', gstin: '', active: true }

export default function Vendors() {
  const db = useDb()
  const [form, setForm] = useState<(Omit<Vendor, 'id'> & { id?: string }) | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const rows = db.vendors.filter((v) => `${v.name} ${v.contact} ${v.gstin}`.toLowerCase().includes(q.toLowerCase()))
  const set = (p: Partial<Vendor>) => setForm((f) => (f ? { ...f, ...p } : f))

  const submit = () => {
    if (!form) return
    const r = saveVendor(form)
    if (!r.ok) return setError(r.error)
    setForm(null)
    setError('')
  }

  return (
    <>
      <div className="row">
        <div>
          <h2>Vendors</h2>
          <p className="sub">Suppliers you buy stock from. (Zoho Books vendor sync: later.)</p>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => { setForm({ ...blank }); setError('') }}>Add vendor</button>
      </div>

      {form && (
        <div className="card">
          <div className="row">
            <input placeholder="Vendor name *" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            <input placeholder="Contact person" value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
            <input placeholder="Phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            <input placeholder="Email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            <input placeholder="GSTIN" value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
            <label><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
          </div>
          <div className="row">
            <button className="primary" onClick={submit}>{form.id ? 'Save changes' : 'Save vendor'}</button>
            <button onClick={() => setForm(null)}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row"><input placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {rows.length === 0 ? <div className="empty">No vendors found.</div> : (
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th>GSTIN</th><th>Status</th><th className="num">Open POs</th><th /></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.id}</td><td>{v.name}</td><td>{v.contact}</td><td>{v.phone}</td><td>{v.email}</td><td>{v.gstin}</td>
                  <td><span className={`badge ${v.active ? 'ok' : 'warn'}`}>{v.active ? 'Active' : 'Inactive'}</span></td>
                  <td className="num">{db.purchaseOrders.filter((p) => p.vendorId === v.id && p.status === 'open').length}</td>
                  <td><button onClick={() => { setForm(v); setError('') }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
