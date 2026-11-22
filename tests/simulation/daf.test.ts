/** Dissolved-air flotation. Ref: knowledge/physical/flotation.md */
import { describe, it, expect } from 'vitest';
import { airSolubility_mLL, airToSolids, flotate } from '../../src/simulation/physical/flotation';
import { emptyStream } from '../../src/simulation/core/stream';
import { coagulate } from '../../src/simulation/chemistry/coagulation';
import { generateEnquiry } from '../../src/game/customers';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { VARIANTS, referenceGraph } from '../../src/game/variants';
import { foodTrain } from '../../src/game/referenceDesigns';

const oily = () => {
  const s = emptyStream(100);
  s.T = 30;
  s.peakFactor = 1;
  s.OGfree = 300;
  s.OGemulsified = 100;
  s.floc = 100;
  s.v50.floc = 1;
  return s;
};

describe('air-to-solids ratio (M&E)', () => {
  it('air solubility table and interpolation', () => {
    expect(airSolubility_mLL(20)).toBeCloseTo(18.7, 6);
    expect(airSolubility_mLL(30)).toBeCloseTo(15.7, 6);
    expect(airSolubility_mLL(25)).toBeCloseTo(17.2, 6);
  });
  it('reference calculation: 30 °C, 450 kPa(g), R 30 m³/d, Q 100 m³/d, 500 mg/L solids → 0.0411 mL/mg', () => {
    // 1.3 · 15.7 · (0.8 · 551.3/101.3 − 1) · 30 / (500 · 100)
    const P = 551.3 / 101.3;
    const expected = (1.3 * 15.7 * (0.8 * P - 1) * 30) / (500 * 100);
    expect(airToSolids({ T: 30, pressure_kPa: 450, recycle_m3d: 30, feed_m3d: 100, solids_mgL: 500 })).toBeCloseTo(expected, 8);
    expect(expected).toBeCloseTo(0.0411, 3);
  });
});

describe('flotation performance', () => {
  it('more air → better capture; free oil and floc float, emulsified oil mostly does not', () => {
    const lo = flotate(oily(), { area_m2: 10, recycle_pct: 5, pressure_kPa: 300 });
    const hi = flotate(oily(), { area_m2: 10, recycle_pct: 50, pressure_kPa: 550 });
    expect(hi.out.OGfree).toBeLessThan(lo.out.OGfree);
    expect(hi.out.OGfree / 300).toBeLessThan(0.12); // unconditioned free oil: φ 0.9
    expect(hi.out.OGemulsified / 100).toBeGreaterThan(0.85); // < 15 % capture of a stable emulsion
    expect(hi.notes.some((n) => n.code === 'daf.emulsion')).toBe(false); // 25 % emulsified: below the 30 % advice threshold
    expect(lo.notes.some((n) => n.code === 'daf.lowAS')).toBe(true);
  });

  it('hydraulic overload sweeps floc out', () => {
    const ok = flotate(oily(), { area_m2: 10, recycle_pct: 30, pressure_kPa: 450 });
    const over = flotate(oily(), { area_m2: 0.3, recycle_pct: 30, pressure_kPa: 450 });
    expect(over.out.OGfree).toBeGreaterThan(ok.out.OGfree);
    expect(over.notes.some((n) => n.code === 'daf.hlr')).toBe(true);
  });

  it('coagulation upstream breaks the emulsion so the DAF can float it', () => {
    const s = oily();
    s.OGfree = 100;
    s.OGemulsified = 300;
    s.pH = 7;
    const direct = flotate(s, { area_m2: 10, recycle_pct: 50, pressure_kPa: 550 });
    const c = coagulate(s, { coagulant: 'ferric', dose_mgL: 200, flocTime_min: 15, pHset: 7, polymer_mgL: 1 });
    const chem = flotate(c.out, { area_m2: 10, recycle_pct: 50, pressure_kPa: 550 });
    const oilOut = (r: typeof direct) => r.out.OGfree + r.out.OGemulsified;
    expect(oilOut(chem)).toBeLessThan(0.5 * oilOut(direct));
  });
});

