import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../game/store';
import { Plant, degradedGraph } from '../../game/operations';
import { commissioningInfluent } from '../../game/project';
import { TrendChart, TrendRef, TrendSeries } from '../components/TrendChart';
import { AXIS_GROUPS, clockLabel, groupByUnit, groupOf } from '../components/trendScale';
import { SETPOINTS, availableActions, incidentDisturbances } from '../../game/incidents';
import { cloneStream } from '../../simulation/core/stream';
import { DynamicResult, runDynamic } from '../../simulation/dynamic/plantDynamics';
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { limitsFor } from '../../simulation/treatment/compliance';
import { hasInst } from '../../simulation/treatment/instrumentation';
import type { PNode } from '../../simulation/treatment/graph';

/** Tags a unit can show in SCADA: without the instrument there is no signal (knowledge/operations/instrumentation.md). */
function tagVisible(n: PNode | undefined, key: string): boolean {
  if (!n) return true;
  if (key === 'bypassed') return false;
  if (['pH', 'pHmeasured', 'pump', 'sp'].includes(key) && ['neutralisation', 'precipitation', 'coagulation'].includes(n.kind)) return hasInst(n, 'pHLoop');
  if (['DO', 'blower'].includes(key) && n.kind === 'activatedSludge') return hasInst(n, 'doLoop');
  if (['level', 'overflow'].includes(key) && n.kind === 'eq') return hasInst(n, 'level');
  return true;
}
import { fmt, INDUSTRY_LABEL, rm } from '../format';
import type { Screen } from '../App';
import { brand } from '../prefs';

/* SCADA control room: dark mimic + trends + alarms. Ref: knowledge/operations/scada.md */
const BG = '#050c14';
const PANEL = '#0a1622';
const LINE = '#16304a';
const CAT_COLOR: Record<string, string> = { chemical: 'var(--chem)', biological: 'var(--bio)', physical: 'var(--phys)' };
const TAG_UNITS: Record<string, string> = { level: '%', outflow: 'm³/d', overflow: 'm³/d', pH: '', pHmeasured: '', pump: '%', sp: '', DO: 'mg/L', MLSS: 'mg/L', NH4: 'mg N/L', NO3: 'mg N/L', OUR: 'mg/L·h', blower: '%', carry: '%', TSS: 'mg/L', SOR: 'm/h' };
const TAG_LABEL: Record<string, string> = { level: 'Level', outflow: 'Outflow', overflow: 'Overflow', pH: 'pH (true)', pHmeasured: 'pH (probe)', pump: 'Dosing pump', sp: 'Set-point', DO: 'DO', MLSS: 'MLSS', NH4: 'NH₄-N', NO3: 'NO₃-N', OUR: 'OUR', blower: 'Blower', carry: 'Solids carry-over', TSS: 'TSS', SOR: 'SOR (peak)' };
/** mimic labels (fit the 110 px faceplate) and display decimals per tag */
const TAG_SHORT: Record<string, string> = { level: 'Level', outflow: 'Out Q', overflow: 'Overflow', pH: 'pH', pHmeasured: 'pH probe', pump: 'Pump', DO: 'DO', MLSS: 'MLSS', NH4: 'NH₄-N', NO3: 'NO₃-N', OUR: 'OUR', blower: 'Blower', carry: 'Carry-ov', TSS: 'TSS', SOR: 'SOR' };
const TAG_DP: Record<string, number> = { pH: 2, pHmeasured: 2, DO: 2, NH4: 1, NO3: 1, carry: 1, SOR: 2, OUR: 1 };
/** tags trended by default when a unit is selected */
function defaultTags(kind: string, keys: string[]): string[] {
  const pref: Record<string, string[]> = { neutralisation: ['pH', 'pHmeasured', 'pump'], precipitation: ['pH', 'pHmeasured', 'pump'], coagulation: ['pH', 'pHmeasured'], crReduction: ['pH', 'pHmeasured'], activatedSludge: ['DO', 'blower'], eq: ['level', 'outflow'], clarifier: ['TSS'] };
  const want = (pref[kind] ?? keys.slice(0, 2)).filter((k) => keys.includes(k));
  return want.length ? want : keys.slice(0, 1);
}
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
      if (u.DO !== undefined && tagVisible(n, 'DO')) raise(`${n.id}:DO`, u.DO < 0.5, p.t, `${n.tag} DO LOW (${fmt(u.DO, 2)} mg/L)`, 'alarm');
      if (u.sp !== undefined && tagVisible(n, 'sp')) raise(`${n.id}:pH`, Math.abs(u.pHmeasured - u.sp) > 0.5, p.t, `${n.tag} pH deviation (probe ${fmt(u.pHmeasured, 2)}, SP ${fmt(u.sp, 1)})`, 'warn');
      if (u.pump !== undefined && tagVisible(n, 'pump')) raise(`${n.id}:pump`, u.pump > 99, p.t, `${n.tag} dosing pump at 100 %`, 'warn');
      if (u.level !== undefined && tagVisible(n, 'level')) raise(`${n.id}:lvl`, u.level > 95, p.t, `${n.tag} level HIGH-HIGH — overflow to drain`, 'alarm');
      if (u.carry !== undefined) raise(`${n.id}:carry`, u.carry > 1.5, p.t, `${n.tag} secondary clarifier solids carry-over`, 'warn');
    }
  }
  return out;
}

