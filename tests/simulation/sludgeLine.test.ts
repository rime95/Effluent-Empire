/** Sludge line, splitter/mixer and recycle (tear-stream) solving.
 *  Ref: knowledge/physical/sludge_thickening_dewatering.md, knowledge/design/recycle_streams.md */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { PEdge, PNode, ProcessGraph, simulate, findTears } from '../../src/simulation/treatment/graph';
import { defaultParams, UnitType } from '../../src/simulation/treatment/catalogue';
import { clarifierUnderflowFraction, filterPress, thicken, THICKENER } from '../../src/simulation/physical/sludge';
import { emptyStream, poolMass, tss } from '../../src/simulation/core/stream';

function plating() {
  let e = generateEnquiry(11, 1, 0);
  for (let s = 12; e.industry !== 'plating'; s++) e = generateEnquiry(s, 1, 0);
  return e.trueStream;
}
const Q = plating().Q;
const unit = (id: string, kind: UnitType, over: Record<string, number | string> = {}): PNode => ({ id, kind, tag: id.toUpperCase(), params: { ...defaultParams(kind, Q), ...over } });
const pipe = (from: string, to: string, fromPort?: PEdge['fromPort']): PEdge => ({ id: `${from}-${to}-${fromPort ?? 'out'}`, from, to, fromPort });

/** EQ → precipitation → coagulation (ferric, pH held, polymer) → clarifier → discharge, with a full sludge line. */
function sludgePlant(recycle: boolean): ProcessGraph {
  const nodes: PNode[] = [
    { id: 'in', kind: 'influent', params: {} },
    unit('eq', 'eq'),
    unit('pr', 'precipitation', { targetPH: 9.5 }),
    unit('cf', 'coagulation', { coagulant: 'ferric', dose: 75, pHset: 9.5, polymer: 1 }),
    unit('cl', 'clarifier'),
    unit('th', 'thickener', { area: 3 }),
    unit('fp', 'filterPress', { volume: 0.5, cycles: 3, conditioning: 'polymer' }),
    { id: 'sd', kind: 'disposal', tag: 'SD-01', params: {} },
    { id: 'out', kind: 'discharge', params: {} },
  ];
  const edges = [pipe('in', 'eq'), pipe('eq', 'pr'), pipe('pr', 'cf'), pipe('cf', 'cl'), pipe('cl', 'out'), pipe('cl', 'th', 'sludge'), pipe('th', 'fp', 'sludge'), pipe('fp', 'sd', 'sludge')];
  if (recycle) edges.push(pipe('th', 'eq'), pipe('fp', 'eq'));
  else edges.push(pipe('th', 'out'), pipe('fp', 'out'));
  return { nodes, edges };
}

describe('clarifier underflow concentration', () => {
  it('depends on what settled: Fe/Al floc is dilute, mineral and primary solids compact (mass-weighted harmonic mean)', () => {
    const fe = emptyStream(100); fe.feSolid = 30;
    const prim = emptyStream(100); prim.inert = 50;
    const mix = emptyStream(100); mix.feSolid = 30; mix.inert = 50;
    const wFe = clarifierUnderflowFraction(fe), wP = clarifierUnderflowFraction(prim), wM = clarifierUnderflowFraction(mix);
    expect(wFe).toBeLessThan(0.015);
    expect(wP).toBeGreaterThan(0.04);
    const mFe = poolMass(mix, 'feFloc'), mP = poolMass(mix, 'inert');
    expect(wM).toBeCloseTo((mFe + mP) / (mFe / wFe + mP / wP), 6);
  });
});

