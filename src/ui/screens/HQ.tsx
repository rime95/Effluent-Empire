import { useGame, WEEKLY_OVERHEAD } from '../../game/store';
import { payroll } from '../../game/staff';
import type { Screen } from '../App';
import { INDUSTRY_LABEL, rm } from '../format';
import { brand } from '../prefs';

const MILESTONES = [
  { label: 'Commission your first WWTP', done: (n: number) => n >= 1 },
  { label: 'Complete 5 projects', done: (n: number) => n >= 5 },
  { label: 'Reach 100 reputation', done: (_n: number, rep: number) => rep >= 100 },
];

export function HQ({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const completed = g.history.filter((h) => h.outcome === 'completed');
  const revenue = completed.reduce((a, h) => a + h.revenue, 0);
  const profit = g.history.reduce((a, h) => a + h.revenue - h.cost, 0);


  return (
    <div className="page">
      <h1>Company HQ</h1>
      <p className="sub">One laptop, one engineer and RM 500,000 of capital. Win industrial wastewater projects, design plants that really work, and grow.</p>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="panel stat">
          <div className="label">Cash</div>
          <div className="value">{rm(g.cash)}</div>
          <div className="hint">Overheads {rm(WEEKLY_OVERHEAD)}/wk + payroll {rm(payroll(g.staff))}/wk</div>
        </div>
        <div className="panel stat">
          <div className="label">Reputation</div>
          <div className="value">{g.reputation}</div>
          <div className="hint">{g.reputation >= 40 ? 'Semiconductor clients now approach you' : '40 unlocks semiconductor clients'}</div>
        </div>
        <div className="panel stat">
          <div className="label">Plants commissioned</div>
          <div className="value">{completed.length}</div>
          <div className="hint">Revenue {rm(revenue)}</div>
        </div>
        <div className="panel stat">
          <div className="label">Project profit</div>
          <div className="value" style={{ color: profit < 0 ? 'var(--alarm)' : undefined }}>{rm(profit)}</div>
          <div className="hint">Contract − CAPEX − lab, all projects</div>
        </div>
      </div>

      <div className="grid g2">
        <div className="panel">
          <h2>Projects</h2>
          {g.projects.length === 0 && (
            <>
              <p className="muted">No projects. Review customer enquiries and sign a contract.</p>
              <button className="btn primary" onClick={() => go('enquiries')}>
                View enquiries ({g.enquiries.length})
              </button>
            </>
          )}
          {g.projects.map((x) => (
            <div key={x.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a3049' }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 600 }}>{brand(x.enquiry.company)}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {INDUSTRY_LABEL[x.enquiry.industry]} · {x.enquiry.declared.Q} m³/d · Std {x.enquiry.standard} · contract {rm(x.enquiry.contractValue)} · due wk {x.startedWeek + x.enquiry.deadlineWeeks}
                  {x.labQueue.length > 0 && ` · lab results wk ${Math.min(...x.labQueue.map((q) => q.doneWeek))}`}
                  {x.building && ` · commissioning wk ${x.building.doneWeek}`}
                </div>
              </div>
              <div className="row">
                <span className={`pill ${x.status === 'completed' ? 'pass' : x.status === 'failed' || x.status === 'abandoned' ? 'fail' : x.status === 'building' ? 'warn' : 'info'}`}>{x.status}</span>
                <button className="btn sm" onClick={() => { g.setActiveProject(x.id); go(x.status === 'design' || x.status === 'failed' ? 'studio' : 'commission'); }}>Open</button>
                {(x.status === 'completed' || x.status === 'abandoned') && !x.omOffer && (
                  <button className="btn sm ghost" onClick={() => g.closeProject(x.id)}>Close</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>News &amp; events</h2>
          {g.news.length === 0 && <p className="muted">Nothing yet. Lab results, commissioning outcomes, plant events and market news appear here.</p>}
          {[...g.news].reverse().slice(0, 8).map((n, i) => (
            <div key={i} className="note info">
              <span className="mono muted">wk {n.week}</span> {brand(n.text)}
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>How a project works</h2>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }} className="muted">
            <li><b style={{ color: '#fff' }}>Enquiries</b> — the customer declares rough wastewater data. It is incomplete and sometimes wrong.</li>
            <li><b style={{ color: '#fff' }}>Laboratory</b> — pay for tests to learn the truth: buffer capacity, metals, COD fractions, oil, jar tests.</li>
            <li><b style={{ color: '#fff' }}>Engineering Studio</b> — drag units onto the PFD, connect pipes, size each unit. Predictions use only what you have measured.</li>
            <li><b style={{ color: '#fff' }}>Commission</b> — the plant is built and tested on the <i>real</i> wastewater. Payments: 30 % on signing, 60 % at mechanical completion, 10 % retention on passing. Fail → retrofit (20 % rework premium) or abandon (repay + 15 % penalty).</li>
          </ol>
        </div>

        <div className="panel">
          <h2>Milestones</h2>
          {MILESTONES.map((m) => {
            const done = m.done(completed.length, g.reputation);
            return (
              <div key={m.label} className="row" style={{ padding: '4px 0' }}>
                <span className={`pill ${done ? 'pass' : 'std'}`}>{done ? 'DONE' : 'OPEN'}</span>
                <span>{m.label}</span>
              </div>
            );
          })}
        </div>

        <div className="panel">
          <h2>Ledger (latest)</h2>
          <table className="data">
            <tbody>
              {g.ledger
                .slice(-8)
                .reverse()
                .map((l, i) => (
                  <tr key={i}>
                    <td className="muted num" style={{ textAlign: 'left', width: 50 }}>
                      wk {l.week}
                    </td>
                    <td>{brand(l.label)}</td>
                    <td className="num" style={{ color: l.amount < 0 ? '#ff9c9c' : '#6fd39a' }}>
                      {rm(l.amount)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {g.history.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2>Project history</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Week</th>
                <th>Customer</th>
                <th>Industry</th>
                <th>Outcome</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Reputation</th>
              </tr>
            </thead>
            <tbody>
              {g.history.map((h, i) => (
                <tr key={i}>
                  <td className="num" style={{ textAlign: 'left' }}>{h.week}</td>
                  <td>{brand(h.company)}</td>
                  <td>{INDUSTRY_LABEL[h.industry]}</td>
                  <td>
                    <span className={`pill ${h.outcome === 'completed' ? 'pass' : 'fail'}`}>{h.outcome}</span>
                  </td>
                  <td className="num">{rm(h.revenue)}</td>
                  <td className="num">{rm(h.cost)}</td>
                  <td className="num">{h.reputationDelta > 0 ? `+${h.reputationDelta}` : h.reputationDelta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 18 }}>
        Progress autosaves to this company’s slot. Open <b>☰ Menu</b> (Esc) to save, download a save file or return to the main menu.
      </p>
    </div>
  );
}
