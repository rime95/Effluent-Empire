import { useState } from 'react';
import { CREDIT_LINE, useGame } from '../../game/store';
import { TECH, TECH_ORDER, TIER_REPUTATION, TechCategory, TechId, canResearch } from '../../game/tech';
import { rm } from '../format';

/* Technology Tree: advanced technologies in four tiers (2D SVG), prerequisite links, research with cash. */
const CAT_COLOR: Record<TechCategory, string> = {
  physical: 'var(--phys)',
  chemical: 'var(--chem)',
  biological: 'var(--bio)',
  sludge: '#a0703f',
  membrane: 'var(--clean)',
  recovery: '#c9a227',
};
const W = 210;
const H = 74;
const COL = 270;
const ROW = 104;
const PAD = 24;

function layout(): Record<TechId, { x: number; y: number }> {
  const pos = {} as Record<TechId, { x: number; y: number }>;
  for (const tier of [1, 2, 3, 4] as const) {
    TECH_ORDER.filter((id) => TECH[id].tier === tier).forEach((id, i) => {
      pos[id] = { x: PAD + (tier - 1) * COL, y: PAD + 30 + i * ROW };
    });
  }
  return pos;
}

export function TechTree() {
  const g = useGame();
  const [sel, setSel] = useState<TechId>('daf');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pos = layout();
  const rows = Math.max(...[1, 2, 3, 4].map((t) => TECH_ORDER.filter((id) => TECH[id].tier === t).length));
  const width = PAD * 2 + 3 * COL + W;
  const height = PAD * 2 + 30 + rows * ROW;
  const t = TECH[sel];
  const chk = canResearch(sel, g, CREDIT_LINE);
  const owned = (id: TechId) => g.tech.includes(id);

  return (
    <div className="page">
      <h1>Technology Tree</h1>
      <p className="sub">
        Every basic unit is yours from the start. Advanced technologies are bought outright with cash; each one also opens tougher, better-paid clients that need it.
        Researched: {g.tech.length} / {TECH_ORDER.length}.
      </p>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start' }}>
        <div className="panel" style={{ overflowX: 'auto' }}>
          <svg width={width} height={height} style={{ display: 'block' }}>
            {[1, 2, 3, 4].map((tier) => (
              <text key={tier} x={PAD + (tier - 1) * COL} y={PAD + 8} fill="#8aa0b8" fontSize={11} fontFamily="var(--mono)">
                TIER {tier} · reputation {TIER_REPUTATION[tier as 1 | 2 | 3 | 4]}
              </text>
            ))}
            {TECH_ORDER.flatMap((id) =>
              TECH[id].requires.map((r) => {
                const a = pos[r];
                const b = pos[id];
                const x1 = a.x + W;
                const y1 = a.y + H / 2;
                const x2 = b.x;
                const y2 = b.y + H / 2;
                const mx = (x1 + x2) / 2;
                return <path key={`${r}-${id}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={owned(r) ? 'var(--flow)' : '#35506d'} strokeWidth={owned(r) ? 2 : 1.4} strokeDasharray={owned(r) ? undefined : '5 4'} />;
              }),
            )}
            {TECH_ORDER.map((id) => {
              const d = TECH[id];
              const p = pos[id];
              const have = owned(id);
              const can = canResearch(id, g, CREDIT_LINE).ok;
              const color = CAT_COLOR[d.category];
              return (
                <g key={id} onClick={() => { setSel(id); setMsg(null); }} style={{ cursor: 'pointer' }}>
                  <rect x={p.x} y={p.y} width={W} height={H} rx={8} fill={have ? '#10304a' : '#0d1c2e'} stroke={sel === id ? '#cfe3f7' : have ? 'var(--flow)' : color} strokeWidth={sel === id ? 2.2 : 1.2} opacity={d.available || have ? 1 : 0.55} />
                  <rect x={p.x} y={p.y} width={6} height={H} rx={3} fill={color} />
                  <text x={p.x + 14} y={p.y + 22} fill="#fff" fontSize={12.5} fontWeight={600}>
                    {d.name.length > 28 ? `${d.name.slice(0, 27)}…` : d.name}
                  </text>
                  <text x={p.x + 14} y={p.y + 42} fill="#8aa0b8" fontSize={11} fontFamily="var(--mono)">
                    {have ? 'RESEARCHED' : !d.available ? 'in development' : rm(d.costRM)}
                  </text>
                  <text x={p.x + 14} y={p.y + 60} fill={have ? '#6fd39a' : can ? '#22d3ee' : '#5f7891'} fontSize={10.5}>
                    {have ? '✓ unlocked' : can ? '● ready to research' : d.requires.length ? `needs ${d.requires.map((r) => TECH[r].name.split(' ')[0]).join(', ')}` : `reputation ${d.reputation}`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="panel">
          <div className="nav-section" style={{ padding: 0, color: CAT_COLOR[t.category] }}>
            Tier {t.tier} · {t.category}
          </div>
          <h2 style={{ marginTop: 4 }}>{t.name}</h2>
          <p style={{ fontSize: 13 }}>{t.blurb}</p>
          <div className="calc"><span>Cost</span><span>{rm(t.costRM)}</span></div>
          <div className="calc"><span>Reputation needed</span><span>{t.reputation}</span></div>
          <div className="calc"><span>Requires</span><span>{t.requires.length ? t.requires.map((r) => TECH[r].name).join(', ') : '—'}</span></div>
          <div className="calc"><span>Unlocks in the Studio</span><span>{t.name.replace(/ \(.*\)/, '')}</span></div>
          <h2 style={{ marginTop: 12, fontSize: 12 }}>Opens tougher clients</h2>
          <ul style={{ margin: '4px 0 10px 18px', padding: 0, fontSize: 13 }}>
            {t.clients.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {owned(sel) ? (
            <div className="note info">Researched — available in the Engineering Studio palette.</div>
          ) : (
            <>
              <button className="btn primary" style={{ width: '100%' }} disabled={!chk.ok} onClick={() => setMsg(g.research(sel))}>
                Research — {rm(t.costRM)}
              </button>
              {!chk.ok && <div className="note warn">{chk.reason}</div>}
            </>
          )}
          {msg && <div className={`note ${msg.ok ? 'info' : 'error'}`}>{msg.text}</div>}
          <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Cash: {rm(g.cash)} · credit line {rm(CREDIT_LINE)} · reputation {Math.floor(g.reputation)}</p>
        </div>
      </div>
    </div>
  );
}
