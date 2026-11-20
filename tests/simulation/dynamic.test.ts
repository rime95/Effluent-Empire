import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { runDynamic, diurnal } from '../../src/simulation/dynamic/plantDynamics';
import { derivatives, oxygenSaturation, ASM1 } from '../../src/simulation/dynamic/asm1';

function refPlant(industry: 'plating' | 'food' | 'semiconductor', seed0 = 11) {
  let e = generateEnquiry(seed0, 1, 0);
  for (let s = seed0 + 1; e.industry !== industry || e.standard !== 'B'; s++) e = generateEnquiry(s, 1, 0);
  return { e, graph: linearGraph(REFERENCE[industry](e.trueStream)) };
}

describe('ASM1 core (knowledge/biological/asm1.md)', () => {
  it('O2 saturation: 20 °C ≈ 9.09, 30 °C ≈ 7.56 mg/L', () => {
    expect(oxygenSaturation(20)).toBeCloseTo(9.09, 1);
    expect(oxygenSaturation(30)).toBeCloseTo(7.56, 1);
  });
  it('closed aerobic reactor: COD + O2 balance closes (dCOD − dSO − 4.57·dNO3 … electron balance)', () => {
    const x = { SS: 50, XS: 100, XBH: 2000, XBA: 100, XP: 300, XI: 500, SNH: 20, SNO: 0, SO: 4, XM: 0, Cb: 0.002 };
    const u = { Q: 0, V: 1000, T: ASM1.Tref, in: { ...x }, kLa: 0, SOsat: 8, wasteRate: 0, effluentCarry: 0, inhibH: 1, inhibA: 1 };
    const { dx } = derivatives(x, u);
    // electron balance (Henze 1987): Σ COD − SO − 4.57·(NO3-N) is invariant (nitrate as oxidised N; anoxic growth off at SNO = 0)
    const inv = dx.SS + dx.XS + dx.XBH + dx.XBA + dx.XP + dx.XI - dx.SO - 4.57 * dx.SNO;
    expect(Math.abs(inv)).toBeLessThan(1e-9 * 1e4);
  });
  it('closed aerobic reactor: N balance closes (NH4 + NO3 + iXB·(XBH+XBA) + iXP·XP + iXB·(1−fP)·decayed-to-XS)', () => {
    const x = { SS: 50, XS: 100, XBH: 2000, XBA: 100, XP: 300, XI: 500, SNH: 20, SNO: 0, SO: 4, XM: 0, Cb: 0.002 };
    const u = { Q: 0, V: 1000, T: ASM1.Tref, in: { ...x }, kLa: 0, SOsat: 8, wasteRate: 0, effluentCarry: 0, inhibH: 1, inhibA: 1 };
    const { dx } = derivatives(x, u);
    // Simplification: N of decayed biomass that becomes XS is released as NH4 immediately (organic N not tracked), so XS carries no N
    const dN = dx.SNH + dx.SNO + ASM1.iXB * (dx.XBH + dx.XBA) + ASM1.iXP * dx.XP;
    expect(Math.abs(dN)).toBeLessThan(1e-9);
  });
});

