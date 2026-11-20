import { useRef, useState } from 'react';
import { deleteSlot, downloadSave, listSlots, readSlot, SlotMeta, MAX_SLOTS } from '../../game/saves';
import { importSaveFile, openSlot, startNewGame } from '../../game/store';
import { rm } from '../format';

type Panel = 'home' | 'new' | 'load';

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Title screen: continue, new company, save slots, import/export save files. */
export function MainMenu({ onEnter }: { onEnter: () => void }) {
  const [slots, setSlots] = useState<SlotMeta[]>(() => listSlots());
  const [panel, setPanel] = useState<Panel>('home');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = slots[0];
  const full = slots.length >= MAX_SLOTS;

  const open = (id: string) => {
    if (openSlot(id)) onEnter();
    else setMsg('That save could not be read — it may be damaged.');
  };

  return (
    <div className="menu-root">
      <MenuBackdrop />
      <div className="menu-col">
        <div className="menu-brand">
          <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2.5c3.6 4.4 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.4-6.2 6-10.6z" fill="none" stroke="var(--flow)" strokeWidth="1.6" />
            <path d="M8.6 14.2a3.4 3.4 0 0 0 3.4 3.1" fill="none" stroke="var(--clean)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <div>
            <div className="menu-title">EFFLUENT EMPIRE</div>
            <div className="menu-tag">Industrial wastewater engineering consultancy</div>
          </div>
        </div>

        <div className="menu-buttons">
          <button className="menu-btn primary" disabled={!latest} onClick={() => latest && open(latest.id)}>
            <span>Continue</span>
            {latest && (
              <small>
                {latest.company} · week {latest.week} · {rm(latest.cash)}
              </small>
            )}
          </button>
          <button className={`menu-btn ${panel === 'new' ? 'active' : ''}`} onClick={() => setPanel('new')} disabled={full} title={full ? `All ${MAX_SLOTS} slots in use — delete one first` : undefined}>
            <span>New company</span>
            {full && <small>All {MAX_SLOTS} slots in use</small>}
          </button>
          <button className={`menu-btn ${panel === 'load' ? 'active' : ''}`} onClick={() => setPanel('load')} disabled={slots.length === 0}>
            <span>Load game</span>
            <small>{slots.length} save{slots.length === 1 ? '' : 's'}</small>
          </button>
          <button className="menu-btn" onClick={() => fileRef.current?.click()} disabled={full}>
            <span>Import save file</span>
            <small>.json exported from this game</small>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (importSaveFile(await f.text())) onEnter();
              else setMsg(`“${f.name}” is not a valid Effluent Empire save.`);
            }}
          />
        </div>
        {msg && (
          <div className="menu-msg" onClick={() => setMsg(null)}>
            {msg}
          </div>
        )}
        <div className="menu-foot">Saves are kept in this browser. Export a save file to back it up or move it to another computer.</div>
      </div>

      <div className="menu-panel-wrap">
        {panel === 'new' && (
          <form
            className="menu-panel"
            onSubmit={(e) => {
              e.preventDefault();
              startNewGame(name);
              onEnter();
            }}
          >
            <h2>Found a consultancy</h2>
            <p className="muted">One laptop, one engineer and RM 500,000 of capital in Malaysia. Win industrial effluent projects, design plants that really work, and keep them compliant.</p>
            <label className="muted" style={{ fontSize: 12 }}>
              Company name
            </label>
            <input className="menu-input" autoFocus maxLength={48} placeholder="Effluent Engineering Sdn Bhd" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn primary" type="submit">
                Start
              </button>
              <button className="btn ghost" type="button" onClick={() => setPanel('home')}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {panel === 'load' && (
          <div className="menu-panel">
            <h2>Load game</h2>
            {slots.length === 0 && <p className="muted">No saves yet.</p>}
            <div className="slot-list">
              {slots.map((s) => (
                <div key={s.id} className="slot">
                  <div className="slot-main" onClick={() => open(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(s.id)}>
                    <div className="slot-company">{s.company}</div>
                    <div className="slot-meta">
                      Week {s.week} · {rm(s.cash)} · rep {s.reputation} · {s.plants} plant{s.plants === 1 ? '' : 's'} · saved {ago(s.savedAt)}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm primary" onClick={() => open(s.id)}>
                      Load
                    </button>
                    <button
                      className="btn sm ghost"
                      title="Download this save as a .json file"
                      onClick={() => {
                        const raw = readSlot(s.id);
                        if (raw) downloadSave(raw, s.company, s.week);
                      }}
                    >
                      Download
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        if (!confirm(`Delete the save “${s.company}” (week ${s.week})? This cannot be undone — download it first if you may want it back.`)) return;
                        deleteSlot(s.id);
                        const next = listSlots();
                        setSlots(next);
                        if (next.length === 0) setPanel('home');
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Up to {MAX_SLOTS} saves. The game autosaves to its slot as you play.
            </p>
          </div>
        )}

        {panel === 'home' && (
          <div className="menu-panel menu-intro">
            <h2>How it works</h2>
            <ol>
              <li>Pick a customer enquiry — plating, food, semiconductor.</li>
              <li>Characterise the wastewater in the laboratory.</li>
              <li>Design the treatment train in the Engineering Studio.</li>
              <li>Commission it against DOE Standard A/B — the chemistry decides.</li>
              <li>Operate plants from SCADA and grow the company.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/** Quiet 2D process-schematic backdrop: CAD grid, tanks and slowly flowing pipe lines. */
function MenuBackdrop() {
  return (
    <svg className="menu-backdrop" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="mgrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#10243a" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1200" height="800" fill="url(#mgrid)" />
      <g transform="translate(0 170)" opacity="0.7">
      <g fill="none" strokeWidth="2" opacity="0.55">
        <path className="menu-flow" d="M40 560 H250 V500 H420 V560 H600 H760 V480 H930 V560 H1160" stroke="var(--flow)" />
        <path className="menu-flow slow" d="M600 600 V680 H880" stroke="var(--sludge)" />
        <path className="menu-flow" d="M930 520 H1000 V420 H1160" stroke="var(--clean)" />
      </g>
      <g fill="#0c1d30" strokeWidth="1.6" opacity="0.8">
        <rect x="250" y="460" width="170" height="130" rx="6" stroke="var(--phys)" />
        <rect x="470" y="470" width="110" height="110" rx="6" stroke="var(--chem)" />
        <circle cx="680" cy="540" r="62" stroke="var(--phys)" />
        <rect x="760" y="440" width="170" height="150" rx="6" stroke="var(--bio)" />
        <circle cx="1040" cy="540" r="44" stroke="var(--phys)" />
      </g>
      <g fill="#33516f" fontFamily="var(--mono)" fontSize="12">
        <text x="258" y="452">EQ-01</text>
        <text x="478" y="462">NE-02</text>
        <text x="650" y="466">CL-03</text>
        <text x="768" y="432">AS-04</text>
        <text x="1016" y="486">SF-05</text>
      </g>
      </g>
    </svg>
  );
}
