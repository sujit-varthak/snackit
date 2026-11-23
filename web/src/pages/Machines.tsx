import { useDb } from '../store'

export default function Machines() {
  const db = useDb()
  return (
    <>
      <h2>Vending Machines</h2>
      <p className="sub">Master list. Machine ID is the lookup value sent to Zoho Books on each transfer order. (Add/edit/bulk import: next iteration.)</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Location</th><th>Area</th><th>Custodian</th><th className="num">Units in stock</th></tr>
          </thead>
          <tbody>
            {db.machines.map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td><td>{m.name}</td><td>{m.location}</td><td>{m.area}</td><td>{m.custodian}</td>
                <td className="num">{db.machineStock.filter((r) => r.machineId === m.id).reduce((s, r) => s + r.qty, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
