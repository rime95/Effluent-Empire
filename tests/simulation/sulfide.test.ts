/** Sulfide precipitation and complexed metals. Ref: knowledge/chemistry/sulfide_precipitation.md */
import { describe, it, expect } from 'vitest';
import { COMPLEX_BREAK, NAHS_MW, precipitateSulfide, sulfideDemand_molL } from '../../src/simulation/chemistry/sulfide';
import { emptyStream, metalTotal, metalSoluble } from '../../src/simulation/core/stream';
import { equilibrate, setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { neutralise } from '../../src/simulation/chemistry/neutralisation';
import { components } from '../../src/simulation/core/massBalance';
import { MW } from '../../src/simulation/core/units';
import { generateEnquiry } from '../../src/game/customers';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { VARIANTS, referenceGraph } from '../../src/game/variants';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { applyTest, designBasis, declaredDatasheet } from '../../src/game/lab';
import { createRng } from '../../src/game/rng';

const feed = (ni: number, cxNi: number, cu = 0) => {
  const s = emptyStream(100);
  s.T = 30;
  s.CT = 0.5e-3;
  s.dissolved = { Ni: ni, Cu: cu, Zn: 0, Cr: 0 };
  s.complexed = { Ni: cxNi, Cu: 0, Zn: 0, Cr: 0 };
  return setCbForPH(s, 9.5);
};

describe('complexed metal', () => {
  it('hydroxide precipitation at high pH leaves complexed Ni in solution', () => {
    const s = feed(10, 10);
    const r = neutralise(s, { targetPH: 10, reagent: 'NaOH', volume_m3: 5 } as never);
    expect(r.out.complexed!.Ni).toBeCloseTo(10, 6);
    expect(metalSoluble(r.out, 'Ni')).toBeGreaterThan(10);
  });
  it('counts in total metal and in the mass balance', () => {
    const s = feed(5, 7);
    expect(metalTotal(s, 'Ni')).toBeCloseTo(12, 6);
    expect(components(s).Ni).toBeCloseTo((100 * 12) / 1000, 6);
  });
});

describe('sulfide dosing', () => {
  it('stoichiometry: 1 mol S per mol Ni; demand counts free + complexed', () => {
    const s = setCbForPH(feed(5, 10), 7); // free Ni stays dissolved at pH 7
    expect(sulfideDemand_molL(s)).toBeCloseTo((s.dissolved.Ni + 10) / MW.Ni / 1000, 9);
    const dose = 1.3 * sulfideDemand_molL(s) * NAHS_MW * 1000;
    const r = precipitateSulfide(s, { dose_mgL: dose, volume_m3: 3 });
    expect(r.out.dissolved.Ni).toBeLessThan(0.01);
    expect(r.out.complexed!.Ni).toBeCloseTo(10 * (1 - COMPLEX_BREAK), 6);
    expect(r.out.sulfide!.Ni).toBeCloseTo(s.dissolved.Ni + 10 * COMPLEX_BREAK, 4);
  });
  it('under-dose: copper sulfide forms first, nickel is left', () => {
    const s = setCbForPH(feed(10, 0, 10), 5.5); // both metals dissolved
    const half = (10 / MW.Cu / 1000) * NAHS_MW * 1000; // exactly the copper demand
    const r = precipitateSulfide(s, { dose_mgL: half, volume_m3: 3 });
    expect(r.out.dissolved.Cu).toBeLessThan(0.01);
    expect(r.out.dissolved.Ni + r.out.precipitated.Ni).toBeGreaterThan(9.5);
    expect(r.notes.some((n) => n.code === 'sulf.under')).toBe(true);
  });
  it('metal sulfide does not re-dissolve when the pH is lowered (hydroxide would)', () => {
    const s = feed(10, 0);
    const r = precipitateSulfide(s, { dose_mgL: 12, volume_m3: 3 });
    const low = equilibrate(setCbForPH(r.out, 6));
    expect(low.sulfide!.Ni).toBeCloseTo(r.out.sulfide!.Ni, 6);
  });
  it('releases acid (pH falls) and warns about H2S at low pH; fresh sulfide is colloidal', () => {
    const s = feed(20, 0);
    const r = precipitateSulfide(s, { dose_mgL: 40, volume_m3: 3 });
    expect(r.out.pH).toBeLessThan(s.pH);
    expect(r.out.v50.precipitate).toBeLessThan(0.2);
    const acid = setCbForPH(feed(5, 0), 6.5);
    expect(precipitateSulfide(acid, { dose_mgL: 50, volume_m3: 3 }).notes.some((n) => n.code === 'sulf.h2s')).toBe(true);
  });
  it('conserves metal and puts excess sulfur in the sulfate balance', () => {
    const s = feed(8, 8);
    const r = precipitateSulfide(s, { dose_mgL: 40, volume_m3: 3 });
    expect(components(r.out).Ni).toBeCloseTo(components(s).Ni, 9);
    expect(r.produced.SO4).toBeGreaterThan(0);
  });
});

describe('electroless-nickel client (sulfide variant)', () => {
  const find = (n: number) => {
    const out = [];
    for (let seed = 1; out.length < n && seed < 3000; seed++) {
      const e = generateEnquiry(seed, 1, 30, { tech: ['sulfide'] });
      if (e.variant?.id === 'complexedNi') out.push(e);
    }
    return out;
  };
  it('the sulfide reference passes Standard B; the hydroxide reference does not', () => {
    const v = VARIANTS.find((x) => x.id === 'complexedNi')!;
    for (const e of find(6)) {
      const sim = simulate(referenceGraph(v, e.trueStream), e.trueStream);
      expect(sim.balance?.ok).toBe(true);
      expect(evaluate(sim.effluent!, e.standard, sim).pass).toBe(true);
      const hyd = simulate(linearGraph(REFERENCE.plating(e.trueStream)), e.trueStream);
      expect(evaluate(hyd.effluent!, e.standard, hyd).pass).toBe(false);
    }
  });
  it('the metals panel reveals the complexed share and the design basis carries it', () => {
    const [e] = find(1);
    const ds = applyTest(declaredDatasheet(e.trueStream, createRng(1), false), 'metals', e.trueStream, createRng(2));
    expect(ds.complexed?.Ni).toBeGreaterThan(5);
    expect(designBasis(ds).stream.complexed!.Ni).toBeCloseTo(ds.complexed!.Ni!, 6);
  });
});
