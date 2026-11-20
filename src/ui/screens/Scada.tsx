import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGame } from '../../game/store';
import { Plant } from '../../game/operations';
import { SETPOINTS, availableActions, incidentDisturbances } from '../../game/incidents';
import { cloneStream } from '../../simulation/core/stream';
import { DynamicResult, runDynamic } from '../../simulation/dynamic/plantDynamics';
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { limitsFor } from '../../simulation/treatment/compliance';
import { fmt, INDUSTRY_LABEL, rm } from '../format';

/* SCADA control room: dark mimic + trends + alarms. Ref: knowledge/operations/scada.md */
const BG = '#050c14';
const PANEL = '#0a1622';
const LINE = '#16304a';
const AXIS = { stroke: '#6f88a3', fontSize: 10, fontFamily: 'var(--mono)' };
const CAT_COLOR: Record<string, string> = { chemical: 'var(--chem)', biological: 'var(--bio)', physical: 'var(--phys)' };
const TAG_UNITS: Record<string, string> = { level: '%', outflow: 'm³/d', overflow: 'm³/d', pH: '', pHmeasured: '', pump: '%', sp: '', DO: 'mg/L', MLSS: 'mg/L', NH4: 'mg N/L', NO3: 'mg N/L', OUR: 'mg/L·h', blower: '%', carry: '%', TSS: 'mg/L', SOR: 'm/h' };
const TAG_LABEL: Record<string, string> = { level: 'Level', outflow: 'Outflow', overflow: 'Overflow', pH: 'pH (true)', pHmeasured: 'pH (probe)', pump: 'Dosing pump', sp: 'Set-point', DO: 'DO', MLSS: 'MLSS', NH4: 'NH₄-N', NO3: 'NO₃-N', OUR: 'OUR', blower: 'Blower', carry: 'Solids carry-over', TSS: 'TSS', SOR: 'SOR' };
/** compact axis ticks: no 1e-19 noise when a signal collapses to zero */
const tick = (v: number) => (Math.abs(v) < 1e-3 ? '0' : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(+v.toPrecision(3)));
const SERIES = ['#22d3ee', '#f59e0b', '#a3e635', '#f472b6', '#c084fc', '#94a3b8', '#fb7185'];

interface Alarm {
  t: number;
  text: string;
  level: 'alarm' | 'warn';
}

function alarmsOf(r: DynamicResult, plant: Plant): Alarm[] {
  const out: Alarm[] = [];
  const state = new Map<string, boolean>();
  const raise = (key: string, on: boolean, t: number, text: string, level: Alarm['level']) => {
    if (on && !state.get(key)) out.push({ t, text, level });
    state.set(key, on);
  };
  for (const p of r.points) {
    for (const f of ['pH', 'COD', 'BOD5', 'TSS', 'NH3N', 'Ni', 'Cu', 'Zn', 'CrVI', 'OG']) raise(`eff:${f}`, p.failed.includes(f), p.t, `Final effluent ${f} above limit`, 'alarm');
    for (const n of plant.graph.nodes) {
      const u = p.units[n.id];
      if (!u) continue;
      if (u.DO !== undefined) raise(`${n.id}:DO`, u.DO < 0.5, p.t, `${n.tag} DO LOW (${fmt(u.DO, 2)} mg/L)`, 'alarm');
      if (u.sp !== undefined) raise(`${n.id}:pH`, Math.abs(u.pHmeasured - u.sp) > 0.5, p.t, `${n.tag} pH deviation (probe ${fmt(u.pHmeasured, 2)}, SP ${fmt(u.sp, 1)})`, 'warn');
      if (u.pump !== undefined) raise(`${n.id}:pump`, u.pump > 99, p.t, `${n.tag} dosing pump at 100 %`, 'warn');
      if (u.level !== undefined) raise(`${n.id}:lvl`, u.level > 95, p.t, `${n.tag} level HIGH-HIGH — overflow to drain`, 'alarm');
      if (u.carry !== undefined) raise(`${n.id}:carry`, u.carry > 1.5, p.t, `${n.tag} secondary clarifier solids carry-over`, 'warn');
    }
  }
  return out;
}

