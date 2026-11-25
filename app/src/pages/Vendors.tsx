import { useState } from 'react'
import { api, ApiError, type ApiVendor } from '../api'
import { Gate, useLoad } from '../useLoad'

type Form = Partial<ApiVendor> & { name: string }
const blank: Form = { name: '', contact: '', phone: '', email: '', gstin: '', active: true }

export default function Vendors() {
  const vendors = useLoad(() => api.vendors())
  const pos = useLoad(() => api.purchaseOrders())
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const rows = (vendors.data ?? []).filter((v) => `${v.name} ${v.contact} ${v.gstin}`.toLowerCase().includes(q.toLowerCase()))
  const set = (p: Partial<ApiVendor>) => setForm((f) => (f ? { ...f, ...p } : f))

  const submit = async () => {
    if (!form) return
    try {
      await api.saveVendor(form)
      setForm(null)
      setError('')
      vendors.reload()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <>
      <div className="row">
        <div>
          <h2>Vendors</h2>
          <p className="sub">Suppliers you buy stock from. A vendor is linked to Zoho the first time one of its orders is sent.</p>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => { setForm({ ...blank }); setError('') }}>Add vendor</button>
      </div>

      {form && (
        <div className="card">
          <div className="row">
            <input placeholder="Vendor name *" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            <input placeholder="Contact person" value={form.contact ?? ''} onChange={(e) => set({ contact: e.target.value })} />
            <input placeholder="Phone" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
            <input placeholder="Email" value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
            <input placeholder="GSTIN" value={form.gstin ?? ''} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
            <label><input type="checkbox" checked={form.active ?? true} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
          </div>
          <div className="row">
            <button className="primary" onClick={submit}>{form.vendor_code ? 'Save changes' : 'Save vendor'}</button>
            <button onClick={() => setForm(null)}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </div>
      )}

      <Gate states={[vendors, pos]}>
        <div className="card">
          <div className="row"><input placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {rows.length === 0 ? <div className="empty">No vendors found.</div> : (
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Phone</th><th>GSTIN</th><th>Status</th><th>Zoho</th><th className="num">Open POs</th><th /></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.vendor_code}>
                    <td>{v.vendor_code}</td><td>{v.name}</td><td>{v.contact}</td><td>{v.phone}</td><td>{v.gstin}</td>
                    <td><span className={`badge ${v.active ? 'ok' : 'warn'}`}>{v.active ? 'Active' : 'Inactive'}</span></td>
                    <td><span className={`badge ${v.zoho_vendor_id ? 'ok' : ''}`}>{v.zoho_vendor_id ? 'Linked' : 'Not linked'}</span></td>
                    <td className="num">{(pos.data ?? []).filter((p) => p.vendor_code === v.vendor_code && p.status === 'open').length}</td>
                    <td><button onClick={() => { setForm(v); setError('') }}>Edit</button></td>
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