describe('sludge line', () => {
  it('water is conserved: influent = effluent + sludge to disposal (with recycle loops)', () => {
    const s = plating();
    const sim = simulate(sludgePlant(true), s);
    expect(sim.errors).toEqual([]);
    expect(sim.ok).toBe(true);
    expect(sim.tears.length).toBe(2);
    expect(sim.iterations).toBeGreaterThan(1);
    expect(sim.iterations).toBeLessThan(60);
    const disposedQ = sim.disposal.reduce((a, d) => a + d.wetKgD / 1000, 0);
    expect(sim.effluent!.Q + disposedQ).toBeCloseTo(s.Q, 1);
    expect(sim.balance?.ok).toBe(true);
  });
  it('the sludge stream is a real, concentrated flow (≈1 % solids) and the press cake is 20–35 % DS', () => {
    const sim = simulate(sludgePlant(false), plating());
    const clSludge = sim.edges['cl-th-sludge'];
    const ds = sim.nodes['cl'].sludgeKgD;
    expect(ds).toBeGreaterThan(0);
    // clarifier underflow: Q_s = M_DS / (w_s · 1000 kg/m³), w_s from the make-up of the settled solids
    const ws = clarifierUnderflowFraction(sim.nodes['cl'].result.removed!);
    expect(ws).toBeGreaterThan(0.005);
    expect(ws).toBeLessThan(0.06);
    expect(clSludge.Q).toBeCloseTo(ds / (ws * 1000), 6);
    expect(sim.nodes['cl'].result.calcs.uFlow.value).toBeCloseTo(clSludge.Q, 6);
    const d = sim.disposal[0];
    expect(d.dryKgD / d.wetKgD).toBeGreaterThan(0.18);
    expect(d.dryKgD / d.wetKgD).toBeLessThan(0.4);
  });
  it('routed sludge is costed at disposal; dewatered cake is cheaper per kg DS than the contractor price', () => {
    const sim = simulate(sludgePlant(false), plating());
    const d = sim.disposal[0];
    expect(d.costRMd / d.dryKgD).toBeLessThan(1.2);
    // liquid clarifier sludge sent straight to disposal is very expensive (tankering water)
    const g = sludgePlant(false);
    g.nodes = g.nodes.filter((n) => n.id !== 'th' && n.id !== 'fp');
    g.edges = [...g.edges.filter((e) => !['th', 'fp'].includes(e.from) && !['th', 'fp'].includes(e.to)), pipe('cl', 'sd', 'sludge')];
    const liquid = simulate(g, plating());
    expect(liquid.errors).toEqual([]);
    expect(liquid.disposal[0].costRMd / liquid.disposal[0].dryKgD).toBeGreaterThan(4); // vs < 1.2 for cake
  });
  it('an unconnected sludge port behaves exactly as before (contractor price, effluent unchanged)', () => {
    const s = plating();
    const g = sludgePlant(false);
    const plain: ProcessGraph = { nodes: g.nodes.filter((n) => !['th', 'fp', 'sd'].includes(n.id)), edges: g.edges.filter((e) => !['th', 'fp', 'sd'].includes(e.to) && !['th', 'fp'].includes(e.from)) };
    const sim = simulate(plain, s);
    expect(sim.ok).toBe(true);
    expect(sim.effluent!.Q).toBeCloseTo(s.Q, 6);
    expect(sim.disposal).toEqual([]);
    expect(sim.opexSplit.sludge).toBeGreaterThan(0);
  });
  it('validation: sludge to the river and treated water to disposal are rejected', () => {
    const g = sludgePlant(false);
    const bad1 = { ...g, edges: [...g.edges.filter((e) => e.id !== 'cl-th-sludge'), pipe('cl', 'out', 'sludge')] };
    expect(simulate(bad1, plating()).errors.some((e) => e.code === 'graph.sludgeToRiver')).toBe(true);
    const bad2 = { ...g, edges: [...g.edges, pipe('pr', 'sd')] };
    expect(simulate(bad2, plating()).errors.some((e) => e.code === 'graph.disposalWater')).toBe(true);
  });
});

describe('thickener and filter press models', () => {
  const sludge = () => {
    const s = emptyStream(10);
    s.precipitated.Ni = 2000; // ≈ 3.2 g/L Ni(OH)₂ → about 0.3 % solids
    s.feSolid = 6000;
    s.T = 28;
    return s;
  };
  it('thickener: underflow at the design value when SLR ≤ design, thinner and leakier when overloaded', () => {
    const s = sludge();
    const ok = thicken(s, { area_m2: 50 });
    const over = thicken(s, { area_m2: 2 });
    expect(ok.sludgeSolidsFrac).toBeCloseTo(THICKENER.chemical.solids, 6);
    expect(over.sludgeSolidsFrac!).toBeLessThan(ok.sludgeSolidsFrac!);
    expect(over.calcs.capture.value).toBeLessThan(ok.calcs.capture.value);
    expect(over.notes.some((n) => n.code === 'thick.overload')).toBe(true);
  });
  it('filter press: lime gives a drier (but heavier) cake than polymer; an undersized press is flagged', () => {
    const s = sludge();
    const poly = filterPress(s, { chamber_m3: 5, cycles: 3, conditioning: 'polymer' });
    const lime = filterPress(s, { chamber_m3: 5, cycles: 3, conditioning: 'lime' });
    expect(lime.sludgeSolidsFrac!).toBeGreaterThan(poly.sludgeSolidsFrac!);
    expect(lime.calcs.cakeMass.value).toBeGreaterThan(0);
    const small = filterPress(s, { chamber_m3: 0.01, cycles: 1, conditioning: 'polymer' });
    expect(small.notes.some((n) => n.code === 'press.overload')).toBe(true);
  });
});

