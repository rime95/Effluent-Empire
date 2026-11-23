/** Metal-hydroxide clarification: pin floc vs coagulant + polymer, lamella plates, re-dissolution diagnosis.
 *  Ref: knowledge/chemistry/precipitation.md, knowledge/chemistry/coagulation_flocculation.md, knowledge/physical/sedimentation.md */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { defaultParams, UnitType } from '../../src/simulation/treatment/catalogue';
import { evaluate, measure } from '../../src/simulation/treatment/compliance';
import { unaidedPrecipitateV50 } from '../../src/simulation/chemistry/neutralisation';
import { polymerEffect } from '../../src/simulation/chemistry/coagulation';
import { effectiveSettlingArea, precipitateFines } from '../../src/simulation/physical/units';

function plating() {
  let e = generateEnquiry(11, 1, 0);
  for (let s = 12; e.industry !== 'plating'; s++) e = generateEnquiry(s, 1, 0);
  return e.trueStream;
}
const train = (Q: number, units: [UnitType, Record<string, number | string>?][]) => linearGraph(units.map(([k, over]) => ({ kind: k, params: { ...defaultParams(k, Q), ...(over ?? {}) } })));
const clarNi = (g: ReturnType<typeof train>, s: ReturnType<typeof plating>) => {
  const sim = simulate(g, s);
  const cl = Object.values(sim.nodes).find((n) => n.node.kind === 'clarifier')!;
  return { sim, cl, inNi: measure(cl.inlet).Ni, outNi: measure(cl.result.out).Ni, capture: 1 - cl.result.out.precipitated.Ni / Math.max(cl.inlet.precipitated.Ni, 1e-9) };
};

describe('unaided pin floc', () => {
  it('grows with reaction time and with precipitate concentration (collision-limited), ceiling ≈ 1.0 m/h', () => {
    expect(unaidedPrecipitateV50(30, 50)).toBeGreaterThan(unaidedPrecipitateV50(10, 50));
    expect(unaidedPrecipitateV50(30, 200)).toBeGreaterThan(unaidedPrecipitateV50(30, 10));
    expect(unaidedPrecipitateV50(1e4, 1e6)).toBeCloseTo(1.0, 2);
  });
  it('precipitation → clarifier removes only part of the Ni(OH)₂ and the clarifier says why (pin-floc note)', () => {
    const s = plating();
    const { cl, inNi, outNi, capture } = clarNi(train(s.Q, [['eq'], ['precipitation'], ['clarifier']]), s);
    expect(capture).toBeGreaterThan(0.2);
    expect(capture).toBeLessThan(0.8);
    expect(outNi).toBeLessThan(inNi);
    expect(cl.result.notes.some((n) => n.code === 'clar.pinfloc')).toBe(true);
    expect(Object.keys(cl.result.calcs).some((k) => k.startsWith('rm_'))).toBe(true);
  });
  it('a larger clarifier (lower SOR) captures more pin floc', () => {
    const s = plating();
    const small = clarNi(train(s.Q, [['eq'], ['precipitation'], ['clarifier']]), s).capture;
    const big = clarNi(train(s.Q, [['eq'], ['precipitation'], ['clarifier', { area: (s.Q / 24 / 0.5) * 3 }]]), s).capture;
    expect(big).toBeGreaterThan(small);
  });
});

describe('coagulant + polymer flocculant', () => {
  it('polymer effect peaks at the optimum and falls when overdosed', () => {
    expect(polymerEffect(0)).toBe(0);
    expect(polymerEffect(1)).toBeCloseTo(1, 6);
    expect(polymerEffect(4)).toBeLessThan(polymerEffect(1));
  });
  it('with pH held at the precipitation pH, coagulant + polymer captures ≥ 98 % of Ni(OH)₂', () => {
    const s = plating();
    const r = clarNi(train(s.Q, [['eq'], ['precipitation', { targetPH: 9.5 }], ['coagulation', { coagulant: 'ferric', dose: 120, pHset: 9.5, polymer: 1 }], ['clarifier']]), s);
    expect(r.capture).toBeGreaterThanOrEqual(0.98);
    expect(r.outNi).toBeLessThan(0.5);
  });
  it('coagulant WITHOUT pH control re-dissolves Ni: error note at the coagulation unit and a compliance explanation naming it', () => {
    const s = plating();
    const g = train(s.Q, [['eq'], ['precipitation', { targetPH: 9.5 }], ['coagulation', { coagulant: 'pac', dose: 250, pHset: 0, polymer: 1 }], ['clarifier']]);
    const sim = simulate(g, s);
    const co = Object.values(sim.nodes).find((n) => n.node.kind === 'coagulation')!;
    expect(co.result.notes.some((n) => n.code === 'coag.redissolve.Ni')).toBe(true);
    const ni = evaluate(sim.effluent!, 'B', sim).checks.find((c) => c.param === 'Ni')!;
    expect(ni.pass).toBe(false);
    expect(ni.why).toContain('RE-DISSOLVED');
    expect(ni.why).toContain(co.node.tag!);
  });
  it('pH control holds its set-point even when aluminate formation consumes alkalinity (PAC at pH 9.5)', () => {
    const s = plating();
    const sim = simulate(train(s.Q, [['eq'], ['precipitation', { targetPH: 9.5 }], ['coagulation', { coagulant: 'pac', dose: 80, pHset: 9.5 }]]), s);
    const co = Object.values(sim.nodes).find((n) => n.node.kind === 'coagulation')!;
    expect(co.result.out.pH).toBeCloseTo(9.5, 1);
  });
});

describe('lamella clarifier', () => {
  it('effective area = 0.8·plates·cos 55°, never below the plan area (plates sit inside the tank)', () => {
    expect(effectiveSettlingArea(10, 100)).toBeCloseTo(0.8 * 100 * Math.cos((55 * Math.PI) / 180), 6);
    expect(effectiveSettlingArea(10, 5)).toBe(10);
  });
  it('aluminium speciation converges: PAC at pH 9.5 dissolves as aluminate and gets no floc credit', () => {
    const s = plating();
    const sim = simulate(train(s.Q, [['eq'], ['precipitation', { targetPH: 9.5 }], ['coagulation', { coagulant: 'pac', dose: 300, pHset: 9.5, polymer: 0 }]]), s);
    const co = Object.values(sim.nodes).find((n) => n.node.kind === 'coagulation')!;
    const al = co.result.out;
    expect(al.pH).toBeCloseTo(9.5, 2);
    // solubility at 9.5 ≈ 68 mg/L Al > dose → essentially all Al dissolved
    expect(al.alSolid).toBeLessThan(0.05 * (al.alSolid + al.alDissolved));
    expect(co.result.chemicals.filter((c) => /NaOH|H₂SO₄/.test(c.name)).length).toBeLessThanOrEqual(1);
  });
  it('plates in the same footprint raise pin-floc capture', () => {
    const s = plating();
    const A = s.Q / 24 / 0.5;
    const conv = clarNi(train(s.Q, [['eq'], ['precipitation'], ['clarifier', { area: A }]]), s).capture;
    const lam = clarNi(train(s.Q, [['eq'], ['precipitation'], ['clarifier', { area: A, plateArea: A * 10 }]]), s).capture;
    expect(lam).toBeGreaterThan(conv + 0.1);
  });
  it('non-settleable precipitate fines fall from 2 % (pin floc) to 0.3 % (well flocculated)', () => {
    expect(precipitateFines(0.2)).toBeCloseTo(0.02, 6);
    expect(precipitateFines(5)).toBeCloseTo(0.003, 6);
  });
});
