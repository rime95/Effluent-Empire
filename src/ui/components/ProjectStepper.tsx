import { isLive, useActiveProject, useGame } from '../../game/store';
import type { Screen } from '../App';
import { brand } from '../prefs';
import { NavIcon } from './Symbols';

const STEPS: { id: Screen; label: string; icon: string }[] = [
  { id: 'lab', label: 'Laboratory', icon: 'lab' },
  { id: 'studio', label: 'Engineering Studio', icon: 'studio' },
  { id: 'commission', label: 'Commissioning', icon: 'commission' },
];

const STATUS_PILL: Record<string, string> = { design: 'info', building: 'warn', failed: 'fail', completed: 'pass', abandoned: 'fail' };

/** The active project's workflow (Lab → Studio → Commissioning) with a project switcher, above the project screens. */
export function ProjectStepper({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const g = useGame();
  const p = useActiveProject();
  if (!p) return null;
  const weeksLeft = isLive(p) ? p.startedWeek + p.enquiry.deadlineWeeks - g.week : null;
  return (
    <div className="stepper">
      <select className="stepper-project" value={p.id} onChange={(e) => g.setActiveProject(e.target.value)} title="Switch project">
        {g.projects.map((x) => (
          <option key={x.id} value={x.id}>
            {brand(x.enquiry.company)} — {x.status}
          </option>
        ))}
      </select>
      <span className={`pill ${STATUS_PILL[p.status]}`} style={{ fontSize: 10 }}>
        {p.status === 'building' && p.building ? `building · wk ${p.building.doneWeek}` : p.status}
      </span>
      {weeksLeft !== null && <span className={`stepper-deadline ${weeksLeft < 0 ? 'neg' : ''}`}>{weeksLeft >= 0 ? `${weeksLeft} wk left` : `${-weeksLeft} wk late`}</span>}
      <div className="stepper-steps">
        {STEPS.map((s, i) => (
          <button key={s.id} className={`step ${screen === s.id ? 'on' : ''}`} onClick={() => go(s.id)}>
            <span className="step-no">{i + 1}</span>
            <NavIcon name={s.icon} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
