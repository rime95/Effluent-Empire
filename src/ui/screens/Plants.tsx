import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGame } from '../../game/store';
import { OM, Plant, recommendedMaintenance } from '../../game/operations';
import { operatorCapacity } from '../../game/staff';
import { INDUSTRY_LABEL, rm } from '../format';

const AXIS = { stroke: '#8aa0b8', fontSize: 10, fontFamily: 'var(--mono)' };

function ConditionBar({ value }: { value: number }) {
  const c = value > 70 ? 'var(--ok)' : value > 40 ? 'var(--warn)' : 'var(--alarm)';
  return (
    <div style={{ width: 110, height: 8, background: '#1a3049', borderRadius: 4, overflow: 'hidden' }} title={`${value.toFixed(0)} %`}>
      <div style={{ width: `${value}%`, height: '100%', background: c }} />
    </div>
  );
}

export function Plants() {
  const g = useGame();
  const [sel, setSel] = useState<string | null>(null);
  const operating = g.plants.filter((p) => p.status === 'operating');
  const capacity = operatorCapacity(g.staff);
  const plant = g.plants.find((p) => p.id === sel) ?? operating[0] ?? g.plants[0] ?? null;
  const weeklyNet = operating.reduce((a, p) => {
    const last = p.history[p.history.length - 1];
    return a + (last ? last.revenue - last.cost : 0);
  }, 0);

  return (
    <div className="page">
      <h1>Plants &amp; O&amp;M contracts</h1>
      <p className="sub">
        Operated plants earn a weekly fee; you pay chemicals, power and sludge at market prices, maintenance, repairs and DOE fines. Operators cover {capacity} plant(s); {operating.length} operating
        {operating.length > capacity && <b style={{ color: 'var(--warn)' }}> — {operating.length - capacity} uncovered (faster wear, longer breakdowns). Hire operators.</b>}
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
                <th style={{ textAlign: 'right' }}>Fee / wk</th>
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
                      <div style={{ color: '#fff' }}>{p.company}</div>
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
                    <td className="num">{p.contract ? rm(p.contract.weeklyFee) : '—'}</td>
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
      {plant && <PlantDetail plant={plant} />}
    </div>
  );
}

function PlantDetail({ plant }: { plant: Plant }) {
  const g = useGame();
  const rec = recommendedMaintenance(plant.capex);
  const data = plant.history.slice(-26).map((h) => ({ week: h.week, net: Math.round(h.revenue - h.cost), pass: h.pass }));
  const compliance = plant.history.length ? (plant.history.filter((h) => h.pass).length / plant.history.length) * 100 : 100;
  return (
    <div className="grid g2">
      <div className="panel">
        <h2>{plant.company}</h2>
        {plant.breakdown && <div className="note error">Breakdown at {plant.breakdown.tag}: {plant.breakdown.description} — {plant.breakdown.weeksLeft} wk to repair.</div>}
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
        <h2>Weekly result (last 26 weeks)</h2>
        <div className="lab-chart" style={{ height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#1c3653" />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip contentStyle={{ background: '#0d1c2e', border: '1px solid #24405f' }} formatter={(v: number) => rm(v)} labelFormatter={(l) => `Week ${l}`} />
              <Bar dataKey="net" isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.week} fill={!d.pass ? 'var(--alarm)' : d.net < 0 ? 'var(--warn)' : 'var(--flow)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>Bars: weekly fee minus costs. Red = non-compliant sample that week.</p>
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
