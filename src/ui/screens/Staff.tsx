import { plantPosts } from '../../game/operations';
import { engineersBusy, freeEngineers, supervisedPlantIds, useGame } from '../../game/store';
import { LEVEL_LABEL, ROLES, Role, count, labDiscount, operatorCapacity, payroll, projectSlots, salesBoost, weeklySalary } from '../../game/staff';
import { rm } from '../format';

const ROLE_COLOR: Record<Role, string> = { engineer: 'var(--flow)', labTech: 'var(--chem)', operator: 'var(--bio)', sales: 'var(--clean)' };

export function Staff() {
  const g = useGame();
  const postsNeeded = g.plants.filter((p) => p.status === 'operating').reduce((a, p) => a + plantPosts(p), 0);
  return (
    <div className="page">
      <h1>Employees</h1>
      <p className="sub">
        Weekly payroll {rm(payroll(g.staff))}. New candidates every 4 weeks (next in week {Math.ceil((g.week + 1) / 4) * 4}). Recruitment fee: half a month’s salary.
      </p>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="panel stat">
          <div className="label">Engineers</div>
          <div className="value">
            {engineersBusy(g)} / {projectSlots(g.staff)}
          </div>
          <div className="hint">
            busy on projects/upgrades · free: {freeEngineers(g)}, supervising {supervisedPlantIds(g).size} of {g.plants.filter((p) => p.status === 'operating').length} plant(s)
          </div>
        </div>
        <div className="panel stat">
          <div className="label">Lab discount</div>
          <div className="value">{(labDiscount(g.staff) * 100).toFixed(0)} %</div>
          <div className="hint">{count(g.staff, 'labTech') ? '2-week tests take 1 week' : 'hire a lab technician'}</div>
        </div>
        <div className="panel stat">
          <div className="label">Operator coverage</div>
          <div className="value" style={{ color: postsNeeded > operatorCapacity(g.staff) + 1e-9 ? 'var(--warn)' : undefined }}>
            {postsNeeded} / {operatorCapacity(g.staff)}
          </div>
          <div className="hint">operator posts needed / staffed</div>
        </div>
        <div className="panel stat">
          <div className="label">Sales reach</div>
          <div className="value">+{salesBoost(g.staff)}</div>
          <div className="hint">extra enquiries, larger jobs</div>
        </div>
      </div>
      <div className="grid g2">
        <div className="panel">
          <h2>Team</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th style={{ textAlign: 'right' }}>Salary / month</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {g.staff.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>
                    <span style={{ color: ROLE_COLOR[e.role] }}>{ROLES[e.role].label}</span> <span className="muted">· {LEVEL_LABEL[e.level]}</span>
                  </td>
                  <td className="num">{e.founder ? 'equity' : rm(e.salaryMonthly)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!e.founder && (
                      <button className="btn sm ghost" onClick={() => confirm(`Let ${e.name} go? One month's salary as severance.`) && g.fire(e.id)}>
                        Let go
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Candidates</h2>
          {g.candidates.length === 0 && <p className="muted">No candidates this month.</p>}
          {g.candidates.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a3049' }}>
              <div style={{ maxWidth: '70%' }}>
                <div style={{ color: '#fff' }}>
                  {c.name} <span className="muted">· {LEVEL_LABEL[c.level]}</span>
                </div>
                <div style={{ fontSize: 12, color: ROLE_COLOR[c.role] }}>{ROLES[c.role].label}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {ROLES[c.role].effect}
                </div>
              </div>
              <button className="btn sm primary" onClick={() => g.hire(c.id)} title={`${rm(weeklySalary(c))}/week`}>
                Hire · {rm(c.salaryMonthly)}/mo
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
