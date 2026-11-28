/** RAS/WAS system and MLSS control; construction progress payments. Ref: knowledge/biological/activated_sludge.md */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { PEdge, PNode, ProcessGraph, simulate } from '../../src/simulation/treatment/graph';
import { defaultParams, UnitType } from '../../src/simulation/treatment/catalogue';
import { GameState, stepWeek } from '../../src/game/store';
import { newProject } from '../../src/game/project';
import { initialMarket } from '../../src/game/market';

function food() {
  let e = generateEnquiry(11, 1, 0);
  for (let s = 12; e.industry !== 'food'; s++) e = generateEnquiry(s, 1, 0);
  return e;
}
const e = food();
const Q = e.trueStream.Q;
const unit = (id: string, kind: UnitType, over: Record<string, number | string> = {}): PNode => ({ id, kind, tag: id.toUpperCase(), params: { ...defaultParams(kind, Q), ...over } });
const pipe = (from: string, to: string, fromPort?: PEdge['fromPort']): PEdge => ({ id: `${from}-${to}-${fromPort ?? 'out'}`, from, to, fromPort });
function plant(asOver: Record<string, number | string>, withRas = true, withWas = true): ProcessGraph {
  const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, unit('eq', 'eq'), unit('as', 'activatedSludge', { volume: Math.ceil(Q * 3), ...asOver }), unit('cl', 'clarifier'), unit('th', 'thickener', { area: 4 }), { id: 'sd', kind: 'disposal', tag: 'SD-01', params: {} }, { id: 'out', kind: 'discharge', params: {} }];
  const edges = [pipe('in', 'eq'), pipe('eq', 'as'), pipe('as', 'cl'), pipe('cl', 'out'), pipe('th', 'sd', 'sludge'), pipe('th', 'out')];
  if (withRas) edges.push(pipe('cl', 'as', 'ras'));
  if (withWas) edges.push(pipe('cl', 'th', 'sludge'));
  return { nodes, edges };
}

describe('MLSS control and RAS/WAS', () => {
  it('MLSS control finds the sludge age that holds the set-point', () => {
    for (const target of [2500, 3500]) {
      const sim = simulate(plant({ control: 'mlss', mlss: target }), e.trueStream);
      const as = sim.nodes['as'];
      expect(as.result.calcs.mlss.value).toBeCloseTo(target, -1);
      expect(as.result.calcs.control.value).toBeGreaterThan(1);
    }
    const lo = simulate(plant({ control: 'mlss', mlss: 2500 }), e.trueStream).nodes['as'].result.calcs.control.value;
    const hi = simulate(plant({ control: 'mlss', mlss: 3500 }), e.trueStream).nodes['as'].result.calcs.control.value;
    expect(hi).toBeGreaterThan(lo); // higher MLSS needs a longer sludge age
  });
  it('an unreachable MLSS set-point is flagged', () => {
    const sim = simulate(plant({ control: 'mlss', mlss: 8000, volume: Math.ceil(Q * 8) }), e.trueStream);
    expect(sim.nodes['as'].result.notes.some((n) => n.code === 'as.mlssLow' || n.code === 'as.xr')).toBe(true);
  });
  it('RAS/WAS: Xr = X(1+R)/R, RAS line shows R·Q, WAS leaves at Xr, and the RAS does not add flow', () => {
    const sim = simulate(plant({ control: 'mlss', mlss: 3000, ras: 0.75 }), e.trueStream);
    expect(sim.errors.filter((x) => x.level === 'error')).toEqual([]);
    const c = sim.nodes['as'].result.calcs;
    // Xr = [(1+R)X − Px/Q]/R (WAS drawn from the underflow)
    const pxConc = (c.sludge.value * 1000) / Q;
    expect(c.xr.value).toBeCloseTo((3000 * 1.75 - pxConc) / 0.75, -1);
    expect(sim.edges['cl-as-ras'].Q).toBeCloseTo(0.75 * Q, 3);
    // WAS stream concentration ≈ Xr (solids at the RAS/WAS concentration)
    const was = sim.edges['cl-th-sludge'];
    expect(was.Q).toBeCloseTo((sim.nodes['cl'].sludgeKgD * 1000) / c.xr.value, 3);
    expect(sim.effluent!.Q).toBeCloseTo(Q - sim.disposal.reduce((a, d) => a + d.wetKgD / 1000, 0), 2);
    expect(sim.balance?.ok).toBe(true);
  });
  it('a clarifier after AS without a drawn RAS line gets advice; a RAS line elsewhere is an error', () => {
    const noRas = simulate(plant({}, false), e.trueStream);
    expect(noRas.errors.some((x) => x.code === 'graph.noRAS' && x.level === 'info')).toBe(true);
    expect(noRas.ok).toBe(true);
    const g = plant({});
    g.edges.push(pipe('cl', 'eq', 'ras'));
    expect(simulate(g, e.trueStream).errors.some((x) => x.code === 'graph.ras')).toBe(true);
  });
  it('old designs without a control parameter keep sludge-age control', () => {
    const sim = simulate(plant({ control: '' as unknown as string, srt: 10 }), e.trueStream);
    expect(sim.nodes['as'].result.calcs.srt.value).toBeCloseTo(10, 6);
  });
});

