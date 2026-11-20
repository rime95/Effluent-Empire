// Game-layer tests: determinism, lab, project lifecycle, save round-trip.
import { generateEnquiry } from '../../src/game/customers';
import { applyTest, designBasis, LAB_TESTS } from '../../src/game/lab';
import { commission, newProject } from '../../src/game/project';
import { createRng } from '../../src/game/rng';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph } from '../../src/simulation/treatment/graph';
import { defaultParams } from '../../src/simulation/treatment/catalogue';
import { metalTotal, codTotal } from '../../src/simulation/core/stream';

describe('customer generation', () => {
  it('same seed → identical enquiry', () => {
    expect(JSON.stringify(generateEnquiry(123, 1, 0))).toEqual(JSON.stringify(generateEnquiry(123, 1, 0)));
  });
  it('different seeds differ', () => {
    expect(generateEnquiry(1, 1, 0).company + generateEnquiry(1, 1, 0).declared.COD).not.toEqual(generateEnquiry(2, 1, 0).company + generateEnquiry(2, 1, 0).declared.COD);
  });
  it('no semiconductor enquiries below 40 reputation', () => {
    for (let s = 0; s < 60; s++) expect(generateEnquiry(s, 1, 0).industry).not.toBe('semiconductor');
  });
});

describe('laboratory', () => {
  it('metals panel reveals undeclared zinc', () => {
    let e = generateEnquiry(1, 1, 0);
    for (let s = 2; !e.hidden.undeclaredZn && s < 500; s++) e = generateEnquiry(s, 1, 0);
    expect(e.hidden.undeclaredZn).toBe(true);
    expect(e.declared.Zn).toBeUndefined();
    const ds = applyTest(e.declared, 'metals', e.trueStream, createRng(1));
    expect(ds.Zn!).toBeCloseTo(metalTotal(e.trueStream, 'Zn'), 0);
  });
  it('titration makes the design-basis alkalinity match the real sample', () => {
    const e = generateEnquiry(5, 1, 0);
    const ds = applyTest(e.declared, 'titration', e.trueStream, createRng(2));
    const b = designBasis(ds);
    expect(b.assumptions.some((a) => a.includes('Buffer'))).toBe(false);
    expect(b.stream.pH).toBeCloseTo(e.trueStream.pH, 1);
  });
  it('fractionation replaces the generic COD-fraction assumption', () => {
    const e = generateEnquiry(9, 1, 0);
    const ds = applyTest(e.declared, 'fractionation', e.trueStream, createRng(3));
    expect(designBasis(ds).assumptions.some((a) => a.includes('COD fractions'))).toBe(false);
    expect(ds.COD).toBeCloseTo(codTotal(e.trueStream), -2);
  });
  it('every lab test has a cost and duration', () => {
    for (const t of Object.values(LAB_TESTS)) {
      expect(t.cost).toBeGreaterThan(0);
      expect(t.weeks).toBeGreaterThan(0);
    }
  });
});

describe('project lifecycle', () => {
  const plating = () => {
    let e = generateEnquiry(1, 1, 0);
    for (let s = 2; (e.industry !== 'plating' || e.standard !== 'B') && s < 500; s++) e = generateEnquiry(s, 1, 0);
    return e;
  };
  it('an empty design reports errors instead of crashing', () => {
    const p = newProject(plating(), 1);
    const r = commission(p, 5);
    expect(r.pass).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it('a good metal train passes and is paid; a bad one fails', () => {
    const e = plating();
    const Q = e.trueStream.Q;
    const u = (kind: Parameters<typeof defaultParams>[0], over: Record<string, number | string> = {}) => ({ kind, params: { ...defaultParams(kind, Q), ...over } });
    const good = { ...newProject(e, 1), graph: linearGraph(REFERENCE.plating(e.trueStream)) };
    const r = commission(good, 6);
    expect(r.compliance.checks.filter((c) => !c.pass).map((c) => c.param)).toEqual([]);
    expect(r.payment).toBeGreaterThan(0);
    expect(r.reputationDelta).toBeGreaterThan(0);
    const bad = { ...newProject(e, 1), graph: linearGraph([u('eq'), u('neutralisation', { targetPH: 7.0 })]) };
    expect(commission(bad, 6).pass).toBe(false);
  });
  it('project state survives a JSON save round-trip', () => {
    const p = newProject(plating(), 1);
    const back = JSON.parse(JSON.stringify(p));
    expect(back).toEqual(p);
    expect(commission(back, 4).compliance.checks.length).toBe(commission(p, 4).compliance.checks.length);
  });
});