export function Scada() {
  const g = useGame();
  const operating = g.plants.filter((p) => p.status === 'operating');
  const [sel, setSel] = useState<string | null>(null);
  const plant = operating.find((p) => p.id === sel) ?? operating[0] ?? null;
  const [unitSel, setUnitSel] = useState<string | null>(null);
  const [result, setResult] = useState<DynamicResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(48);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [effParam, setEffParam] = useState('pH');

  const units = plant ? plant.graph.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge') : [];
  const unit = units.find((u) => u.id === unitSel) ?? units.find((u) => u.kind === 'activatedSludge') ?? units.find((u) => ['neutralisation', 'precipitation'].includes(u.kind)) ?? units[0];
  const runKey = plant ? JSON.stringify([plant.id, plant.graph.nodes.map((n) => n.params), plant.incident?.kind ?? '', plant.incident?.unitId ?? '']) : '';

  const run = () => {
    if (!plant) return;
    setBusy(true);
    // let the "simulating" state paint before the (≈0.5–2 s) integration
    setTimeout(() => {
      const last = plant.history[plant.history.length - 1];
      const inf = cloneStream(plant.trueStream);
      inf.Q *= last?.flowFactor ?? 1;
      const r = runDynamic(plant.graph, inf, plant.standard, { hours: 48, disturbances: incidentDisturbances(plant.incident ?? null), warmBase: plant.trueStream });
      setResult(r);
      setCursor(48);
      setBusy(false);
    }, 30);
  };
  useEffect(() => {
    setResult(null);
    setActionMsg(null);
  }, [plant?.id]);
  useEffect(() => {
    if (plant) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const limits = plant ? limitsFor(plant.standard) : {};
  const alarms = useMemo(() => (result && plant ? alarmsOf(result, plant) : []), [result, plant]);
  const at = result ? result.points.reduce((best, p) => (Math.abs(p.t - cursor) < Math.abs(best.t - cursor) ? p : best), result.points[0]) : null;

  if (!plant)
    return (
      <div className="page">
        <h1>SCADA Operations</h1>
        <div className="panel muted">No operated plants. Commission a plant and accept its O&amp;M contract to monitor it here.</div>
      </div>
    );

  const unitData = result && unit ? result.points.map((p) => ({ t: p.t, ...(p.units[unit.id] ?? {}) })) : [];
  const unitKeys = unitData.length ? Object.keys(unitData[0]).filter((k) => k !== 't' && k !== 'sp') : [];
  const effData = result ? result.points.map((p) => ({ t: p.t, v: p.effluent[effParam], Q: p.Qin })) : [];
  const lim = (limits as Record<string, { max?: number; min?: number }>)[effParam];
  const actions = availableActions(plant.graph);

  return (
    <div className="page" style={{ background: BG, minHeight: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginBottom: 2 }}>SCADA Operations</h1>
        <select value={plant.id} onChange={(e) => setSel(e.target.value)} style={{ background: PANEL, color: '#fff', border: `1px solid ${LINE}`, padding: '5px 8px', borderRadius: 6 }}>
          {operating.map((p) => (
            <option key={p.id} value={p.id}>
              {p.company} — {INDUSTRY_LABEL[p.industry]} {p.incident ? '⚠' : ''}
            </option>
          ))}
        </select>
      </div>
      <p className="sub">48-hour replay of the plant on its real influent with the diurnal production pattern: ASM1 biology, PI pH and DO loops, EQ level. Diagnose alarms from the trends, then act.</p>

      {/* incident banner */}
      {plant.incident ? (
        <div className="panel" style={{ borderColor: 'var(--alarm)', background: '#1d0d10', marginBottom: 12 }}>
          <div style={{ color: '#ff9c9c', fontWeight: 600, marginBottom: 4 }}>ACTIVE INCIDENT — since week {plant.incident.startWeek}</div>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {plant.incident.symptoms.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {plant.incident.tried.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Already tried: {plant.incident.tried.map((t) => actions.find((a) => a.id === t)?.label ?? t).join('; ')}</div>}
        </div>
      ) : (
        <div className="panel" style={{ background: PANEL, borderColor: LINE, marginBottom: 12, color: '#6fd39a' }}>
          No active incident. Weekly grab sample: {plant.history.length ? (plant.history[plant.history.length - 1].pass ? 'compliant' : `non-compliant (${plant.history[plant.history.length - 1].failed.join(', ')})`) : '—'}
        </div>
      )}
      {actionMsg && (
        <div className="panel" style={{ marginBottom: 12, borderColor: actionMsg.ok ? 'var(--ok)' : 'var(--warn)', background: PANEL }}>
          {actionMsg.text}
        </div>
      )}

      {/* mimic */}
      <div className="panel" style={{ background: PANEL, borderColor: LINE, marginBottom: 12, overflowX: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <b style={{ color: '#cfe3f7' }}>Process mimic {at ? `— t = ${fmt(at.t, 2)} h` : ''}</b>
          <div className="row" style={{ gap: 8 }}>
            <input type="range" min={0} max={48} step={0.25} value={cursor} onChange={(e) => setCursor(Number(e.target.value))} style={{ width: 220 }} disabled={!result} />
            <button className="btn sm" onClick={run} disabled={busy}>
              {busy ? 'Simulating…' : 'Re-run 48 h'}
            </button>
          </div>
        </div>
        <svg width={Math.max(640, units.length * 150 + 160)} height={140} style={{ display: 'block' }}>
          <defs>
            <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--flow)" />
            </marker>
          </defs>
          <text x={8} y={70} fill="#8aa0b8" fontSize={11} fontFamily="var(--mono)">
            IN {at ? fmt(at.Qin, 0) : '—'}
          </text>
          <text x={8} y={84} fill="#5f7891" fontSize={10} fontFamily="var(--mono)">
            m³/d
          </text>
          {units.map((u, i) => {
            const x = 80 + i * 150;
            const cat = CATALOGUE[u.kind as UnitType]?.category ?? 'physical';
            const vals = at?.units[u.id] ?? {};
            const alarm = (vals.DO !== undefined && vals.DO < 0.5) || (vals.sp !== undefined && Math.abs(vals.pHmeasured - vals.sp) > 0.5) || (vals.level !== undefined && vals.level > 95);
            const entries = Object.entries(vals).filter(([k]) => k !== 'sp').slice(0, 3);
            return (
              <g key={u.id} onClick={() => setUnitSel(u.id)} style={{ cursor: 'pointer' }}>
                <line x1={x - 40} y1={60} x2={x} y2={60} stroke="var(--flow)" strokeWidth={2} markerEnd="url(#arr)" />
                <rect x={x} y={20} width={110} height={100} rx={6} fill="#0d1f31" stroke={alarm ? 'var(--alarm)' : unit?.id === u.id ? '#cfe3f7' : CAT_COLOR[cat]} strokeWidth={alarm || unit?.id === u.id ? 2 : 1.2}>
                  {alarm && <animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
                </rect>
                <rect x={x} y={20} width={110} height={18} rx={6} fill={CAT_COLOR[cat]} opacity={0.25} />
                <text x={x + 6} y={33} fill="#fff" fontSize={11} fontWeight={600} fontFamily="var(--mono)">
                  {u.tag}
                </text>
                <text x={x + 104} y={33} fill="#8aa0b8" fontSize={9} textAnchor="end">
                  {CATALOGUE[u.kind as UnitType]?.name.split(' ')[0]}
                </text>
                {entries.map(([k, v], j) => (
                  <text key={k} x={x + 6} y={56 + j * 18} fill="#cfe3f7" fontSize={10.5} fontFamily="var(--mono)">
                    {(TAG_LABEL[k] ?? k).slice(0, 9).padEnd(9, ' ')} {fmt(v, k === 'pH' || k === 'pHmeasured' || k === 'DO' ? 2 : 0)}
                  </text>
                ))}
              </g>
            );
          })}
          <line x1={80 + units.length * 150 - 40} y1={60} x2={80 + units.length * 150} y2={60} stroke="var(--clean)" strokeWidth={2} markerEnd="url(#arr)" />
          <text x={80 + units.length * 150 + 6} y={56} fill={at && !at.pass ? '#ff8a8a' : '#6fd39a'} fontSize={11} fontFamily="var(--mono)">
            OUT {at ? (at.pass ? 'OK' : at.failed.join(',')) : '—'}
          </text>
          <text x={80 + units.length * 150 + 6} y={72} fill="#8aa0b8" fontSize={10} fontFamily="var(--mono)">
            pH {at ? fmt(at.effluent.pH, 2) : '—'}
          </text>
        </svg>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <div className="grid">
          {/* unit trends */}
          <div className="panel" style={{ background: PANEL, borderColor: LINE }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ color: '#cfe3f7' }}>
                {unit?.tag} — {unit && CATALOGUE[unit.kind as UnitType]?.name}
              </b>
              <span className="muted" style={{ fontSize: 11 }}>click a unit in the mimic to trend it</span>
            </div>
            <div style={{ height: 220 }}>
              {result ? (
                <ResponsiveContainer>
                  <LineChart data={unitData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={LINE} />
                    <XAxis dataKey="t" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} {...AXIS} unit=" h" />
                    {unitKeys.map((k, i) => (
                      <YAxis key={k} yAxisId={k} hide={i > 0} {...AXIS} domain={['auto', 'auto']} tickFormatter={tick} width={44} />
                    ))}
                    <Tooltip contentStyle={{ background: '#0d1c2e', border: `1px solid ${LINE}` }} formatter={(v: number, n: string) => [`${fmt(v, 2)} ${TAG_UNITS[n] ?? ''}`, TAG_LABEL[n] ?? n]} labelFormatter={(l) => `t = ${l} h`} />
                    <Legend formatter={(n: string) => TAG_LABEL[n] ?? n} wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={cursor} yAxisId={unitKeys[0]} stroke="#cfe3f7" strokeDasharray="2 3" />
                    {unitKeys.map((k, i) => (
                      <Line key={k} yAxisId={k} dataKey={k} stroke={SERIES[i % SERIES.length]} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="muted">{busy ? 'Simulating…' : '—'}</div>
              )}
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Each series has its own scale; hover for values.</p>
          </div>

          {/* effluent */}
          <div className="panel" style={{ background: PANEL, borderColor: LINE }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ color: '#cfe3f7' }}>Final effluent vs Standard {plant.standard}</b>
              <div className="row" style={{ gap: 4 }}>
                {['pH', 'COD', 'BOD5', 'TSS', 'NH3N', 'Ni', 'Cu', 'Zn', 'CrVI', 'OG']
                  .filter((k) => (limits as Record<string, unknown>)[k])
                  .map((k) => (
                    <button key={k} className={`btn sm ${effParam === k ? 'primary' : 'ghost'}`} onClick={() => setEffParam(k)}>
                      {k}
                    </button>
                  ))}
              </div>
            </div>
            <div style={{ height: 200 }}>
              {result && (
                <ResponsiveContainer>
                  <LineChart data={effData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={LINE} />
                    <XAxis dataKey="t" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} {...AXIS} unit=" h" />
                    <YAxis yAxisId="v" {...AXIS} domain={['auto', 'auto']} tickFormatter={tick} width={44} />
                    <YAxis yAxisId="Q" orientation="right" {...AXIS} tickFormatter={tick} width={44} />
                    <Tooltip contentStyle={{ background: '#0d1c2e', border: `1px solid ${LINE}` }} formatter={(v: number, n: string) => [fmt(v, 2), n === 'v' ? effParam : 'Influent Q m³/d']} labelFormatter={(l) => `t = ${l} h`} />
                    {lim?.max !== undefined && <ReferenceArea yAxisId="v" y1={lim.max} fill="var(--alarm)" fillOpacity={0.08} />}
                    {lim?.max !== undefined && <ReferenceLine yAxisId="v" y={lim.max} stroke="var(--alarm)" strokeDasharray="4 3" />}
                    {lim?.min !== undefined && <ReferenceLine yAxisId="v" y={lim.min} stroke="var(--alarm)" strokeDasharray="4 3" />}
                    <ReferenceLine x={cursor} yAxisId="v" stroke="#cfe3f7" strokeDasharray="2 3" />
                    <Line yAxisId="Q" dataKey="Q" stroke="#3d6f9e" dot={false} strokeWidth={1} isAnimationActive={false} />
                    <Line yAxisId="v" dataKey="v" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            {result && (
              <div className="row" style={{ gap: 18, fontSize: 12, marginTop: 4 }}>
                <span>
                  Compliant <b style={{ color: result.compliantFraction > 0.99 ? '#6fd39a' : '#ff8a8a' }}>{fmt(100 * result.compliantFraction, 0)} %</b> of time
                </span>
                {result.worst && (
                  <span>
                    Worst: <b style={{ color: '#ff8a8a' }}>{result.worst.param} {fmt(result.worst.value, 2)}</b> (limit {result.worst.limit})
                  </span>
                )}
                <span className="muted">Aeration {fmt(result.energy_kWh / 2, 0)} kWh/d · reagent {fmt(result.reagent_kg / 2, 1)} kg/d · overflow {fmt(result.overflowM3, 0)} m³</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          {/* alarms */}
          <div className="panel" style={{ background: PANEL, borderColor: LINE, maxHeight: 260, overflowY: 'auto' }}>
            <b style={{ color: '#cfe3f7' }}>Alarm log</b>
            {alarms.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>No alarms in the replay.</div>}
            {alarms.map((a, i) => (
              <div key={i} style={{ fontSize: 12, fontFamily: 'var(--mono)', marginTop: 4, color: a.level === 'alarm' ? '#ff8a8a' : '#f3c95a', cursor: 'pointer' }} onClick={() => setCursor(a.t)}>
                {String(Math.floor(a.t)).padStart(2, '0')}:{String(Math.round((a.t % 1) * 60)).padStart(2, '0')} {a.text}
              </div>
            ))}
          </div>

          {/* set-points */}
          {unit && <SetpointPanel plant={plant} nodeId={unit.id} />}

          {/* actions */}
          <div className="panel" style={{ background: PANEL, borderColor: LINE }}>
            <b style={{ color: '#cfe3f7' }}>Field actions</b>
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 8px' }}>Costs are charged even if the action does not address the cause.</p>
            {actions.map((a) => (
              <button
                key={a.id}
                className="btn sm"
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 6, textAlign: 'left' }}
                disabled={!plant.incident || plant.incident.tried.includes(a.id)}
                onClick={() => setActionMsg(g.resolveIncident(plant.id, a.id))}
              >
                <span>{a.label}</span>
                <span style={{ fontFamily: 'var(--mono)', marginLeft: 8 }}>{a.cost ? rm(a.cost) : 'free'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetpointPanel({ plant, nodeId }: { plant: Plant; nodeId: string }) {
  const g = useGame();
  const node = plant.graph.nodes.find((n) => n.id === nodeId);
  const defs = node ? SETPOINTS[node.kind] ?? [] : [];
  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => setDraft({}), [nodeId, plant.id]);
  if (!node) return null;
  return (
    <div className="panel" style={{ background: PANEL, borderColor: LINE }}>
      <b style={{ color: '#cfe3f7' }}>Set-points — {node.tag}</b>
      {defs.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>No operator set-points on this unit.</div>}
      {defs.map((d) => {
        const cur = Number(node.params[d.key]);
        const v = draft[d.key] ?? cur;
        return (
          <div key={d.key} style={{ marginTop: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span>{d.label}</span>
              <span style={{ fontFamily: 'var(--mono)' }}>{fmt(v, d.step < 1 ? 1 : 0)}</span>
            </div>
            <input type="range" min={d.min} max={d.max} step={d.step} value={v} onChange={(e) => setDraft({ ...draft, [d.key]: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
        );
      })}
      {defs.length > 0 && (
        <button
          className="btn sm primary"
          style={{ marginTop: 8 }}
          disabled={Object.keys(draft).length === 0}
          onClick={() => {
            for (const [k, v] of Object.entries(draft)) g.setSetpoint(plant.id, node.id, k, v);
            setDraft({});
          }}
        >
          Apply to plant
        </button>
      )}
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>Changes persist into the operated plant and affect weekly samples and OPEX.</p>
    </div>
  );
}