export function Scada({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const operating = g.plants.filter((p) => p.status === 'operating');
  // opened from a plant's PFD or the Plants screen → start on that plant
  const [sel, setSel] = useState<string | null>(g.studioPlantId ?? null);
  const plant = operating.find((p) => p.id === sel) ?? operating[0] ?? null;
  const [unitSel, setUnitSel] = useState<string | null>(null);
  const [result, setResult] = useState<DynamicResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(48);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [effParam, setEffParam] = useState('pH');
  const [tagSel, setTagSel] = useState<Record<string, string[]>>({});

  const units = plant ? plant.graph.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge') : [];
  const unit = units.find((u) => u.id === unitSel) ?? units.find((u) => u.kind === 'activatedSludge') ?? units.find((u) => ['neutralisation', 'precipitation'].includes(u.kind)) ?? units[0];
  const lastWeek = plant?.history[plant.history.length - 1];
  // the replay is the plant as it runs THIS week: this week's influent, growth, breakdown and incident (same basis as the weekly sample)
  const runKey = plant ? JSON.stringify([plant.id, lastWeek?.week ?? -1, plant.graph.nodes.map((n) => [n.params, n.inst ?? null]), plant.breakdown?.unitId ?? '', plant.incident?.kind ?? '', plant.incident?.unitId ?? '']) : '';

  const run = () => {
    if (!plant) return;
    setBusy(true);
    // let the "simulating" state paint before the (≈0.5–2 s) integration
    setTimeout(() => {
      const last = plant.history[plant.history.length - 1];
      const inf = cloneStream(last ? commissioningInfluent(plant.trueStream, plant.seed * 97 + last.week) : plant.trueStream);
      inf.Q *= last?.flowFactor ?? 1;
      const r = runDynamic(degradedGraph(plant.graph, plant.breakdown), inf, plant.standard, { hours: 48, disturbances: incidentDisturbances(plant.incident ?? null), warmBase: plant.trueStream });
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

  const unitData: Record<string, number>[] = result && unit ? result.points.map((p) => ({ t: p.t, ...(p.units[unit.id] ?? {}) })) : [];
  // every tag that appears anywhere in the replay (a unit can start reporting a tag part-way through)
  const allKeys = [...new Set(unitData.flatMap((d) => Object.keys(d)))].filter((k) => k !== 't' && k !== 'sp');
  const unitKeys = allKeys.filter((k) => tagVisible(unit, k));
  const hidden = allKeys.filter((k) => k !== 'bypassed' && !tagVisible(unit, k));
  const bypassed = allKeys.includes('bypassed');
  const chosen = unit ? (tagSel[unit.id] ?? defaultTags(unit.kind, unitKeys)).filter((k) => unitKeys.includes(k)) : [];
  const layout = groupByUnit(chosen);
  const unitSeries: TrendSeries[] = [...(layout.left?.tags ?? []), ...(layout.right?.tags ?? [])].map((k) => ({ key: k, label: TAG_LABEL[k] ?? k, unit: TAG_UNITS[k] ?? '', group: groupOf(k), color: SERIES[unitKeys.indexOf(k) % SERIES.length], dashed: k === 'pHmeasured', dp: TAG_DP[k] ?? 1 }));
  const spVal = unitData.find((d) => d.sp !== undefined)?.sp;
  const unitRefs: TrendRef[] = spVal !== undefined && tagVisible(unit, 'sp') && chosen.some((k) => groupOf(k).id === 'pH') ? [{ y: spVal, groupId: 'pH', color: '#cfe3f7', label: `SP ${fmt(spVal, 1)}` }] : [];
  const toggleTag = (k: string) => unit && setTagSel({ ...tagSel, [unit.id]: chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k] });
  const flowMeter = hasInst(plant.graph.nodes.find((n) => n.kind === 'influent'), 'flow');
  const effData = result ? result.points.map((p) => ({ t: p.t, v: p.effluent[effParam], Q: p.Qin })) : [];
  const lim = (limits as Record<string, { max?: number; min?: number }>)[effParam];
  const effGroup = effParam === 'pH' ? AXIS_GROUPS.pH : { ...AXIS_GROUPS.conc, id: 'eff', label: `${effParam} mg/L` };
  const effSeries: TrendSeries[] = [
    { key: 'v', label: `Effluent ${effParam}`, unit: effParam === 'pH' ? '' : 'mg/L', group: effGroup, color: '#22d3ee', width: 2, dp: effParam === 'pH' ? 2 : 3 },
    ...(flowMeter ? [{ key: 'Q', label: 'Influent Q', unit: 'm³/d', group: AXIS_GROUPS.flow, color: '#3d6f9e', width: 1, dp: 0 }] : []),
  ];
  const effRefs: TrendRef[] = [
    ...(lim?.max !== undefined ? [{ y: lim.max, groupId: effGroup.id, color: 'var(--alarm)', label: `limit ${lim.max}`, shade: 'above' as const }] : []),
    ...(lim?.min !== undefined ? [{ y: lim.min, groupId: effGroup.id, color: 'var(--alarm)', label: `limit ${lim.min}`, shade: 'below' as const }] : []),
  ];
  const actions = availableActions(plant.graph, plant.incident ?? null);

  return (
    <div className="page" style={{ background: BG, minHeight: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginBottom: 2 }}>SCADA Operations</h1>
        <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => { g.openPlantStudio(plant.id); go('studio'); }} title="As-built PFD and P&ID; propose upgrades">View PFD / P&amp;ID</button>
        <select value={plant.id} onChange={(e) => setSel(e.target.value)} style={{ background: PANEL, color: '#fff', border: `1px solid ${LINE}`, padding: '5px 8px', borderRadius: 6 }}>
          {operating.map((p) => (
            <option key={p.id} value={p.id}>
              {brand(p.company)} — {INDUSTRY_LABEL[p.industry]} {p.incident ? '⚠' : ''}
            </option>
          ))}
        </select>
        </div>
      </div>
      <p className="sub">48-hour replay of the plant as it runs this week{lastWeek ? ` (week ${lastWeek.week}, flow ×${fmt(lastWeek.flowFactor, 2)})` : ''} on its real influent with the diurnal production pattern: ASM1 biology, PI pH and DO loops, EQ level. Diagnose alarms from the trends, then act.</p>

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
          <b style={{ color: '#cfe3f7' }}>Process mimic {at ? `— ${clockLabel(at.t)}` : ''}</b>
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
            IN {at && flowMeter ? fmt(at.Qin, 0) : '—'}
          </text>
          <text x={8} y={84} fill="#5f7891" fontSize={10} fontFamily="var(--mono)">
            m³/d
          </text>
          {units.map((u, i) => {
            const x = 80 + i * 150;
            const cat = CATALOGUE[u.kind as UnitType]?.category ?? 'physical';
            const vals = at?.units[u.id] ?? {};
            const alarm = (vals.DO !== undefined && vals.DO < 0.5) || (vals.sp !== undefined && Math.abs(vals.pHmeasured - vals.sp) > 0.5) || (vals.level !== undefined && vals.level > 95);
            const vis = Object.keys(vals).filter((k) => k !== 'sp' && tagVisible(u, k));
            const entries = [...new Set([...defaultTags(u.kind, vis), ...vis])].slice(0, 3).map((k) => [k, vals[k]] as const);
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
                {vals.bypassed ? (
                  <text x={x + 6} y={60} fill="#f3c95a" fontSize={10.5} fontFamily="var(--mono)">
                    BYPASSED
                  </text>
                ) : (
                  entries.map(([k, v], j) => (
                    <g key={k}>
                      <text x={x + 6} y={56 + j * 18} fill="#8aa0b8" fontSize={10} fontFamily="var(--mono)">
                        {TAG_SHORT[k] ?? k}
                      </text>
                      <text x={x + 104} y={56 + j * 18} fill="#cfe3f7" fontSize={10.5} fontFamily="var(--mono)" textAnchor="end">
                        {fmt(v, TAG_DP[k] ?? 0)}
                        {TAG_UNITS[k] === '%' ? ' %' : ''}
                      </text>
                    </g>
                  ))
                )}
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
            {unitKeys.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', margin: '6px 0 2px' }}>
                {unitKeys.map((k) => (
                  <button key={k} className={`btn sm ${chosen.includes(k) ? 'primary' : 'ghost'}`} onClick={() => toggleTag(k)}>
                    {TAG_LABEL[k] ?? k}
                    {TAG_UNITS[k] ? ` (${TAG_UNITS[k]})` : ''}
                  </button>
                ))}
              </div>
            )}
            {result ? (
              bypassed ? (
                <div className="muted" style={{ height: 220, fontSize: 12, paddingTop: 12 }}>Unit bypassed by the breakdown — no signals until it is repaired.</div>
              ) : (
                <TrendChart data={unitData} series={unitSeries} refs={unitRefs} cursor={cursor} height={220} />
              )
            ) : (
              <div className="muted" style={{ height: 220 }}>{busy ? 'Simulating…' : '—'}</div>
            )}
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              Tags of one quantity share an axis (left = first picked, right = second); hover for values.
              {layout.dropped.length > 0 && <span> Not plotted (would need a third axis): {layout.dropped.map((k) => TAG_LABEL[k] ?? k).join(', ')}.</span>}
              {hidden.length > 0 && <b style={{ color: '#f3c95a' }}> No instrument for {hidden.map((k) => TAG_LABEL[k] ?? k).join(', ')} — this loop runs by hand and is not alarmed.</b>}
            </p>
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
            {result ? <TrendChart data={effData} series={effSeries} refs={effRefs} cursor={cursor} height={200} /> : <div style={{ height: 200 }} />}
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
                {clockLabel(a.t)} {a.text}
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
