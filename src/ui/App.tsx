import { useEffect, useState } from 'react';
import { isLive, useActiveProject, useGame } from '../game/store';
import { projectSlots } from '../game/staff';
import { BrandMark, NavIcon } from './components/Symbols';
import { rm } from './format';
import { HQ } from './screens/HQ';
import { Enquiries } from './screens/Enquiries';
import { Laboratory } from './screens/Laboratory';
import { Studio } from './studio/Studio';
import { Commissioning } from './screens/Commissioning';
import { Encyclopedia } from './screens/Encyclopedia';
import { Plants } from './screens/Plants';
import { Scada } from './screens/Scada';
import { Staff } from './screens/Staff';
import { Finance } from './screens/Finance';

export type Screen = 'hq' | 'enquiries' | 'lab' | 'studio' | 'commission' | 'plants' | 'staff' | 'finance' | 'book' | 'scada';

const COMPANY: { id: Screen; label: string; icon: string }[] = [
  { id: 'hq', label: 'Company HQ', icon: 'hq' },
  { id: 'enquiries', label: 'Customer Enquiries', icon: 'enquiries' },
  { id: 'plants', label: 'Plants & O&M', icon: 'scada' },
  { id: 'scada', label: 'SCADA Operations', icon: 'scada' },
  { id: 'staff', label: 'Employees', icon: 'staff' },
  { id: 'finance', label: 'Finance', icon: 'finance' },
  { id: 'book', label: 'Encyclopedia', icon: 'book' },
];
const PROJECT: { id: Screen; label: string; icon: string }[] = [
  { id: 'lab', label: 'Laboratory', icon: 'lab' },
  { id: 'studio', label: 'Engineering Studio', icon: 'studio' },
  { id: 'commission', label: 'Commissioning', icon: 'commission' },
];
const LOCKED = [
  { label: 'Technology Tree', icon: 'tree' },
  { label: 'World Map', icon: 'map' },
];

const STATUS_PILL: Record<string, string> = { design: 'info', building: 'warn', failed: 'fail', completed: 'pass', abandoned: 'fail' };

export function App() {
  const [screen, setScreen] = useState<Screen>('hq');
  const g = useGame();
  const p = useActiveProject();

  useEffect(() => {
    if (!g.toast) return;
    const t = setTimeout(() => g.dismissToast(), 4500);
    return () => clearTimeout(t);
  }, [g.toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeksLeft = p && isLive(p) ? p.startedWeek + p.enquiry.deadlineWeeks - g.week : null;
  const pending = g.projects.some((x) => x.labQueue.length > 0 || x.building);
  const live = g.projects.filter(isLive).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          Effluent Empire
        </div>
        <div className="kpi">
          <span className="label">Company</span>
          <span className="value" style={{ fontFamily: 'var(--font)', fontSize: 13 }}>{g.companyName}</span>
        </div>
        <div className="spacer" />
        <div className="kpi">
          <span className="label">Week</span>
          <span className="value">{g.week}</span>
        </div>
        <div className="kpi">
          <span className="label">Cash</span>
          <span className={`value ${g.cash < 0 ? 'neg' : ''}`}>{rm(g.cash)}</span>
        </div>
        <div className="kpi">
          <span className="label">Reputation</span>
          <span className="value">{g.reputation}</span>
        </div>
        <div className="kpi">
          <span className="label">Plants run</span>
          <span className="value">{g.plants.filter((x) => x.status === 'operating').length}</span>
        </div>
        {weeksLeft !== null && (
          <div className="kpi">
            <span className="label">Deadline</span>
            <span className={`value ${weeksLeft < 0 ? 'neg' : ''}`}>{weeksLeft >= 0 ? `${weeksLeft} wk left` : `${-weeksLeft} wk late`}</span>
          </div>
        )}
        <button className="btn sm" onClick={() => g.advanceWeek(1)} title="Advance one week: payroll, overheads, plant operations, lab results">
          Next week ▸
        </button>
        <button className="btn sm primary" disabled={!pending} onClick={() => g.skipToEvent()} title="Advance until a lab result or commissioning arrives (max 12 weeks)">
          Skip to next event ▸▸
        </button>
      </header>
      <nav className="sidebar">
        <div className="nav-section">Company</div>
        {COMPANY.map((n) => (
          <button key={n.id} className={`nav-item ${screen === n.id ? 'active' : ''}`} onClick={() => setScreen(n.id)}>
            <NavIcon name={n.icon} />
            {n.label}
          </button>
        ))}
        <div className="nav-section">
          Projects ({live}/{projectSlots(g.staff)} engineers)
        </div>
        {g.projects.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '2px 10px' }}>No projects — sign an enquiry.</div>}
        {g.projects.map((x) => (
          <button
            key={x.id}
            className={`nav-item ${g.activeProjectId === x.id ? 'active' : ''}`}
            onClick={() => {
              g.setActiveProject(x.id);
              if (!['lab', 'studio', 'commission'].includes(screen)) setScreen(x.status === 'design' ? 'studio' : 'commission');
            }}
            style={{ fontSize: 12 }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.enquiry.company}</span>
            <span className={`pill ${STATUS_PILL[x.status]}`} style={{ fontSize: 9 }}>
              {x.status === 'building' && x.building ? `wk ${x.building.doneWeek}` : x.status}
            </span>
          </button>
        ))}
        {PROJECT.map((n) => (
          <button key={n.id} className={`nav-item ${screen === n.id ? 'active' : ''}`} onClick={() => setScreen(n.id)} disabled={!p} style={{ paddingLeft: 22 }}>
            <NavIcon name={n.icon} />
            {n.label}
          </button>
        ))}
        <div className="nav-section">Later phases</div>
        {LOCKED.map((n) => (
          <button key={n.label} className="nav-item" disabled title="Coming in a later development phase">
            <NavIcon name={n.icon} />
            {n.label}
            <span className="lock">soon</span>
          </button>
        ))}
      </nav>
      <main className="main">
        {screen === 'hq' && <HQ go={setScreen} />}
        {screen === 'enquiries' && <Enquiries go={setScreen} />}
        {screen === 'lab' && <Laboratory go={setScreen} />}
        {screen === 'studio' && <Studio go={setScreen} />}
        {screen === 'commission' && <Commissioning go={setScreen} />}
        {screen === 'plants' && <Plants />}
        {screen === 'staff' && <Staff />}
        {screen === 'finance' && <Finance />}
        {screen === 'book' && <Encyclopedia />}
        {screen === 'scada' && <Scada />}
      </main>
      {g.toast && (
        <div className="toast" onClick={() => g.dismissToast()}>
          {g.toast}
        </div>
      )}
      {g.gameOver && (
        <div className="toast" style={{ borderColor: 'var(--alarm)', bottom: 'auto', top: 70 }}>
          <b>Insolvent.</b> Your consultancy ran out of credit after {g.negativeWeeks} weeks in overdraft.{' '}
          <button className="btn sm danger" onClick={() => g.newGame()}>
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
