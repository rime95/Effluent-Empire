/** Phase 3 review follow-ups: integrator conservation, EQ volume balance, cache isolation, incident integrity, store actions.
 *  Ref: knowledge/biological/asm1.md, knowledge/operations/scada.md */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { runDynamic } from '../../src/simulation/dynamic/plantDynamics';
import { ASM1, AS1State, derivatives, integrate } from '../../src/simulation/dynamic/asm1';
import { cloneStream } from '../../src/simulation/core/stream';
import { Incident } from '../../src/game/incidents';
import { useGame } from '../../src/game/store';
import { contractFor, omFeeQuote, recommendedMaintenance, Plant } from '../../src/game/operations';

function refPlant(industry: 'plating' | 'food', pred: (e: ReturnType<typeof generateEnquiry>) => boolean = () => true, seed0 = 11) {
  let e = generateEnquiry(seed0, 1, 0);
  for (let s = seed0 + 1; e.industry !== industry || e.standard !== 'B' || !pred(e); s++) e = generateEnquiry(s, 1, 0);
  return { e, graph: linearGraph(REFERENCE[industry](e.trueStream)) };
}

const closed = (x: AS1State) => ({ Q: 0, V: 1000, T: 28, in: { ...x }, kLa: 0, SOsat: 8, wasteRate: 0, effluentCarry: 0, inhibH: 1, inhibA: 1 });
const totCOD = (x: AS1State) => x.SS + x.XS + x.XBH + x.XBA + x.XP + x.XI;
const totN = (x: AS1State) => x.SNH + x.SNO + ASM1.iXB * (x.XBH + x.XBA) + ASM1.iXP * x.XP;

describe('ASM1 integrator conservation (closed batch)', () => {
  it('heterotrophic batch over 1 day: COD − O2 and total N are conserved by the integrated states (stiff, MLSS ≈ 4 g/L, O2 runs out)', () => {
    // no nitrifiers → no nitrate → no N2 loss, so COD − O2 and N are strict invariants even after O2 runs out (scaling active)
    const x0: AS1State = { SS: 200, XS: 300, XBH: 4000, XBA: 0, XP: 500, XI: 800, SNH: 30, SNO: 0, SO: 8, XM: 0, Cb: 0.004 };
    const { x } = integrate(x0, closed(x0), 1);
    const inv = (s: AS1State) => totCOD(s) - s.SO - 4.57 * s.SNO;
    expect(inv(x)).toBeCloseTo(inv(x0), 6);
    expect(totN(x)).toBeCloseTo(totN(x0), 6);
    for (const v of Object.values(x)) expect(v).toBeGreaterThanOrEqual(-1e-12);
  });
  it('anoxic electron balance: dCOD − dSO − 4.57·dNO3 − 1.71·dN2 = 0 with denitrification active', () => {
    const x: AS1State = { SS: 60, XS: 100, XBH: 2000, XBA: 100, XP: 300, XI: 500, SNH: 20, SNO: 10, SO: 0.05, XM: 0, Cb: 0.002 };
    const d = derivatives(x, closed(x));
    const dN2 = ((1 - ASM1.YH) / (2.86 * ASM1.YH)) * d.rates.rho2;
    const s = d.dx.SS + d.dx.XS + d.dx.XBH + d.dx.XBA + d.dx.XP + d.dx.XI - d.dx.SO - 4.57 * d.dx.SNO - 1.71 * dN2;
    expect(d.rates.rho2).toBeGreaterThan(0);
    expect(Math.abs(s)).toBeLessThan(1e-6);
  });
  it('N-deficient feed: N stays conserved and NH4 non-negative (nutrient switch; decay recycles N via death–regeneration)', () => {
    const x0: AS1State = { SS: 300, XS: 0, XBH: 2000, XBA: 0, XP: 0, XI: 0, SNH: 0.5, SNO: 0, SO: 8, XM: 0, Cb: 0 };
    const u = { ...closed(x0), kLa: 200 };
    const { x } = integrate(x0, u, 0.5);
    expect(totN(x)).toBeCloseTo(totN(x0), 6);
    expect(x.SNH).toBeGreaterThanOrEqual(0);
    expect(x.XBH).toBeLessThan(x0.XBH + (totN(x0) - 0) / ASM1.iXB); // growth bounded by N available
  });
});