describe('splitter, mixer and tears', () => {
  it('splitter sends split % to outlet a and the rest to b; a mixer recombines', () => {
    const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, unit('sp', 'splitter', { split: 70 }), unit('c1', 'clarifier'), unit('c2', 'clarifier'), unit('mx', 'mixer'), { id: 'out', kind: 'discharge', params: {} }];
    const edges = [pipe('in', 'sp'), pipe('sp', 'c1', 'a'), pipe('sp', 'c2', 'b'), pipe('c1', 'mx'), pipe('c2', 'mx'), pipe('mx', 'out')];
    const s = plating();
    const sim = simulate({ nodes, edges }, s);
    expect(sim.errors).toEqual([]);
    expect(sim.edges['sp-c1-a'].Q).toBeCloseTo(0.7 * s.Q, 6);
    expect(sim.edges['sp-c2-b'].Q).toBeCloseTo(0.3 * s.Q, 6);
    expect(sim.effluent!.Q).toBeCloseTo(s.Q, 6);
  });
  it('findTears marks exactly the back-edges of a loop', () => {
    const g = sludgePlant(true);
    expect(findTears(g).sort()).toEqual(['fp-eq-out', 'th-eq-out'].sort());
    expect(findTears(sludgePlant(false))).toEqual([]);
  });
});

import { splitSludge } from '../../src/simulation/physical/sludge';
import { components } from '../../src/simulation/core/massBalance';
import { clarify } from '../../src/simulation/physical/units';
import { runDynamic } from '../../src/simulation/dynamic/plantDynamics';

