import { useState } from 'react';
import { useActiveProject, useGame } from '../../game/store';
import { ABANDON_PENALTY } from '../../game/project';
import { ComplianceTable } from '../studio/Studio';
import type { Screen } from '../App';
import { fmt, rm } from '../format';

export function Commissioning({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const p = useActiveProject();
  const [idx, setIdx] = useState<number | null>(null);
  if (p?.status === 'building' && p.building) return <div className="page"><h1>Commissioning — {p.enquiry.company}</h1><p className="muted">Under construction. Commissioning test in week {p.building.doneWeek} (now week {g.week}). Use “Skip to next event”.</p></div>;
  if (!p || p.reports.length === 0) return <div className="page"><h1>Commissioning</h1><p className="muted">No plant has been commissioned on the selected project yet.</p></div>;
  const i = idx ?? p.reports.length - 1;
  const r = p.reports[i];
  const fails = r.compliance.checks.filter((c) => !c.pass);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Commissioning report — {p.enquiry.company}</h1>
          <p className="sub">
            Attempt {r.attempt} · week {r.week} · tested on the real wastewater (with normal day-to-day variation) against {r.compliance.standard === 'A' ? 'Standard A' : 'Standard B'} ({r.compliance.version})
          </p>
        </div>
        {p.reports.length > 1 && (
          <div className="row">
            {p.reports.map((_, k) => (
              <button key={k} className={`btn sm ${k === i ? 'primary' : ''}`} onClick={() => setIdx(k)}>
                #{k + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel" style={{ borderColor: r.pass ? 'var(--ok)' : 'var(--alarm)', marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: r.pass ? '#6fd39a' : '#ff8a8a' }}>{r.pass ? 'PLANT ACCEPTED — discharge compliant' : `COMMISSIONING FAILED — ${fails.length} parameter(s) out of limit`}</div>
          <div className="row">
            <div className="kpi">
              <span className="label">Construction charged</span>
              <span className="value">{rm(r.capexCharged)}</span>
            </div>
            {r.milestone > 0 && (
              <div className="kpi">
                <span className="label">Completion milestone</span>
                <span className="value">{rm(r.milestone)}</span>
              </div>
            )}
            {r.pass && (
              <div className="kpi">
                <span className="label">Retention released</span>
                <span className="value" style={{ color: '#6fd39a' }}>{rm(r.payment)}</span>
              </div>
            )}
            <div className="kpi">
              <span className="label">Operating cost</span>
              <span className="value">{rm(r.opexRMd)}/d</span>
            </div>
            <div className="kpi">
              <span className="label">Reputation</span>
              <span className="value">{r.reputationDelta > 0 ? `+${r.reputationDelta}` : r.reputationDelta}</span>
            </div>
          </div>
        </div>
        {r.messages.map((m) => (
          <div key={m} className={`note ${r.pass ? 'info' : 'error'}`}>
            {m}
          </div>
        ))}
        {i === p.reports.length - 1 && p.status === 'failed' && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => go('studio')}>
              Retrofit the design ▸
            </button>
            <button className="btn" onClick={() => go('lab')}>
              Run more lab tests
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`Abandon the project? Repay ${rm(p.paid)} received plus a ${rm(p.enquiry.contractValue * ABANDON_PENALTY)} penalty, and −20 reputation.`)) g.abandon();
              }}
            >
              Abandon project
            </button>
          </div>
        )}
        {p.status === 'completed' && i === p.reports.length - 1 && p.omOffer && (
          <div className="panel" style={{ marginTop: 12, borderColor: 'var(--flow)' }}>
            <div style={{ fontWeight: 600, color: '#fff' }}>Operation & maintenance contract offered</div>
            <p className="muted" style={{ margin: '6px 0 10px' }}>
              {p.enquiry.company} offers {rm(p.omOffer.weeklyFee)}/week for {p.omOffer.weeks / 52} years to operate the plant. You pay chemicals, power and sludge at market prices, maintenance, repairs and any DOE fines — and you need a plant operator (1 per 2 plants) or the plant wears out faster.
            </p>
            <div className="row">
              <button className="btn primary" onClick={() => { g.acceptOM(p.id); go('plants'); }}>Sign O&M contract ▸</button>
              <button className="btn ghost" onClick={() => g.declineOM(p.id)}>Hand the plant over</button>
            </div>
          </div>
        )}
        {p.status === 'completed' && i === p.reports.length - 1 && !p.omOffer && (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn primary"
              onClick={() => {
                g.closeProject();
                go('enquiries');
              }}
            >
              Close file & find the next customer ▸
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Discharge compliance</h2>
        <ComplianceTable checks={r.compliance.checks} />
      </div>

      <div className="panel">
        <h2>Stage-by-stage performance (measured during commissioning)</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Unit</th>
              <th style={{ textAlign: 'right' }}>pH</th>
              <th style={{ textAlign: 'right' }}>COD</th>
              <th style={{ textAlign: 'right' }}>TSS</th>
              <th style={{ textAlign: 'right' }}>O&amp;G</th>
              <th style={{ textAlign: 'right' }}>Ni</th>
              <th style={{ textAlign: 'right' }}>Cu</th>
              <th style={{ textAlign: 'right' }}>Zn</th>
              <th>Operator notes</th>
            </tr>
          </thead>
          <tbody>
            {r.stages.map((s) => (
              <tr key={s.tag}>
                <td>
                  <span className="mono">{s.tag}</span> <span className="muted">{s.name}</span>
                </td>
                <td className="num">{fmt(s.pH, 2)}</td>
                <td className="num">{fmt(s.COD, 0)}</td>
                <td className="num">{fmt(s.TSS, 1)}</td>
                <td className="num">{fmt(s.OG, 1)}</td>
                <td className="num">{fmt(s.Ni, 2)}</td>
                <td className="num">{fmt(s.Cu, 2)}</td>
                <td className="num">{fmt(s.Zn, 2)}</td>
                <td style={{ fontSize: 12, maxWidth: 380 }}>
                  {s.notes.length === 0 ? <span className="muted">normal</span> : s.notes.map((n) => <div key={n.code} className={`note ${n.level}`}>{n.text}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>Concentrations in mg/L at each unit outlet. Metals are totals (dissolved + particulate).</p>
      </div>
    </div>
  );
}
