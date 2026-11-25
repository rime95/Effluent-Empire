import { useEffect, useState } from 'react';
import { closeGame, engineersBusy, exportSave, isLive, saveAsNewSlot, saveNow, useActiveProject, useGame } from '../game/store';
import { downloadSave } from '../game/saves';
import { MainMenu } from './screens/MainMenu';
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
import { TechTree } from './screens/TechTree';
import { Developer } from './screens/Developer';
import { ProjectStepper } from './components/ProjectStepper';
import { useLayout } from './layout';
import { usePrefs } from './prefs';
import { brand } from './prefs';

export type Screen = 'hq' | 'enquiries' | 'lab' | 'studio' | 'commission' | 'plants' | 'staff' | 'finance' | 'book' | 'scada' | 'tech' | 'dev';

type NavEntry = { id: Screen; label: string; icon: string };
const BUSINESS: NavEntry[] = [
  { id: 'hq', label: 'Company HQ', icon: 'hq' },
  { id: 'enquiries', label: 'Customer Enquiries', icon: 'enquiries' },
  { id: 'finance', label: 'Finance', icon: 'finance' },
  { id: 'staff', label: 'Employees', icon: 'staff' },
];
const ENGINEERING_AFTER: NavEntry[] = [
  { id: 'tech', label: 'Technology Tree', icon: 'tree' },
  { id: 'book', label: 'Encyclopedia', icon: 'book' },
];
const OPERATIONS: NavEntry[] = [
  { id: 'plants', label: 'Plants & O&M', icon: 'plant' },
  { id: 'scada', label: 'SCADA Operations', icon: 'scada' },
];
const PROJECT_SCREENS: Screen[] = ['lab', 'studio', 'commission'];
/** screens built around a large drawing canvas: the sidebar folds to an icon rail on entry */
const CANVAS_SCREENS: Screen[] = ['studio', 'scada'];

const STATUS_PILL: Record<string, string> = { design: 'info', building: 'warn', failed: 'fail', completed: 'pass', abandoned: 'fail' };

export function App() {
  const [inGame, setInGame] = useState(false);
  if (!inGame) return <MainMenu onEnter={() => setInGame(true)} />;
  return <Game onQuit={() => setInGame(false)} />;
}