describe('dynamic runner integrity', () => {
  it('EQ volume balance closes under a surge that overflows: Σ(Qin − Qout − overflow)·dt = ΔV', () => {
    const { e, graph } = refPlant('plating');
    const eq = graph.nodes.find((n) => n.kind === 'eq')!;
    const small = { ...graph, nodes: graph.nodes.map((n) => (n.id === eq.id ? { ...n, params: { ...n.params, volume: 10 } } : n)) };
    const r = runDynamic(small, e.trueStream, e.standard, { hours: 24, disturbances: [{ kind: 'flowSurge', factor: 2.5, fromH: 6, toH: 16 }] });
    expect(r.overflowM3).toBeGreaterThan(0);
    const V = 10;
    let net = 0;
    for (let i = 1; i < r.points.length; i++) {
      const u = r.points[i].units[eq.id];
      net += (r.points[i].Qin - u.outflow - u.overflow) * (0.25 / 24);
    }
    const dV = ((r.points[r.points.length - 1].units[eq.id].level - r.points[0].units[eq.id].level) / 100) * V;
    expect(net).toBeCloseTo(dV, 6);
  });
  it('warm cache is isolated: a different influent (5× Ni) gives a different result, and re-running the base is identical', () => {
    const { e, graph } = refPlant('plating');
    const a1 = runDynamic(graph, e.trueStream, e.standard, { hours: 6, disturbances: [] });
    const hi = cloneStream(e.trueStream);
    hi.dissolved.Ni *= 5;
    hi.precipitated.Ni *= 5;
    const b = runDynamic(graph, hi, e.standard, { hours: 6, disturbances: [] });
    const a2 = runDynamic(graph, e.trueStream, e.standard, { hours: 6, disturbances: [] });
    expect(a2.points.map((p) => p.effluent.Ni)).toEqual(a1.points.map((p) => p.effluent.Ni));
    expect(b.reagent_kg).not.toBeCloseTo(a1.reagent_kg, 3);
  });
  it('a bypassed (broken-down) dosing unit changes the dynamic result', () => {
    const { e, graph } = refPlant('plating');
    const neu = graph.nodes.find((n) => n.kind === 'neutralisation')!;
    const byp = { ...graph, nodes: graph.nodes.map((n) => (n.id === neu.id ? { ...n, bypass: true } : n)) };
    const r = runDynamic(byp, e.trueStream, e.standard, { hours: 6, disturbances: [] });
    expect(r.points[r.points.length - 1].effluent.pH).toBeGreaterThan(9);
  });
  it('Cr-plating plant: pump trip and probe drift on the Cr-reduction unit are visible in the replay', () => {
    const { e, graph } = refPlant('plating', (x) => (x.trueStream.CrVI ?? 0) > 1);
    const cr = graph.nodes.find((n) => n.kind === 'crReduction')!;
    expect(cr).toBeTruthy();
    const base = runDynamic(graph, e.trueStream, e.standard, { hours: 6, disturbances: [] });
    const trip = runDynamic(graph, e.trueStream, e.standard, { hours: 6, disturbances: [{ kind: 'pumpTrip', unitId: cr.id }] });
    const drift = runDynamic(graph, e.trueStream, e.standard, { hours: 6, disturbances: [{ kind: 'probeOffset', unitId: cr.id, offset: -2 }] });
    const last = (r: typeof base) => r.points[r.points.length - 1].effluent.CrVI;
    expect(base.compliantFraction).toBeGreaterThan(0.9);
    expect(last(trip)).toBeGreaterThan(0.05);
    expect(last(drift)).toBeGreaterThan(last(base));
  });
});

describe('SCADA store actions', () => {
  const mkPlant = (): Plant => {
    const { e, graph } = refPlant('food');
    const sim = simulate(graph, e.trueStream);
    const as = graph.nodes.find((n) => n.kind === 'activatedSludge')!;
    const incident: Incident = { kind: 'blowerTrip', unitId: as.id, tag: as.tag!, startWeek: 1, symptoms: ['x'], tried: [], magnitude: 0 };
    return {
      id: 'p1', company: e.company, industry: 'food', standard: 'B', graph, trueStream: e.trueStream, seed: e.seed, capex: sim.capex, commissionedWeek: 1,
      contract: contractFor(omFeeQuote({ capex: sim.capex, Q: e.trueStream.Q, std: 'B', reputation: 0, opexRMd: sim.opexRMd, graph }), 1),
      condition: 100, maintenanceBudget: recommendedMaintenance(sim.capex), satisfaction: 75, fines: 0, breakdown: null, incident, history: [], status: 'operating',
    };
  };
  it('wrong action charges and records the attempt; right action clears the incident', () => {
    // no engineers → no supervision discount (see tests/game/engineers.test.ts)
    useGame.setState({ plants: [mkPlant()], cash: 100_000, gameOver: false, staff: [], projects: [] });
    const wrong = useGame.getState().resolveIncident('p1', 'recalibrate');
    expect(wrong.ok).toBe(false);
    expect(useGame.getState().plants[0].incident?.tried).toEqual(['recalibrate']);
    expect(useGame.getState().cash).toBe(99_700);
    // no standby installed by default → switching to standby is not possible; emergency hire is
    expect(useGame.getState().resolveIncident('p1', 'standbyBlower').ok).toBe(false);
    const right = useGame.getState().resolveIncident('p1', 'hireBlower');
    expect(right.ok).toBe(true);
    expect(useGame.getState().plants[0].incident).toBeNull();
    expect(useGame.getState().cash).toBe(99_700 - 9_000);
  });
  it('setSetpoint only accepts whitelisted operator set-points and clamps them', () => {
    useGame.setState({ plants: [mkPlant()], gameOver: false });
    const as = useGame.getState().plants[0].graph.nodes.find((n) => n.kind === 'activatedSludge')!;
    useGame.getState().setSetpoint('p1', as.id, 'do', 99);
    useGame.getState().setSetpoint('p1', as.id, 'volume', 1);
    useGame.getState().setSetpoint('p1', as.id, 'srt', NaN);
    const n = useGame.getState().plants[0].graph.nodes.find((x) => x.id === as.id)!;
    expect(n.params.do).toBe(4);
    expect(n.params.volume).toBe(as.params.volume);
    expect(n.params.srt).toBe(as.params.srt);
  });
});
