/** Instrumentation and redundancy effects. Ref: knowledge/operations/instrumentation.md */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate, ProcessGraph } from '../../src/simulation/treatment/graph';
import { runDynamic } from '../../src/simulation/dynamic/plantDynamics';
import { hasInst, instCapex, effectiveParams } from '../../src/simulation/treatment/instrumentation';
import { autoChangeover, availableActions, rollIncident, Incident } from '../../src/game/incidents';
import { runsManually } from '../../src/game/operations';
import { createRng } from '../../src/game/rng';

function refPlant(industry: 'plating' | 'food') {
  let e = generateEnquiry(11, 1, 0);
  for (let s = 12; e.industry !== industry || e.standard !== 'B'; s++) e = generateEnquiry(s, 1, 0);
  return { e, graph: linearGraph(REFERENCE[industry](e.trueStream)) };
}
const without = (g: ProcessGraph, kind: string, key: string): ProcessGraph => ({ ...g, nodes: g.nodes.map((n) => (n.kind === kind ? { ...n, inst: { ...(n.inst ?? {}), [key]: false } } : n)) });

describe('instrumentation', () => {
  it('missing inst data means installed (old saves keep full control); switching off lowers CAPEX', () => {
    const { e, graph } = refPlant('plating');
    const pr = graph.nodes.find((n) => n.kind === 'precipitation')!;
    expect(hasInst(pr, 'pHLoop')).toBe(true);
    expect(hasInst(pr, 'doLoop')).toBe(false); // not applicable
    const full = simulate(graph, e.trueStream).capex;
    const lean = simulate(without(graph, 'precipitation', 'pHLoop'), e.trueStream).capex;
    expect(full - lean).toBeCloseTo(18_000, 0);
    // standby is NOT installed by default; with it, a blower standby costs 9k + 26k
    expect(instCapex({ kind: 'activatedSludge' })).toBe(22_000);
    expect(instCapex({ kind: 'activatedSludge', inst: { standby: true } })).toBe(22_000 + 9_000 + 26_000);
    // coagulation has a pH loop only with a pH trim
    expect(instCapex({ kind: 'coagulation', params: { pHset: 0 } })).toBe(0);
    expect(instCapex({ kind: 'coagulation', params: { pHset: 9.5 } })).toBe(18_000);
  });
  it('manual dosing (no pH loop) gives a wider effluent pH band than PI control over a day', () => {
    const { e, graph } = refPlant('plating');
    const band = (g: ProcessGraph) => {
      const r = runDynamic(g, e.trueStream, e.standard, { hours: 24, disturbances: [] });
      const pr = g.nodes.find((n) => n.kind === 'precipitation')!.id;
      const ph = r.points.map((p) => p.units[pr].pH);
      return Math.max(...ph) - Math.min(...ph);
    };
    expect(band(without(graph, 'precipitation', 'pHLoop'))).toBeGreaterThan(band(graph) + 0.2);
    expect(runsManually(without(graph, 'precipitation', 'pHLoop'))).toBe(true);
    expect(runsManually(graph)).toBe(false);
  });
  it('no DO loop: fixed blower output — DO is no longer held at set-point', () => {
    const { e, graph } = refPlant('food');
    const as = graph.nodes.find((n) => n.kind === 'activatedSludge')!;
    const spread = (g: ProcessGraph) => {
      const r = runDynamic(g, e.trueStream, e.standard, { hours: 24, disturbances: [] });
      const d = r.points.map((p) => p.units[as.id].DO);
      return Math.max(...d) - Math.min(...d);
    };
    expect(spread(without(graph, 'activatedSludge', 'doLoop'))).toBeGreaterThan(spread(graph) + 0.3);
  });
  it('coagulation pH trim needs its pH loop', () => {
    const n = { kind: 'coagulation' as const, params: { pHset: 9.5 }, inst: { pHLoop: false } };
    expect(effectiveParams(n).pHset).toBe(0);
    expect(effectiveParams({ ...n, inst: {} }).pHset).toBe(9.5);
  });
  it('standby: trips change over automatically; without standby only emergency hire is offered', () => {
    const { graph } = refPlant('food');
    const as = graph.nodes.find((n) => n.kind === 'activatedSludge')!;
    const inc: Incident = { kind: 'blowerTrip', unitId: as.id, tag: as.tag!, startWeek: 1, symptoms: [], tried: [], magnitude: 0 };
    expect(autoChangeover(graph, inc)).toBe(false); // default: no standby
    const withSb: ProcessGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === as.id ? { ...n, inst: { standby: true } } : n)) };
    expect(autoChangeover(withSb, inc)).toBe(true);
    expect(availableActions(withSb, inc).map((a) => a.id)).toContain('standbyBlower');
    const lean = without(graph, 'activatedSludge', 'standby');
    expect(autoChangeover(lean, inc)).toBe(false);
    const ids = availableActions(lean, inc).map((a) => a.id);
    expect(ids).toContain('hireBlower');
    expect(ids).not.toContain('standbyBlower');
  });
  it('no probe → no probe-drift incidents, and pump-trip symptoms come from the lab, not an alarm', () => {
    const { graph } = refPlant('plating');
    const lean: ProcessGraph = { ...graph, nodes: graph.nodes.map((n) => (['neutralisation', 'precipitation', 'crReduction'].includes(n.kind) ? { ...n, inst: { pHLoop: false } } : n)) };
    for (let s = 0; s < 80; s++) {
      const inc = rollIncident(lean, 3, createRng(s))!;
      expect(inc.kind).not.toBe('probeDrift');
      if (inc.kind === 'pumpTrip') expect(inc.symptoms[0]).toContain('lab sample');
    }
  });
});

describe('instrumentation — review follow-ups', () => {
  it('the SCADA warm state depends on the instruments (no stale cache between manual and controlled designs)', () => {
    const { e, graph } = refPlant('food');
    const as = graph.nodes.find((n) => n.kind === 'activatedSludge')!.id;
    const a = runDynamic(graph, e.trueStream, e.standard, { hours: 2, disturbances: [] });
    const b = runDynamic(without(graph, 'activatedSludge', 'doLoop'), e.trueStream, e.standard, { hours: 2, disturbances: [] });
    expect(b.points[0].units[as].DO).not.toBeCloseTo(a.points[0].units[as].DO, 2);
  });
  it('plant-wide incidents are not offered pump/blower hire', () => {
    const { graph } = refPlant('food');
    const surge: Incident = { kind: 'hydraulicSurge', unitId: '', tag: 'Plant', startWeek: 1, symptoms: [], tried: [], magnitude: 1.8 };
    const ids = availableActions(graph, surge).map((a) => a.id);
    expect(ids).not.toContain('hirePump');
    expect(ids).not.toContain('hireBlower');
  });
  it('turning off a coagulation pH loop keeps the mass balance closed', () => {
    const { e, graph } = refPlant('plating');
    const g = without(graph, 'coagulation', 'pHLoop');
    const sim = simulate(g, e.trueStream);
    expect(sim.ok).toBe(true);
    expect(sim.balance?.ok).toBe(true);
    for (const n of Object.values(sim.nodes)) expect(n.balance.ok).toBe(true);
  });
});
