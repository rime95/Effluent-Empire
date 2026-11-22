import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useActiveProject, useGame } from '../../game/store';
import { labDiscount, labWeeks } from '../../game/staff';
import { LAB_TESTS, LabTestId, designBasis, jarTest, titrationData } from '../../game/lab';
import { Coagulant, COAGULANTS } from '../../simulation/chemistry/coagulation';
import type { Screen } from '../App';
import { fmt, rm } from '../format';
import { brand } from '../prefs';
import { samplePoint } from '../../game/project';

const AXIS = { stroke: '#8aa0b8', fontSize: 11, fontFamily: 'var(--mono)' };

export function Laboratory({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const p = useActiveProject();
  const [coag, setCoag] = useState<Coagulant>('pac');
  const [prePH, setPrePH] = useState<string>('');
  const [maxDose, setMaxDose] = useState(300);
  // sample point: the main stream or one of the factory's segregated side streams
  const [srcSel, setSrc] = useState('main');
  const src = p?.enquiry.trueStream.side?.some((x) => x.id === srcSel) ? srcSel : 'main';
  const sp = p ? samplePoint(p, src) : null;

  const basis = useMemo(() => (sp ? designBasis(sp.ds) : null), [p, src]); // eslint-disable-line react-hooks/exhaustive-deps
  const titration = useMemo(() => (sp && sp.done.includes('titration') ? titrationData(sp.trueS) : null), [p, src]); // eslint-disable-line react-hooks/exhaustive-deps
  const jar = useMemo(() => {
    if (!p || !sp || !sp.done.includes('jar')) return null;
    const doses = Array.from({ length: 31 }, (_, i) => (i * maxDose) / 30);
    const pre = prePH.trim() === '' ? undefined : Number(prePH);
    return jarTest(sp.trueS, coag, doses, pre !== undefined && Number.isFinite(pre) ? pre : undefined);
  }, [p, src, coag, prePH, maxDose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !sp) return <div className="page">No active project.</div>;
  const ds = sp.ds;
  const decl = sp.decl;
  const done = (t: LabTestId) => sp.done.includes(t);
  const sides = p.enquiry.trueStream.side ?? [];
  const editable = p.status === 'design' || p.status === 'failed';
  const discount = labDiscount(g.staff);

  const rows: { label: string; unit: string; declared?: number; measured?: number; measuredBy?: LabTestId | 'basic' }[] = [
    { label: 'Flow', unit: 'm³/d', declared: decl.Q, measured: ds.Q },
    { label: 'Peak factor', unit: '×', declared: decl.peakFactor },
    { label: 'pH', unit: '', declared: decl.pH, measured: done('titration') ? ds.pH : undefined, measuredBy: 'titration' },
    { label: 'Alkalinity', unit: 'mg/L CaCO₃', measured: ds.alkalinity_mgCaCO3, measuredBy: 'titration' },
    { label: 'Acidity (to pH 8.3)', unit: 'mg/L CaCO₃', measured: ds.acidity_mgCaCO3, measuredBy: 'titration' },
    { label: 'Sulfate', unit: 'mg/L SO₄', measured: ds.sulfate_mgL, measuredBy: 'titration' },
    { label: 'COD', unit: 'mg/L', declared: decl.COD, measured: done('fractionation') ? ds.COD : undefined, measuredBy: 'fractionation' },
    { label: 'BOD₅', unit: 'mg/L', measured: ds.BOD5, measuredBy: 'fractionation' },
    { label: 'NH₄-N', unit: 'mg/L', measured: ds.NH3N, measuredBy: 'fractionation' },
    { label: 'TSS', unit: 'mg/L', declared: decl.TSS, measured: done('jar') ? ds.TSS : undefined, measuredBy: 'jar' },
    { label: 'Oil & grease', unit: 'mg/L', declared: decl.OG, measured: done('oil') ? ds.OG : undefined, measuredBy: 'oil' },
    { label: 'Nickel', unit: 'mg/L', declared: decl.Ni, measured: done('metals') ? ds.Ni : undefined, measuredBy: 'metals' },
    { label: 'Copper', unit: 'mg/L', declared: decl.Cu, measured: done('metals') ? ds.Cu : undefined, measuredBy: 'metals' },
    { label: 'Zinc', unit: 'mg/L', declared: decl.Zn, measured: done('metals') ? ds.Zn : undefined, measuredBy: 'metals' },
    { label: 'Chromium (III)', unit: 'mg/L', declared: decl.Cr, measured: done('metals') ? ds.Cr : undefined, measuredBy: 'metals' },
    { label: 'Chromium (VI)', unit: 'mg/L', declared: decl.CrVI, measured: done('metals') ? ds.CrVI : undefined, measuredBy: 'metals' },
    { label: 'Complexed Ni + Cu + Zn (soluble at pH 10)', unit: 'mg/L', declared: undefined, measured: done('metals') ? (ds.complexed?.Ni ?? 0) + (ds.complexed?.Cu ?? 0) + (ds.complexed?.Zn ?? 0) : undefined, measuredBy: 'metals' },
  ];

  return (
    <div className="page">
      <h1>Laboratory</h1>
      <p className="sub">
        {brand(p.enquiry.company)} — every design prediction in the Studio uses the <b>design basis</b> built from this datasheet. Unknowns are filled with generic assumptions.
      </p>
      {sides.length > 0 && (
        <div className="row" style={{ gap: 6, margin: '10px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>Sample point:</span>
          {[{ id: 'main', label: 'Main' }, ...sides].map((x) => (
            <button key={x.id} className={`btn sm ${src === x.id ? 'primary' : 'ghost'}`} onClick={() => setSrc(x.id)}>
              {x.label} stream
            </button>
          ))}
          <span className="muted" style={{ fontSize: 12 }}>This factory drains {sides.length + 1} separate raw streams; each has its own inlet in the Studio and is tested and paid for separately.</span>
        </div>
      )}
      <div className="grid g2">
        <div className="panel">
          <h2>Wastewater datasheet</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Parameter</th>
                <th style={{ textAlign: 'right' }}>Declared</th>
                <th style={{ textAlign: 'right' }}>Lab measured</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const off = r.declared !== undefined && r.measured !== undefined && Math.abs(r.measured - r.declared) > 0.15 * Math.max(Math.abs(r.declared), 0.1);
                const undeclared = r.declared === undefined && r.measured !== undefined && r.measured > 0.05 && ['Nickel', 'Copper', 'Zinc', 'Chromium (III)', 'Chromium (VI)'].includes(r.label);
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="num">{fmt(r.declared)}</td>
                    <td className="num" style={{ color: r.measured === undefined ? '#4f6680' : '#fff' }}>
                      {r.measured === undefined ? 'not tested' : fmt(r.measured)}
                      {off && <span className="pill warn" style={{ marginLeft: 6 }}>differs</span>}
                      {undeclared && <span className="pill fail" style={{ marginLeft: 6 }}>undeclared</span>}
                    </td>
                    <td className="muted">{r.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ds.fractions && (
            <div style={{ marginTop: 12 }}>
              <h2 style={{ fontSize: 12 }}>COD fractionation</h2>
              <div className="row" style={{ gap: 0, height: 22, borderRadius: 4, overflow: 'hidden' }}>
                {(
                  [
                    ['SS', 'Readily biodeg. soluble', 'var(--bio)'],
                    ['XS', 'Slowly biodeg. particulate', '#62b884'],
                    ['SI', 'Inert soluble', 'var(--alarm)'],
                    ['XI', 'Inert particulate', 'var(--sludge)'],
                  ] as const
                ).map(([k, label, c]) => (
                  <div key={k} title={`${label}: ${(ds.fractions![k] * 100).toFixed(0)} %`} style={{ width: `${ds.fractions![k] * 100}%`, background: c, height: '100%', fontSize: 10, color: '#fff', textAlign: 'center', lineHeight: '22px', overflow: 'hidden' }}>
                    {k} {(ds.fractions![k] * 100).toFixed(0)}%
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12 }}>Inert soluble COD (SI) passes straight through biology — it sets the floor for effluent COD.</p>
            </div>
          )}
          {ds.ogFreeFraction !== undefined && <p className="muted" style={{ fontSize: 12 }}>Oil: {(ds.ogFreeFraction * 100).toFixed(0)} % free (separable by gravity), {((1 - ds.ogFreeFraction) * 100).toFixed(0)} % emulsified.</p>}
        </div>

        <div className="panel">
          <h2>Order tests</h2>
          {(Object.keys(LAB_TESTS) as LabTestId[]).map((t) => {
            const spec = LAB_TESTS[t];
            const isDone = done(t);
            const queued = p.labQueue.find((q) => q.test === t && (q.source ?? 'main') === src);
            const cost = Math.round(spec.cost * (1 - discount));
            return (
              <div key={t} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a3049' }}>
                <div style={{ maxWidth: '68%' }}>
                  <div style={{ color: '#fff' }}>{spec.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {spec.reveals}
                  </div>
                </div>
                {isDone ? (
                  <span className="pill pass">DONE</span>
                ) : queued ? (
                  <span className="pill info">RESULTS WK {queued.doneWeek}</span>
                ) : (
                  <button className="btn sm" disabled={!editable || g.cash < cost} onClick={() => g.runTest(t, src)}>
                    {rm(cost)} · {labWeeks(g.staff, spec.weeks)} wk
                  </button>
                )}
              </div>
            );
          })}
          <h2 style={{ marginTop: 16 }}>Design-basis assumptions</h2>
          {basis && basis.assumptions.length === 0 && <div className="note info">Every key parameter has been measured.</div>}
          {basis?.assumptions.map((a) => (
            <div key={a} className="note warn">
              {a}
            </div>
          ))}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => go('studio')}>
              Open Engineering Studio ▸
            </button>
          </div>
        </div>

        {titration && (
          <div className="panel">
            <h2>Titration curve (real sample)</h2>
            <div className="lab-chart" style={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={titration} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
                  <CartesianGrid stroke="#1c3653" />
                  <XAxis dataKey="doseNaOH_mgL" type="number" {...AXIS} label={{ value: 'NaOH (+) / acid as NaOH (−), mg/L', position: 'insideBottom', offset: -10, fill: '#8aa0b8', fontSize: 11 }} />
                  <YAxis domain={[0, 14]} {...AXIS} />
                  <Tooltip contentStyle={{ background: '#0d1c2e', border: '1px solid #24405f' }} formatter={(v: number) => v.toFixed(2)} labelFormatter={(l) => `${l} mg/L NaOH`} />
                  <ReferenceLine y={7} stroke="#4f6680" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="pH" stroke="var(--flow)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Flat regions are buffers: the dose needed to move pH depends on the wastewater, not on pH alone. Metal precipitation also consumes caustic.
            </p>
          </div>
        )}

        {jar && (
          <div className="panel">
            <h2>Jar test (real sample, 30 min settling)</h2>
            <div className="row" style={{ marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Coagulant</label>
                <select value={coag} onChange={(e) => setCoag(e.target.value as Coagulant)}>
                  {(Object.keys(COAGULANTS) as Coagulant[]).map((c) => (
                    <option key={c} value={c}>
                      {COAGULANTS[c].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, width: 110 }}>
                <label>Pre-adjust pH</label>
                <input placeholder="none" value={prePH} onChange={(e) => setPrePH(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0, width: 110 }}>
                <label>Max dose mg/L</label>
                <input type="number" value={maxDose} min={50} max={2000} step={50} onChange={(e) => setMaxDose(Math.max(50, Number(e.target.value)))} />
              </div>
            </div>
            <div className="lab-chart" style={{ height: 230 }}>
              <ResponsiveContainer>
                <LineChart data={jar} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
                  <CartesianGrid stroke="#1c3653" />
                  <XAxis dataKey="dose" type="number" {...AXIS} label={{ value: 'Coagulant dose, mg/L product', position: 'insideBottom', offset: -10, fill: '#8aa0b8', fontSize: 11 }} />
                  <YAxis {...AXIS} />
                  <Tooltip contentStyle={{ background: '#0d1c2e', border: '1px solid #24405f' }} formatter={(v: number, n) => [v.toFixed(1), n === 'supernatantTSS' ? 'Supernatant TSS mg/L' : 'pH']} labelFormatter={(l) => `${Number(l).toFixed(0)} mg/L`} />
                  <Line type="monotone" dataKey="supernatantTSS" stroke="var(--sludge)" dot={{ r: 2 }} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Look for the minimum: under-dosing leaves stable colloids, over-dosing restabilises them, very high doses sweep-floc at high sludge cost. Check the pH drop too — final pH {fmt(jar[jar.length - 1].pH, 2)} at max dose.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
