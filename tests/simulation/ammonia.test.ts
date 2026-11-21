/** Ammonia as a weak base in the charge balance — knowledge/chemistry/acid_base_chemistry.md "Ammonia". */
import { describe, expect, it } from 'vitest';
import { emptyStream } from '../../src/simulation/core/stream';
import { alkalinity, equilibrate, setCbForPH, solvePH } from '../../src/simulation/chemistry/acidBase';
import { pKaNH4 } from '../../src/simulation/chemistry/constants';
import { unaidedPrecipitateV50 } from '../../src/simulation/chemistry/neutralisation';
import { migrate } from '../../src/game/store';

describe('ammonia speciation (NH4+ ⇌ NH3, Emerson 1975)', () => {
  it('pKa 9.25 at 25 °C, 9.09 at 30 °C', () => {
    expect(pKaNH4(25)).toBeCloseTo(9.25, 2);
    expect(pKaNH4(30)).toBeCloseTo(9.09, 1);
  });
  it('nitrification at pH 7.5 still consumes 7.14 mg CaCO3 per mg N', () => {
    const s = setCbForPH({ ...emptyStream(1), T: 25, CT: 3e-3, NH4N: 20 }, 7.5);
    const t = equilibrate({ ...s, NH4N: 10, NO3N: 10, Cb: s.Cb - 10 / 14007 });
    expect((alkalinity(s) - alkalinity(t)) / 10).toBeCloseTo(7.14, 1);
  });
  it('NH3 counts as alkalinity at high pH (titrates to NH4+ by pH 4.5)', () => {
    const base = setCbForPH({ ...emptyStream(1), T: 25, CT: 0.5e-3 }, 10.5);
    const withN = setCbForPH({ ...emptyStream(1), T: 25, CT: 0.5e-3, NH4N: 28 }, 10.5); // 2 mmol N
    // ≈ 95 % NH3 at pH 10.5 → ≈ 1.9 meq/L ≈ 95 mg/L CaCO3 extra
    expect(alkalinity(withN) - alkalinity(base)).toBeGreaterThan(85);
    expect(alkalinity(withN) - alkalinity(base)).toBeLessThan(100);
  });
  it('old saves: Cb shifted by NH4N/14 007 so the stored pH is unchanged below pH 8.5', () => {
    const s = setCbForPH({ ...emptyStream(100), T: 30, CT: 4e-3, NH4N: 40 }, 7.2);
    const old = { ...s, Cb: s.Cb + 40 / 14007 }; // how a chem-1 save stored it
    const raw = { version: 2, cash: 1, week: 1, enquiries: [{ trueStream: old }] };
    const m = migrate(JSON.parse(JSON.stringify(raw)))!;
    const fixed = (m.enquiries as unknown as { trueStream: typeof s }[])[0].trueStream;
    expect(solvePH(fixed)).toBeCloseTo(7.2, 3);
    expect(m.chem).toBe(2);
    expect(migrate(JSON.parse(JSON.stringify(m)))!.enquiries).toEqual(m.enquiries); // idempotent
  });
});

describe('unaided pin floc (relaxed 2026-11-21)', () => {
  it('18 mg/L Ni (≈ 28 mg/L Ni(OH)2) with 30 min reaction settles at ≈ 0.5–0.7 m/h', () => {
    const v = unaidedPrecipitateV50(30, 28);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.7);
  });
});
