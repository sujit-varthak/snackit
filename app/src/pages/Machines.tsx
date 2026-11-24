import { api } from '../api'
import { Gate, useLoad } from '../useLoad'

export default function Machines() {
  const machines = useLoad(() => api.machines())
  const stock = useLoad(() => api.stock())
  return (
    <>
      <h2>Vending Machines</h2>
      <p className="sub">Machines you can see. The machine code is the value sent to Zoho on each transfer order. (Add, edit and bulk import come next.)</p>
      <Gate states={[machines, stock]}>
        <div className="card">
          <table>
            <thead>
              <tr><th>Code</th><th>Name</th><th>Location</th><th>Area</th><th>Custodian</th><th className="num">Units in stock</th></tr>
            </thead>
            <tbody>
              {(machines.data ?? []).map((m) => (
                <tr key={m.machine_code}>
                  <td>{m.machine_code}</td><td>{m.name}</td><td>{m.location}</td><td>{m.area}</td><td>{m.custodian}</td>
                  <td className="num">{(stock.data ?? []).filter((r) => r.machine_code === m.machine_code).reduce((s, r) => s + r.qty, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Gate>
    </>
  )
}