function Game({ onQuit }: { onQuit: () => void }) {
  const [screen, setScreen] = useState<Screen>('hq');
  const [paused, setPaused] = useState(false);
  const g = useGame();
  const p = useActiveProject();
  usePrefs(); // re-render on display-preference changes (fictional names)
  const lay = useLayout();
  // canvas screens fold the sidebar on entry; your own choice applies everywhere else
  const isCanvas = CANVAS_SCREENS.includes(screen);
  const [canvasNav, setCanvasNav] = useState(true);
  useEffect(() => {
    if (isCanvas) setCanvasNav(true);
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps
  const navCollapsed = isCanvas ? canvasNav : lay.navCollapsed;
  const toggleNav = () => (isCanvas ? setCanvasNav((v) => !v) : lay.setNavCollapsed(!lay.navCollapsed));
  const [projOpen, setProjOpen] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && !typing) {
        // Esc leaves focus mode first, then toggles the pause menu
        if (useLayout.getState().focus) useLayout.getState().setFocus(false);
        else setPaused((x) => !x);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !typing) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('ee-toggle-nav'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const h = () => toggleNav();
    document.addEventListener('ee-toggle-nav', h);
    return () => document.removeEventListener('ee-toggle-nav', h);
  });
  // focus mode only makes sense on the canvas screens
  useEffect(() => {
    if (!isCanvas && lay.focus) lay.setFocus(false);
  }, [isCanvas]); // eslint-disable-line react-hooks/exhaustive-deps

  /** open the active project at its current step (or the first project) */
  const openProjects = () => {
    const target = p ?? g.projects[0];
    if (!target) return setScreen('enquiries');
    if (!p) g.setActiveProject(target.id);
    g.openPlantStudio(null);
    setScreen(target.status === 'design' ? 'studio' : 'commission');
  };
  const quit = () => {
    closeGame();
    onQuit();
  };

  useEffect(() => {
    if (!g.toast) return;
    const t = setTimeout(() => g.dismissToast(), 4500);
    return () => clearTimeout(t);
  }, [g.toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeksLeft = p && isLive(p) ? p.startedWeek + p.enquiry.deadlineWeeks - g.week : null;
  const pending = g.projects.some((x) => x.labQueue.length > 0 || x.building);
  const live = engineersBusy(g);

  return (
    <div className={`app ${navCollapsed ? 'nav-rail' : ''} ${lay.focus ? 'focus' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          Effluent Empire
          {g.devMode && <span className="pill warn" style={{ marginLeft: 8, fontSize: 9 }} title="Developer mode is on for this company">DEV</span>}
        </div>
        {lay.focus && (
          <button className="btn sm" onClick={() => lay.setFocus(false)} title="Leave focus mode (Esc)">
            ✕ Exit focus
          </button>
        )}
        <div className="kpi hide-focus">
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
        <div className="kpi hide-focus">
          <span className="label">Plants run</span>
          <span className="value">{g.plants.filter((x) => x.status === 'operating').length}</span>
        </div>
        {weeksLeft !== null && (
          <div className="kpi">
            <span className="label">Deadline</span>
            <span className={`value ${weeksLeft < 0 ? 'neg' : ''}`}>{weeksLeft >= 0 ? `${weeksLeft} wk left` : `${-weeksLeft} wk late`}</span>
          </div>
        )}
        <button className="btn sm ghost hide-focus" onClick={() => setPaused(true)} title="Menu (Esc): save, download save file, quit to main menu">
          ☰ Menu
        </button>
        <button className="btn sm" onClick={() => g.advanceWeek(1)} title="Advance one week: payroll, overheads, plant operations, lab results">
          Next week ▸
        </button>
        <button className="btn sm primary" disabled={!pending} onClick={() => g.skipToEvent()} title="Advance until a lab result or commissioning arrives (max 12 weeks)">
          Skip to next event ▸▸
        </button>
      </header>
      {!lay.focus && (
        <nav className={`sidebar ${navCollapsed ? 'rail' : ''}`}>
          <button className="nav-item nav-toggle" onClick={toggleNav} title={navCollapsed ? 'Expand the menu (Ctrl+B)' : 'Collapse to icons (Ctrl+B)'}>
            <NavIcon name={navCollapsed ? 'expand' : 'collapse'} />
            <span className="nav-label">Collapse menu</span>
          </button>
          <div className="nav-section">Business</div>
          {BUSINESS.map((n) => (
            <NavButton key={n.id} n={n} active={screen === n.id} onClick={() => setScreen(n.id)} />
          ))}
          <div className="nav-section">Engineering</div>
          <button
            className={`nav-item ${PROJECT_SCREENS.includes(screen) && !(screen === 'studio' && g.studioPlantId) ? 'active' : ''}`}
            onClick={() => {
              openProjects();
              if (!navCollapsed) setProjOpen(true);
            }}
            title={`Projects — ${live} of ${projectSlots(g.staff)} engineers busy`}
          >
            <NavIcon name="projects" />
            <span className="nav-label">Projects</span>
            <span className="nav-badge">
              {live}/{projectSlots(g.staff)}
            </span>
            {!navCollapsed && g.projects.length > 0 && (
              <span
                className="nav-caret"
                onClick={(e) => {
                  e.stopPropagation();
                  setProjOpen((v) => !v);
                }}
                title={projOpen ? 'Hide the project list' : 'Show the project list'}
              >
                {projOpen ? '▾' : '▸'}
              </span>
            )}
          </button>
          {!navCollapsed &&
            projOpen &&
            g.projects.map((x) => (
              <button
                key={x.id}
                className={`nav-item nav-sub ${g.activeProjectId === x.id && PROJECT_SCREENS.includes(screen) && !g.studioPlantId ? 'active' : ''}`}
                onClick={() => {
                  g.setActiveProject(x.id);
                  if (!PROJECT_SCREENS.includes(screen) || g.studioPlantId) setScreen(x.status === 'design' ? 'studio' : 'commission');
                }}
              >
                <span className="nav-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand(x.enquiry.company)}</span>
                <span className={`pill ${STATUS_PILL[x.status]}`} style={{ fontSize: 9 }}>
                  {x.status === 'building' && x.building ? `wk ${x.building.doneWeek}` : x.status}
                </span>
              </button>
            ))}
          {ENGINEERING_AFTER.map((n) => (
            <NavButton key={n.id} n={n} active={screen === n.id} onClick={() => setScreen(n.id)} />
          ))}
          <div className="nav-section">Operations</div>
          {OPERATIONS.map((n) => (
            <NavButton key={n.id} n={n} active={screen === n.id || (n.id === 'plants' && screen === 'studio' && !!g.studioPlantId)} onClick={() => setScreen(n.id)} />
          ))}
          {g.devMode && (
            <>
              <div className="nav-section">Testing</div>
              <NavButton n={{ id: 'dev', label: 'Developer tools', icon: 'dev' }} active={screen === 'dev'} onClick={() => setScreen('dev')} />
            </>
          )}
        </nav>
      )}
      <main className={`main ${screen === 'studio' ? 'canvas' : ''}`}>
        {PROJECT_SCREENS.includes(screen) && !(screen === 'studio' && g.studioPlantId) && !lay.focus && <ProjectStepper screen={screen} go={setScreen} />}
        {screen === 'studio' && g.studioPlantId && !lay.focus && <PlantBar go={setScreen} />}
        {screen === 'hq' && <HQ go={setScreen} />}
        {screen === 'enquiries' && <Enquiries go={setScreen} />}
        {screen === 'lab' && <Laboratory go={setScreen} />}
        {screen === 'studio' && <Studio go={setScreen} />}
        {screen === 'commission' && <Commissioning go={setScreen} />}
        {screen === 'plants' && <Plants go={setScreen} />}
        {screen === 'staff' && <Staff />}
        {screen === 'finance' && <Finance />}
        {screen === 'book' && <Encyclopedia />}
        {screen === 'scada' && <Scada go={setScreen} />}
        {screen === 'tech' && <TechTree />}
        {screen === 'dev' && g.devMode && <Developer go={setScreen} />}
      </main>
      {g.toast && (
        <div className="toast" onClick={() => g.dismissToast()}>
          {brand(g.toast)}
        </div>
      )}
      {paused && <PauseMenu onResume={() => setPaused(false)} onQuit={quit} />}
      {g.gameOver && (
        <div className="toast" style={{ borderColor: 'var(--alarm)', bottom: 'auto', top: 70 }}>
          <b>Insolvent.</b> Your consultancy was beyond its credit line for {g.negativeWeeks} weeks.{' '}
          <button className="btn sm danger" onClick={quit}>
            Main menu
          </button>
        </div>
      )}
    </div>
  );
}

function NavButton({ n, active, onClick }: { n: NavEntry; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} title={n.label}>
      <NavIcon name={n.icon} />
      <span className="nav-label">{n.label}</span>
    </button>
  );
}

/** Header over an operating plant's as-built PFD (in place of the project stepper). */
function PlantBar({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const plant = g.plants.find((x) => x.id === g.studioPlantId);
  if (!plant) return null;
  return (
    <div className="stepper">
      <button className="btn sm ghost" onClick={() => go('plants')}>
        ‹ Plants &amp; O&amp;M
      </button>
      <span className="stepper-title">As-built PFD / P&amp;ID — {brand(plant.company)}</span>
      <span className={`pill ${plant.upgrade?.phase === 'building' ? 'warn' : plant.upgrade ? 'info' : 'pass'}`} style={{ fontSize: 10 }}>
        {plant.upgrade?.phase === 'building' ? `upgrade · wk ${plant.upgrade.doneWeek}` : plant.upgrade ? 'upgrade draft' : 'operating'}
      </span>
      <div className="stepper-steps">
        <button className="step" onClick={() => go('scada')}>
          <NavIcon name="scada" />
          SCADA
        </button>
      </div>
    </div>
  );
}

function PauseMenu({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  const g = useGame();
  const prefs = usePrefs();
  const [msg, setMsg] = useState<string | null>(null);
  const report = (r: { ok: boolean; error?: string }, okText: string) => setMsg(r.ok ? okText : r.error ?? 'Save failed.');
  return (
    <div className="modal-backdrop" onClick={onResume}>
      <div className="modal pause" onClick={(e) => e.stopPropagation()}>
        <div className="pause-head">
          <div className="pause-title">Paused</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {g.companyName} · week {g.week}
          </div>
        </div>
        <button className="menu-btn primary" onClick={onResume}>
          <span>Resume</span>
          <small>Esc</small>
        </button>
        <button className="menu-btn" onClick={() => report(saveNow(), 'Saved.')}>
          <span>Save</span>
          <small>the game also autosaves</small>
        </button>
        <button className="menu-btn" onClick={() => report(saveAsNewSlot(), 'Saved as a new slot — you are now playing in the copy.')}>
          <span>Save as new slot</span>
          <small>branch your company</small>
        </button>
        <button className="menu-btn" onClick={() => downloadSave(exportSave(), g.companyName, g.week)}>
          <span>Download save file</span>
          <small>.json backup you can import later</small>
        </button>
        <label className="menu-btn" style={{ cursor: 'pointer' }} title="Show a fictional alias instead of every real company name (medium and multinational clients). Saves keep the real names.">
          <span>
            <input type="checkbox" checked={prefs.fictionalNames} onChange={(e) => prefs.setFictionalNames(e.target.checked)} style={{ marginRight: 8 }} />
            Use fictional names for all clients
          </span>
          <small>this device</small>
        </label>
        <label className="menu-btn" style={{ cursor: 'pointer' }} title="Testing tools: cash, reputation, unlock all technology, spawn any client type, load reference designs. Marks this save DEV.">
          <span>
            <input
              type="checkbox"
              checked={Boolean(g.devMode)}
              onChange={(e) => {
                if (e.target.checked && !g.devUsed && !confirm('Switch on developer mode for this company? Its tools change cash, reputation and technology, and the save is marked DEV. Tip: “Save as new slot” first to keep your real company untouched.')) return;
                g.setDevMode(e.target.checked);
              }}
              style={{ marginRight: 8 }}
            />
            Developer mode
          </span>
          <small>{g.devUsed ? 'save marked DEV' : 'testing tools'}</small>
        </label>
        <button className="menu-btn" onClick={onQuit}>
          <span>Save &amp; quit to main menu</span>
        </button>
        {msg && <div className="menu-msg">{msg}</div>}
      </div>
    </div>
  );
}