describe('emulsified-oil client (DAF variant)', () => {
  const find = (n: number) => {
    const out = [];
    for (let seed = 1; out.length < n && seed < 3000; seed++) {
      const e = generateEnquiry(seed, 1, 30, { tech: ['daf'] });
      if (e.variant?.id === 'emulsifiedOil') out.push(e);
    }
    return out;
  };

  it('only appears once DAF is researched', () => {
    for (let seed = 1; seed < 200; seed++) expect(generateEnquiry(seed, 1, 30, { tech: [] }).variant).toBeUndefined();
    expect(find(1).length).toBe(1);
  });

  it('the DAF reference design passes; the gravity separator design does not', () => {
    for (const e of find(6)) {
      const ref = simulate(referenceGraph(VARIANTS.find((v) => v.id === 'emulsifiedOil')!, e.trueStream), e.trueStream);
      expect(ref.balance?.ok).toBe(true);
      expect(evaluate(ref.effluent!, e.standard, ref).pass).toBe(true);
      const grav = simulate(linearGraph(foodTrain(e.trueStream.Q)), e.trueStream);
      expect(evaluate(grav.effluent!, e.standard, grav).pass).toBe(false);
    }
  });
});

describe('DAF review fixes (2026-11-22)', () => {
  it('flotation conserves mass (oil and solids move to the float)', async () => {
    const { components, addComponents } = await import('../../src/simulation/core/massBalance');
    const s = oily();
    s.OGfloc = 50;
    const r = flotate(s, { area_m2: 10, recycle_pct: 30, pressure_kPa: 450 });
    const inC = components(s);
    const outC = addComponents(components(r.out), components(r.removed!));
    expect(outC.OG).toBeCloseTo(inC.OG, 6);
    expect(outC.COD).toBeCloseTo(inC.COD, 6);
  });

  it('A/S falls as temperature rises and rises with saturator pressure', () => {
    const base = { pressure_kPa: 450, recycle_m3d: 30, feed_m3d: 100, solids_mgL: 500 };
    expect(airToSolids({ ...base, T: 35 })).toBeLessThan(airToSolids({ ...base, T: 20 }));
    expect(airToSolids({ ...base, T: 30, pressure_kPa: 600 })).toBeGreaterThan(airToSolids({ ...base, T: 30 }));
  });

  it('unconditioned floc floats far less than coagulated floc; solids overload cuts capture', () => {
    const raw = oily();
    raw.v50.floc = 0.2;
    const cond = oily();
    cond.v50.floc = 3;
    const a = flotate(raw, { area_m2: 10, recycle_pct: 50, pressure_kPa: 550 });
    const b = flotate(cond, { area_m2: 10, recycle_pct: 50, pressure_kPa: 550 });
    expect(b.out.floc).toBeLessThan(0.5 * a.out.floc);
    const heavy = oily();
    heavy.floc = 4000;
    heavy.v50.floc = 3;
    const ok = flotate(heavy, { area_m2: 40, recycle_pct: 100, pressure_kPa: 600 });
    const over = flotate(heavy, { area_m2: 1.2, recycle_pct: 100, pressure_kPa: 600 }); // SLR ≈ 15 kg/m²·h, HLR ≈ 7 m/h
    expect(over.notes.some((n) => n.code === 'daf.slr')).toBe(true);
    expect(over.out.floc / heavy.floc).toBeGreaterThan(ok.out.floc / heavy.floc);
  });

  it('coagulated (floc-bound) oil: a clarifier catches little of it, a DAF floats it', async () => {
    const { clarify } = await import('../../src/simulation/physical/units');
    const s = oily();
    s.OGfree = 0;
    s.OGemulsified = 0;
    s.OGfloc = 200;
    const clar = clarify(s, { area_m2: 5 }); // primary clarifier at SOR ≈ 0.8 m/h
    const daf = flotate(s, { area_m2: 10, recycle_pct: 50, pressure_kPa: 550 });
    expect((clar.out.OGfloc ?? 0) / 200).toBeGreaterThan(0.5);
    expect((daf.out.OGfloc ?? 0) / 200).toBeLessThan(0.15);
  });

  it('oil blinds a sand filter above ~15 mg/L', async () => {
    const { filter } = await import('../../src/simulation/physical/units');
    const s = oily();
    s.OGfree = 0;
    s.OGemulsified = 0;
    s.OGfloc = 80;
    const r = filter(s, { area_m2: 10 });
    expect(r.notes.some((n) => n.code === 'filt.oil')).toBe(true);
    expect((r.out.OGfloc ?? 0) / 80).toBeGreaterThan(0.7);
  });
});