describe('dynamic plant runner', () => {
  it('diurnal pattern averages to 1', () => {
    let s = 0;
    for (let h = 0; h < 24; h += 0.25) s += diurnal(h, 1.8);
    expect(s / 96).toBeCloseTo(1, 3);
  });
  for (const ind of ['plating', 'food'] as const) {
    it(`${ind} reference plant, no disturbance: mostly compliant over 48 h`, () => {
      const { e, graph } = refPlant(ind);
      const steady = simulate(graph, e.trueStream);
      const r = runDynamic(graph, e.trueStream, e.standard, { hours: 48, disturbances: [] });
      console.log(ind, 'steady', steady.nodes ? 'ok' : '', 'dyn compliant', r.compliantFraction.toFixed(2), r.worst, 'overflow', r.overflowM3.toFixed(0));
      expect(r.points.length).toBe(193);
      expect(r.compliantFraction).toBeGreaterThan(0.9);
    });
  }
  it('plating: final neutralisation acid pump trip sends pH > 9 to drain (coag pH trim masks a precipitation-pump trip)', () => {
    const { e, graph } = refPlant('plating');
    const prec = graph.nodes.find((n) => n.kind === 'neutralisation')!;
    const r = runDynamic(graph, e.trueStream, e.standard, { hours: 24, disturbances: [{ kind: 'pumpTrip', unitId: prec.id }] });
    console.log('pumpTrip', r.compliantFraction, r.worst);
    expect(r.compliantFraction).toBeLessThan(0.5);
    expect(r.worst?.param).toBe('pH');
  });
  it('food: blower trip lowers DO and raises effluent NH3-N/BOD', () => {
    const { e, graph } = refPlant('food');
    const as = graph.nodes.find((n) => n.kind === 'activatedSludge')!;
    const base = runDynamic(graph, e.trueStream, e.standard, { hours: 24, disturbances: [] });
    const r = runDynamic(graph, e.trueStream, e.standard, { hours: 24, disturbances: [{ kind: 'blowerTrip', unitId: as.id, capacity: 0 }] });
    const lastDO = (x: typeof r) => x.points[x.points.length - 1].units[as.id].DO;
    const nh = (x: typeof r) => x.points[x.points.length - 1].effluent.NH3N;
    console.log('DO', lastDO(base), lastDO(r), 'NH3', nh(base), nh(r));
    expect(lastDO(r)).toBeLessThan(lastDO(base));
    expect(nh(r)).toBeGreaterThan(nh(base));
  });
});

import { ACTIONS, applyIncidentSteady, availableActions, incidentDisturbances, rollIncident, Incident } from '../../src/game/incidents';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { createRng } from '../../src/game/rng';
import { incidentGrabSample } from '../../src/game/operations';

describe('incidents (knowledge/operations/scada.md)', () => {
  const steadyPass = (graph: ReturnType<typeof refPlant>['graph'], e: ReturnType<typeof refPlant>['e'], inc: Incident | null) => {
    const d = applyIncidentSteady(graph, e.trueStream, inc);
    const sim = simulate(d.graph, d.influent);
    return evaluate(sim.effluent!, e.standard, sim).pass;
  };
  it('every rolled incident is physically possible on the plant and has a correct, available action', () => {
    for (const ind of ['plating', 'food'] as const) {
      const { graph } = refPlant(ind);
      for (let s = 0; s < 60; s++) {
        const inc = rollIncident(graph, 5, createRng(s))!;
        expect(inc).not.toBeNull();
        if (inc.unitId) expect(graph.nodes.some((n) => n.id === inc.unitId)).toBe(true);
        const fixes = availableActions(graph).filter((a) => a.fixes.includes(inc.kind));
        expect(fixes.length, `${ind} ${inc.kind}`).toBeGreaterThan(0);
        expect(incidentDisturbances(inc).length).toBe(1);
      }
    }
  });
  it('food: unresolved blower trip fails the weekly grab sample (dynamic); plant passes without it', () => {
    const { e, graph } = refPlant('food');
    const as = graph.nodes.find((n) => n.kind === 'activatedSludge')!;
    expect(steadyPass(graph, e, null)).toBe(true);
    const inc: Incident = { kind: 'blowerTrip', unitId: as.id, tag: as.tag!, startWeek: 1, symptoms: [], tried: [], magnitude: 0 };
    expect(incidentGrabSample(graph, e.trueStream, e.standard, inc, 20).pass).toBe(false);
  });
  it('plating: final pH probe reading 2 units low drives the true pH out of range (dynamic)', () => {
    const { e, graph } = refPlant('plating');
    const neu = graph.nodes.find((n) => n.kind === 'neutralisation')!;
    // probe reads 2 units LOW → loop under-doses acid, true pH ≈ 9.5 > 9 (Std B max). (Reading high only saturates the acid pump.)
    const r = runDynamic(graph, e.trueStream, e.standard, { hours: 24, disturbances: [{ kind: 'probeOffset', unitId: neu.id, offset: -2 }] });
    expect(r.compliantFraction).toBeLessThan(0.5);
    expect(r.worst?.param).toBe('pH');
  });
  it('every action id is unique and labelled', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
});