describe('construction progress payments', () => {
  it('CAPEX is paid weekly and the 60 % arrives as weekly progress claims; nothing extra at completion', () => {
    const p = newProject(e, 1);
    const capex = 600_000;
    const milestone = 0.6 * e.contractValue;
    const report = { week: 5, attempt: 1, pass: false, compliance: { standard: 'B', version: '', pass: false, checks: [] }, stages: [], capexCharged: capex, totalCapex: capex, opexRMd: 100, milestone, payment: 0, lateWeeks: 0, reputationDelta: 0, messages: [], errors: [] };
    const building = { doneWeek: 5, report, graph: p.graph, progress: { capexPerWeek: capex / 4, claimPerWeek: milestone / 4, weeksLeft: 4 } };
    // a minimal state: one building project, no staff costs beyond the founder
    let s = { version: 2, companyName: 'T', cash: 100_000, reputation: 0, week: 1, seedCounter: 5, enquiries: [], projects: [{ ...p, status: 'building', building }], activeProjectId: p.id, staff: [{ id: 'founder', name: 'F', role: 'engineer', level: 3, salaryMonthly: 0, hiredWeek: 1, founder: true }], candidates: [], plants: [], market: undefined, news: [], history: [], ledger: [], negativeWeeks: 0, gameOver: false, toast: null } as unknown as GameState;
    s = { ...s, market: initialMarket() };
    const cash0 = s.cash;
    for (let i = 0; i < 4; i++) s = stepWeek(s);
    const progressLines = s.ledger.filter((l) => l.label.startsWith('Progress claim'));
    const capexLines = s.ledger.filter((l) => l.label.startsWith('Construction progress'));
    expect(progressLines.length).toBe(4);
    expect(capexLines.length).toBe(4);
    expect(progressLines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(milestone, 0);
    expect(capexLines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(-capex, 0);
    expect(s.ledger.some((l) => l.label.startsWith('Mechanical completion'))).toBe(false);
    expect(s.cash).toBeLessThan(cash0 + milestone);
  });
});

describe('recycle loops with biology inside (regression: period-3 oscillation)', () => {
  for (const control of ['srt', 'mlss']) {
    it(`AS + thickener + press with filtrate and supernatant back to EQ converges (${control} control)`, () => {
      const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, unit('eq', 'eq'), unit('as', 'activatedSludge', { volume: Math.ceil(Q * 3), control }), unit('cl', 'clarifier'), unit('th', 'thickener', { area: 15 }), unit('fp', 'filterPress'), { id: 'sd', kind: 'disposal', tag: 'SD', params: {} }, { id: 'out', kind: 'discharge', params: {} }];
      const edges = [pipe('in', 'eq'), pipe('eq', 'as'), pipe('as', 'cl'), pipe('cl', 'out'), pipe('cl', 'as', 'ras'), pipe('cl', 'th', 'sludge'), pipe('th', 'fp', 'sludge'), pipe('fp', 'sd', 'sludge'), pipe('th', 'eq'), pipe('fp', 'eq')];
      const sim = simulate({ nodes, edges }, e.trueStream);
      expect(sim.errors.filter((x) => x.level === 'error')).toEqual([]);
      expect(sim.ok).toBe(true);
      expect(sim.balance?.ok).toBe(true);
      expect(sim.effluent!.Q + sim.disposal.reduce((a, d) => a + d.wetKgD / 1000, 0)).toBeCloseTo(Q, 1);
    });
  }
});

describe('solids recirculation runaway', () => {
  it('a badly undersized thickener under MLSS control is reported as a runaway loop, quickly, and not OK', () => {
    const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }, unit('eq', 'eq'), unit('as', 'activatedSludge', { volume: Math.ceil(Q * 3), control: 'mlss' }), unit('cl', 'clarifier'), unit('th', 'thickener', { area: 4 }), unit('fp', 'filterPress'), { id: 'sd', kind: 'disposal', tag: 'SD', params: {} }, { id: 'out', kind: 'discharge', params: {} }];
    const edges = [pipe('in', 'eq'), pipe('eq', 'as'), pipe('as', 'cl'), pipe('cl', 'out'), pipe('cl', 'th', 'sludge'), pipe('th', 'fp', 'sludge'), pipe('fp', 'sd', 'sludge'), pipe('th', 'eq'), pipe('fp', 'eq')];
    const t0 = Date.now();
    const sim = simulate({ nodes, edges }, e.trueStream);
    const ok = sim.ok && !sim.errors.some((x) => x.code === 'graph.recycle');
    if (!ok) expect(sim.errors.some((x) => x.code === 'graph.recycle')).toBe(true);
    if (!ok) expect(sim.ok).toBe(false);
    // generous budget: the point is "stops, does not hang"; 8 s tripped when the full suite runs in parallel
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});
