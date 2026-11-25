import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supervisedPlantIds, useGame } from '../../game/store';
import { OM, Plant, WEEKS_PER_MONTH, plantPosts, recommendedMaintenance } from '../../game/operations';
import { OMFeeTable } from '../components/OMFee';
import type { Screen } from '../App';
import { operatorCapacity } from '../../game/staff';
import { INDUSTRY_LABEL, rm } from '../format';
import { brand } from '../prefs';

const AXIS = { stroke: '#8aa0b8', fontSize: 10, fontFamily: 'var(--mono)' };

function ConditionBar({ value }: { value: number }) {
  const c = value > 70 ? 'var(--ok)' : value > 40 ? 'var(--warn)' : 'var(--alarm)';
  return (
    <div style={{ width: 110, height: 8, background: '#1a3049', borderRadius: 4, overflow: 'hidden' }} title={`${value.toFixed(0)} %`}>
      <div style={{ width: `${value}%`, height: '100%', background: c }} />
    </div>
  );
}

export function Plants({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const [sel, setSel] = useState<string | null>(null);
  const operating = g.plants.filter((p) => p.status === 'operating');
  const capacity = operatorCapacity(g.staff);
  const postsNeeded = operating.reduce((a, p) => a + plantPosts(p), 0);
  const supervised = supervisedPlantIds(g);
  // plants are staffed in portfolio order (as in the weekly tick)
  let left = capacity;
  const uncovered = operating.filter((p) => {
    const need = plantPosts(p);
    if (left >= need - 1e-9) {
      left -= need;
      return false;
    }
    return true;
  }).length;
  const plant = g.plants.find((p) => p.id === sel) ?? operating[0] ?? g.plants[0] ?? null;
  const weeklyNet = operating.reduce((a, p) => {
    const last = p.history[p.history.length - 1];
    return a + (last ? last.revenue - last.cost : 0);
  }, 0);

  return (
    <div className="page">
      <h1>Plants &amp; O&amp;M contracts</h1>
      <p className="sub">
        Operated plants earn a fixed monthly service fee, and chemicals, power and sludge are re-billed to the client at cost + {Math.round(OM.handling * 100)} %. You pay maintenance, CePIETSO supervision, compliance sampling, repairs and DOE fines; operators are on your payroll. Operator posts: {capacity} staffed / {postsNeeded} needed by {operating.length} plant(s). Engineer-supervised: {supervised.size} of {operating.length} (free engineers act as CePIETSO for up to {OM.plantsPerEngineer} plants each, fix incidents on site and save the external supervision cost)
        {uncovered > 0 && <b style={{ color: 'var(--warn)' }}> — {uncovered} plant(s) uncovered (faster wear, longer breakdowns). Hire operators.</b>}
      </p>
      {g.plants.length === 0 && <div className="panel muted">No plants yet. Commission a plant and accept the O&amp;M contract the customer offers.</div>}
      {g.plants.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Portfolio</h2>
            <span className="muted">Last week net: <b style={{ color: weeklyNet < 0 ? '#ff9c9c' : '#6fd39a' }}>{rm(weeklyNet)}</b></span>
          </div>
          <table className="data" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Plant</th>
                <th>Status</th>
                <th>Condition</th>
                <th>Last sample</th>
                <th style={{ textAlign: 'right' }}>Fee / month</th>
                <th style={{ textAlign: 'right' }}>Net last wk</th>
                <th>Contract</th>
                <th>Customer</th>
              </tr>
            </thead>
            <tbody>
              {g.plants.map((p) => {
                const last = p.history[p.history.length - 1];
                return (
                  <tr key={p.id} onClick={() => setSel(p.id)} style={{ cursor: 'pointer', background: plant?.id === p.id ? '#13283f' : undefined }}>
                    <td>
                      <div style={{ color: '#fff' }}>{brand(p.company)}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {INDUSTRY_LABEL[p.industry]} · Std {p.standard}
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${p.status === 'operating' ? (p.breakdown ? 'warn' : 'pass') : p.status === 'terminated' ? 'fail' : 'std'}`}>{p.breakdown ? 'breakdown' : p.status}</span>
                    </td>
                    <td>
                      <ConditionBar value={p.condition} />
                    </td>
                    <td>{last ? <span className={`pill ${last.pass ? 'pass' : 'fail'}`}>{last.pass ? 'PASS' : `FAIL ${last.failed.join(', ')}`}</span> : <span className="muted">—</span>}</td>
                    <td className="num">{p.contract ? rm(p.contract.monthlyFee) : '—'}</td>
                    <td className="num" style={{ color: last && last.revenue - last.cost < 0 ? '#ff9c9c' : undefined }}>{last ? rm(last.revenue - last.cost) : '—'}</td>
                    <td className="muted">{p.contract ? `${p.contract.endWeek - g.week} wk left` : '—'}</td>
                    <td>{p.satisfaction.toFixed(0)} %</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {plant && <PlantDetail plant={plant} go={go} />}
    </div>
  );
}

function PlantDetail({ plant, go }: { plant: Plant; go: (s: Screen) => void }) {
  const g = useGame();
  const rec = recommendedMaintenance(plant.capex);
  const data = plant.history.slice(-26).map((h) => ({ week: h.week, net: Math.round(h.revenue - h.cost), pass: h.pass }));
  // last 4 weeks ≈ one month of the plant's own economics
  // the last 4 weeks on the fixed-fee model (older records have no cost split)
  const recent = plant.history.filter((h) => h.fee !== undefined).slice(-4);
  const scale = recent.length ? WEEKS_PER_MONTH / recent.length : 0;
  const sum = (f: (h: Plant['history'][number]) => number) => recent.reduce((a, h) => a + f(h), 0) * scale;
  const month = {
    fee: sum((h) => h.fee ?? h.revenue),
    deduction: sum((h) => h.deduction ?? 0),
    reimbursed: sum((h) => h.reimbursed ?? 0),
    maintenance: sum((h) => h.costs?.maintenance ?? 0),
    repairs: sum((h) => h.costs?.repairs ?? 0),
    opex: sum((h) => h.costs?.opex ?? 0),
    service: sum((h) => h.costs?.service ?? 0),
    actions: sum((h) => h.costs?.actions ?? 0),
    fines: sum((h) => h.costs?.fines ?? 0),
  };
  const monthNet = sum((h) => h.revenue - h.cost);
  const [showQuote, setShowQuote] = useState(false);
  const compliance = plant.history.length ? (plant.history.filter((h) => h.pass).length / plant.history.length) * 100 : 100;
  return (
    <div className="grid g2">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>{brand(plant.company)}</h2>
          {plant.status === 'operating' && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => { g.openPlantStudio(plant.id); go('studio'); }} title="As-built PFD and P&ID; propose upgrades">
                Open PFD / P&amp;ID{plant.upgrade ? (plant.upgrade.phase === 'building' ? ' · upgrade in progress' : ' · upgrade draft') : ''}
              </button>
              <button className="btn sm ghost" onClick={() => { g.openPlantStudio(plant.id); go('scada'); }}>SCADA</button>
            </div>
          )}
        </div>
        {plant.breakdown && <div className="note error">Breakdown at {plant.breakdown.tag}: {plant.breakdown.description} — {plant.breakdown.weeksLeft} wk to repair.</div>}
        {plant.status === 'operating' && (
          <div className="calc">
            <span>Engineer supervision (CePIETSO)</span>
            <span style={{ color: supervisedPlantIds(g).has(plant.id) ? undefined : 'var(--warn)' }}>{supervisedPlantIds(g).has(plant.id) ? 'in-house engineer' : 'external — no free engineer'}</span>
          </div>
        )}
        <div className="calc">
          <span>Equipment condition</span>
          <span>{plant.condition.toFixed(0)} %</span>
        </div>
        <div className="calc">
          <span>Compliance (last {plant.history.length} wk)</span>
          <span>{compliance.toFixed(0)} %</span>
        </div>
        <div className="calc">
          <span>Customer satisfaction</span>
          <span>{plant.satisfaction.toFixed(0)} % (terminates below {OM.terminateBelow} %)</span>
        </div>
        <div className="calc">
          <span>DOE fines to date</span>
          <span>{plant.fines}</span>
        </div>
        <div className="calc">
          <span>Production growth (flow)</span>
          <span>×{(plant.history[plant.history.length - 1]?.flowFactor ?? 1).toFixed(2)}</span>
        </div>
        {plant.status === 'operating' && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Maintenance budget (RM / week) — recommended {rm(rec)} (2 % of CAPEX per year)</label>
            <input type="number" min={0} step={50} value={plant.maintenanceBudget} onChange={(e) => g.setMaintenance(plant.id, Number(e.target.value))} />
            <span className="help">Below recommended, condition falls and breakdowns become more frequent; above it, condition recovers.</span>
          </div>
        )}
      </div>
      <div className="panel">
        <h2>Contract economics — per month</h2>
        {recent.length === 0 ? (
          <p className="muted">No weeks operated yet.</p>
        ) : (
          <table className="data" style={{ fontSize: 12.5, marginBottom: 10 }}>
            <tbody>
              <tr><td>Fixed service fee</td><td className="num">{rm(month.fee)}</td></tr>
              {month.deduction > 0 && <tr><td>Performance deductions (failed samples)</td><td className="num" style={{ color: '#ff9c9c' }}>{rm(-month.deduction)}</td></tr>}
              <tr><td>Reimbursables billed</td><td className="num">{rm(month.reimbursed)}</td></tr>
              <tr><td>Chemicals, power, sludge (market prices)</td><td className="num">{rm(-month.opex)}</td></tr>
              <tr><td>Maintenance budget</td><td className="num">{rm(-month.maintenance)}</td></tr>
              <tr><td>CePIETSO supervision, compliance sampling</td><td className="num">{rm(-month.service)}</td></tr>
              {month.repairs > 0 && <tr><td>Repairs</td><td className="num">{rm(-month.repairs)}</td></tr>}
              {month.actions > 0 && <tr><td>SCADA field actions</td><td className="num">{rm(-month.actions)}</td></tr>}
              {month.fines > 0 && <tr><td>DOE fines</td><td className="num" style={{ color: '#ff9c9c' }}>{rm(-month.fines)}</td></tr>}
              <tr>
                <td style={{ fontWeight: 600 }}>Plant net (before operator payroll)</td>
                <td className="num" style={{ fontWeight: 600, color: monthNet < 0 ? '#ff9c9c' : '#6fd39a' }}>{rm(monthNet)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {plant.contract && (
          <>
            <button className="btn sm ghost" onClick={() => setShowQuote(!showQuote)}>{showQuote ? 'Hide' : 'Show'} contract fee build-up</button>
            {showQuote && (
              <div style={{ marginTop: 8 }}>
                <OMFeeTable q={plant.contract.quote} monthlyFee={plant.contract.monthlyFee} />
              </div>
            )}
          </>
        )}
        <h2 style={{ marginTop: 14 }}>Weekly result (last 26 weeks)</h2>
        <div className="lab-chart" style={{ height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1c3653" />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} width={56} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v))} label={{ value: 'RM / week', angle: -90, position: 'insideLeft', fill: '#8aa0b8', fontSize: 10, style: { textAnchor: 'middle' } }} />
              <ReferenceLine y={0} stroke="#8aa0b8" />
              <Tooltip contentStyle={{ background: '#0d1c2e', border: '1px solid #24405f' }} formatter={(v: number) => rm(v)} labelFormatter={(l) => `Week ${l}`} />
              <Bar dataKey="net" isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.week} fill={!d.pass ? 'var(--alarm)' : d.net < 0 ? 'var(--warn)' : 'var(--flow)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>Bars: fee + reimbursables − plant costs (operator salaries are payroll). Red = non-compliant sample that week.</p>
        {plant.history
          .filter((h) => h.event || h.fine)
          .slice(-5)
          .reverse()
          .map((h) => (
            <div key={h.week} className={`note ${h.fine ? 'error' : 'warn'}`}>
              <span className="mono muted">wk {h.week}</span> {h.event ?? ''} {h.fine ? `DOE fine ${rm(h.fine)}` : ''}
            </div>
          ))}
      </div>
    </div>
  );
}