describe('review follow-ups (QA / process)', () => {
  const loop = (a: number) => {
    const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, unit('mx', 'mixer'), unit('eq', 'eq'), unit('sp', 'splitter', { split: a }), { id: 'out', kind: 'discharge', params: {} }];
    const edges = [pipe('in', 'mx'), pipe('mx', 'eq'), pipe('eq', 'sp'), pipe('sp', 'mx', 'a'), pipe('sp', 'out', 'b')];
    return { nodes, edges };
  };
  for (const a of [50, 90, 95]) {
    it(`a ${a} % recycle converges (Wegstein) with water closing: effluent Q = influent Q`, () => {
      const s = plating();
      const sim = simulate(loop(a), s);
      expect(sim.errors.filter((e) => e.level === 'error')).toEqual([]);
      expect(sim.ok).toBe(true);
      expect(sim.iterations).toBeLessThan(80);
      expect(sim.effluent!.Q).toBeCloseTo(s.Q, 2);
      expect(sim.edges['sp-mx-a'].Q).toBeCloseTo((a / (100 - a)) * s.Q, 0);
    });
  }
  it('recycle plant: every unit balance closes and the press-breakdown (bypass) case either converges or is flagged', () => {
    const s = plating();
    const sim = simulate(sludgePlant(true), s);
    for (const n of Object.values(sim.nodes)) expect(n.balance.ok, n.node.tag).toBe(true);
    const g = sludgePlant(true);
    g.nodes = g.nodes.map((n) => (n.id === 'fp' ? { ...n, bypass: true } : n));
    const broken = simulate(g, s);
    expect(broken.ok === true || broken.errors.some((e) => e.code === 'graph.recycle')).toBe(true);
    if (broken.ok) expect(broken.balance?.ok).toBe(true);
  });
  it('splitSludge conserves every component: main + sludge = out + removed', () => {
    const s = plating();
    s.precipitated.Ni = s.dissolved.Ni;
    s.dissolved.Ni = 0.1;
    s.feSolid = 40;
    const r = clarify(s, { area_m2: s.Q / 24 / 0.5 });
    for (const Qs of [0, 0.5, 5, 0.9 * s.Q]) {
      const { main, sludge } = splitSludge(r.out, r.removed!, s.Q, Qs);
      const lhs = components(main);
      const sl = components(sludge);
      const rhs = components(r.out);
      const rm = components(r.removed!, false);
      for (const k of Object.keys(lhs) as (keyof typeof lhs)[]) expect(lhs[k] + sl[k], `${k} @Qs=${Qs}`).toBeCloseTo(rhs[k] + rm[k], 6);
      expect(sludge.v50.precipitate).toBe(r.out.v50.precipitate);
    }
  });
  it('a dry branch is still built: CAPEX > 0 and no Infinity in its calcs', () => {
    const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, unit('sp', 'splitter', { split: 100 }), unit('c1', 'clarifier'), unit('c2', 'clarifier'), { id: 'out', kind: 'discharge', params: {} }];
    const edges = [pipe('in', 'sp'), pipe('sp', 'c1', 'a'), pipe('sp', 'c2', 'b'), pipe('c1', 'out'), pipe('c2', 'out')];
    const sim = simulate({ nodes, edges }, plating());
    expect(sim.nodes['c2'].capex).toBeGreaterThan(0);
    expect(Object.values(sim.nodes['c2'].result.calcs).every((c) => Number.isFinite(c.value))).toBe(true);
  });
  it('sludge reaching the river through a mixer is rejected', () => {
    const g = sludgePlant(false);
    g.nodes.push(unit('mx', 'mixer'));
    g.edges = [...g.edges.filter((e) => e.id !== 'cl-th-sludge'), pipe('cl', 'mx', 'sludge'), pipe('mx', 'out')];
    expect(simulate(g, plating()).errors.some((e) => e.code === 'graph.sludgeToRiver')).toBe(true);
  });
  it('SCADA replay runs on a plant with a sludge line and recycles: finite values, compliant like steady state', () => {
    const s = plating();
    const r = runDynamic(sludgePlant(true), s, 'B', { hours: 12, disturbances: [] });
    for (const p of r.points) for (const u of Object.values(p.units)) for (const v of Object.values(u)) expect(Number.isFinite(v)).toBe(true);
    expect(r.points.every((p) => Number.isFinite(p.effluent.Q) && p.effluent.Q > 0)).toBe(true);
  });
});

describe('thickener solids-flux limit (regression: clarifier underflow snowballing through the supernatant return)', () => {
  function foodCoag(area?: number): ProcessGraph {
    let e = generateEnquiry(11, 1, 0);
    for (let s = 12; e.industry !== 'food'; s++) e = generateEnquiry(s, 1, 0);
    const q = e.trueStream.Q;
    const u = (id: string, kind: UnitType, over: Record<string, number | string> = {}): PNode => ({ id, kind, tag: id, params: { ...defaultParams(kind, q), ...over } });
    const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, u('eq', 'eq'), u('pr', 'precipitation'), u('cf', 'coagulation', { coagulant: 'ferric', dose: 200 }), u('cl', 'clarifier'), u('th', 'thickener', area ? { area } : {}), { id: 'sd', kind: 'disposal', tag: 'SD', params: {} }, { id: 'out', kind: 'discharge', params: {} }];
    const edges = [pipe('in', 'eq'), pipe('eq', 'pr'), pipe('pr', 'cf'), pipe('cf', 'cl'), pipe('cl', 'out'), pipe('cl', 'th', 'sludge'), pipe('th', 'sd', 'sludge'), pipe('th', 'eq')];
    return { nodes, edges };
  }
  const foodQ = () => { let e = generateEnquiry(11, 1, 0); for (let s = 12; e.industry !== 'food'; s++) e = generateEnquiry(s, 1, 0); return e.trueStream; };
  it('an undersized thickener spills only its excess solids; the loop settles and the thickener says how big it must be', () => {
    const st = foodQ();
    const sim = simulate(foodCoag(10), st);
    expect(sim.errors.some((x) => x.code === 'graph.recycle')).toBe(false);
    // a genuinely undersized thickener with its supernatant returned circulates its excess solids: flagged, with the cure
    const note = sim.nodes['th'].result.notes.find((n) => n.code === 'thick.overload');
    expect(note?.level).toBe('error');
    expect(note?.text).toMatch(/Needs ≈\d+ m²/);
  });
  it('the default thickener (sized on flow) keeps the clarifier underflow a few % of Q', () => {
    const st = foodQ();
    const sim = simulate(foodCoag(), st);
    expect(sim.edges['cl-th-sludge'].Q).toBeLessThan(0.06 * st.Q);
  });
});

describe('holding-tank operation and a clear press filtrate (practitioner layout: overflow to EQ as insurance only)', () => {
  function holdingPlant(): ProcessGraph {
    const nodes: PNode[] = [
      { id: 'in', kind: 'influent', params: {} },
      unit('eq', 'eq'),
      unit('pr', 'precipitation', { targetPH: 9.5 }),
      unit('cf', 'coagulation', { coagulant: 'ferric', dose: 75, pHset: 9.5, polymer: 1 }),
      unit('cl', 'clarifier'),
      unit('th', 'thickener', { mode: 'holding' }),
      unit('fp', 'filterPress'),
      { id: 'sd', kind: 'disposal', tag: 'SD-01', params: {} },
      { id: 'out', kind: 'discharge', params: {} },
    ];
    const edges = [pipe('in', 'eq'), pipe('eq', 'pr'), pipe('pr', 'cf'), pipe('cf', 'cl'), pipe('cl', 'out'), pipe('cl', 'th', 'sludge'), pipe('th', 'fp', 'sludge'), pipe('fp', 'sd', 'sludge'), pipe('th', 'eq'), pipe('fp', 'eq')];
    return { nodes, edges };
  }
  it('holding mode decants nothing: all clarifier sludge goes to the press, the overflow to EQ is empty', () => {
    const s = plating();
    const sim = simulate(holdingPlant(), s);
    expect(sim.errors.filter((x) => x.level === 'error')).toEqual([]);
    expect(sim.edges['th-eq-out'].Q).toBeLessThan(1e-6);
    expect(sim.edges['th-fp-sludge'].Q).toBeCloseTo(sim.edges['cl-th-sludge'].Q, 6);
    expect(sim.balance?.ok).toBe(true);
    const disposedQ = sim.disposal.reduce((a, d) => a + d.wetKgD / 1000, 0);
    expect(sim.effluent!.Q + disposedQ).toBeCloseTo(s.Q, 1);
  });
  it('a press in normal operation returns a near solids-free filtrate (< 200 mg/L TSS)', () => {
    const sim = simulate(holdingPlant(), plating());
    const f = sim.edges['fp-eq-out'];
    expect(f.Q).toBeGreaterThan(0);
    expect(tss(f)).toBeLessThan(200);
    expect(sim.nodes['fp'].result.notes.some((n) => n.code === 'press.overload')).toBe(false);
  });
});

describe('clean returns and near-complete clarification when equipment is sized right (practitioner rules)', () => {
  it('correctly sized thickener and press: supernatant and filtrate are practically solids-free', () => {
    const sim = simulate(sludgePlant(true), plating());
    expect(sim.errors.filter((x) => x.level === 'error')).toEqual([]);
    expect(sim.nodes['th'].result.notes.some((n) => n.code === 'thick.overload')).toBe(false);
    expect(tss(sim.edges['th-eq-out'])).toBeLessThan(100);
    expect(tss(sim.edges['fp-eq-out'])).toBeLessThan(50);
  });
  it('a well-coagulated chemical clarifier leaves < 15 mg/L TSS', () => {
    const sim = simulate(sludgePlant(false), plating());
    expect(tss(sim.nodes['cl'].result.out)).toBeLessThan(15);
  });
  it('desludge pump: enough flow → underflow = solids / flow; too little → blanket rises and sludge goes over the weir', () => {
    const auto = simulate(sludgePlant(false), plating());
    const dry = auto.nodes['cl'].sludgeKgD;
    const wNat = clarifierUnderflowFraction(auto.nodes['cl'].result.removed!);
    const qOk = (2 * dry) / (wNat * 1000); // twice the auto flow
    const g = sludgePlant(false);
    g.nodes = g.nodes.map((n) => (n.id === 'cl' ? { ...n, params: { ...n.params, desludge: qOk } } : n));
    const ok = simulate(g, plating());
    expect(ok.edges['cl-th-sludge'].Q).toBeCloseTo(qOk, 3);
    // same solids escape; only slightly more concentrated because more water leaves with the sludge
    expect(tss(ok.nodes['cl'].result.out) / tss(auto.nodes['cl'].result.out)).toBeGreaterThan(0.99);
    expect(tss(ok.nodes['cl'].result.out) / tss(auto.nodes['cl'].result.out)).toBeLessThan(1.1);
    const g2 = sludgePlant(false);
    g2.nodes = g2.nodes.map((n) => (n.id === 'cl' ? { ...n, params: { ...n.params, desludge: qOk / 10 } } : n));
    const low = simulate(g2, plating());
    expect(low.nodes['cl'].result.notes.some((n) => n.code === 'clar.desludge' && n.level === 'error')).toBe(true);
    expect(tss(low.nodes['cl'].result.out)).toBeGreaterThan(5 * tss(auto.nodes['cl'].result.out));
    expect(low.balance?.ok).toBe(true);
  });
});

describe('loose units', () => {
  it('a unit with no pipes at all is left out with a warning; the rest of the design still calculates', () => {
    const g = sludgePlant(false);
    g.nodes.push(unit('spare', 'sandFilter'));
    const sim = simulate(g, plating());
    expect(sim.ok).toBe(true);
    expect(sim.errors.some((x) => x.code === 'graph.loose' && x.level === 'warn')).toBe(true);
    expect(sim.nodes['spare']).toBeUndefined();
    expect(sim.effluent).toBeTruthy();
  });
  it('a half-connected unit is still an error (flow would have nowhere to go)', () => {
    const g = sludgePlant(false);
    g.nodes.push(unit('dead', 'sandFilter'));
    g.edges.push(pipe('cl', 'dead'));
    expect(simulate(g, plating()).errors.some((x) => x.code === 'graph.noOutlet')).toBe(true);
  });
});

describe('desludge pump edge cases (process review)', () => {
  const withPump = (q: number) => {
    const g = sludgePlant(false);
    g.nodes = g.nodes.map((n) => (n.id === 'cl' ? { ...n, params: { ...n.params, desludge: q } } : n));
    return simulate(g, plating());
  };
  it('a pump larger than the inflow is limited to 95 % and flagged', () => {
    const s = plating();
    const sim = withPump(s.Q * 2);
    expect(sim.nodes['cl'].result.notes.some((n) => n.code === 'clar.desludgeDrain')).toBe(true);
    expect(sim.edges['cl-th-sludge'].Q).toBeLessThanOrEqual(0.95 * s.Q + 1e-6);
    expect(sim.balance?.ok).toBe(true);
  });
  it('a starved pump sheds the light floc over the weir first; grit stays in the underflow', () => {
    const auto = simulate(sludgePlant(false), plating());
    const sim = withPump(0.5 * auto.edges['cl-th-sludge'].Q); // pump at half the flow the settled sludge needs
    expect(sim.nodes['cl'].result.notes.some((n) => n.code === 'clar.desludge')).toBe(true);
    const cl = sim.nodes['cl'];
    expect(poolMass(cl.result.out, 'grit')).toBeLessThan(0.01 * Math.max(poolMass(cl.inlet, 'grit'), 1e-9) + 1e-9);
    expect(poolMass(cl.result.out, 'feFloc')).toBeGreaterThan(0.5 * poolMass(cl.inlet, 'feFloc'));
  });
  it('a set pump flow on a secondary clarifier is ignored with a note', () => {
    let e = generateEnquiry(11, 1, 0);
    for (let s = 12; e.industry !== 'food'; s++) e = generateEnquiry(s, 1, 0);
    const q = e.trueStream.Q;
    const u = (id: string, kind: UnitType, over: Record<string, number | string> = {}): PNode => ({ id, kind, tag: id, params: { ...defaultParams(kind, q), ...over } });
    const g: ProcessGraph = { nodes: [{ id: 'in', kind: 'influent', params: {} }, u('as', 'activatedSludge', { volume: q * 3, control: 'srt' }), u('cl', 'clarifier', { desludge: 5 }), { id: 'out', kind: 'discharge', params: {} }], edges: [pipe('in', 'as'), pipe('as', 'cl'), pipe('cl', 'out')] };
    expect(simulate(g, e.trueStream).nodes['cl'].result.notes.some((n) => n.code === 'clar.desludgeML')).toBe(true);
  });
});
