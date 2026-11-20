// Reference calculations: knowledge/chemistry/acid_base_chemistry.md §Worked examples
import { emptyStream } from '../../src/simulation/core/stream';
import { alkalinity, baseDemand, bufferIntensity, equilibrate, requiredCb, setCbForPH, solvePH, titrationCurve } from '../../src/simulation/chemistry/acidBase';
import { pK1, pK2, pKw } from '../../src/simulation/chemistry/constants';
import { mgCaCO3_to_eqL } from '../../src/simulation/core/units';

describe('equilibrium constants (25 °C)', () => {
  it('pKw ≈ 14.00, pK1 ≈ 6.35, pK2 ≈ 10.33', () => {
    expect(pKw(25)).toBeCloseTo(14.0, 1);
    expect(pK1(25)).toBeCloseTo(6.35, 2);
    expect(pK2(25)).toBeCloseTo(10.33, 2);
  });
  it('pKw decreases with temperature (≈13.68 at 35 °C)', () => {
    expect(pKw(35)).toBeLessThan(pKw(25));
    expect(pKw(35)).toBeCloseTo(13.68, 1);
  });
});

describe('charge-balance pH solver', () => {
  it('pure water at 25 °C → pH 7.00', () => {
    expect(solvePH(emptyStream(1))).toBeCloseTo(7.0, 2);
  });
  it('1 mM strong acid → pH 3.00', () => {
    const s = emptyStream(1);
    s.Cb = -1e-3;
    expect(solvePH(s)).toBeCloseTo(3.0, 2);
  });
  it('1 mM strong base → pH 11.00', () => {
    const s = emptyStream(1);
    s.Cb = 1e-3;
    expect(solvePH(s)).toBeCloseTo(11.0 - (14 - pKw(25)), 2);
  });
  it('2 mM NaHCO3 (Cb = C_T = 2 mM) → pH ≈ 8.3 = (pK1+pK2)/2', () => {
    const s = emptyStream(1);
    s.Cb = 2e-3;
    s.CT = 2e-3;
    expect(solvePH(s)).toBeCloseTo((pK1(25) + pK2(25)) / 2, 1);
  });
  it('charge balance closes after solving', () => {
    const s = emptyStream(1);
    s.Cb = 1.5e-3;
    s.CT = 3e-3;
    const pH = solvePH(s);
    expect(Math.abs(requiredCb(s, pH) - s.Cb)).toBeLessThan(1e-10);
  });
  it('alkalinity of 2 mM NaHCO3 ≈ 100 mg/L as CaCO3', () => {
    const s = emptyStream(1);
    s.Cb = 2e-3;
    s.CT = 2e-3;
    expect(alkalinity(equilibrate(s))).toBeCloseTo(100, -1);
  });
});

describe('titration and buffering', () => {
  it('titration curve is monotonic', () => {
    const s = emptyStream(1);
    s.CT = 3e-3;
    s.Cb = -2e-3;
    const pts = titrationCurve(s, [0, 1e-3, 2e-3, 3e-3, 4e-3, 6e-3]);
    for (let i = 1; i < pts.length; i++) expect(pts[i].pH).toBeGreaterThan(pts[i - 1].pH);
  });
  it('same pH, more buffer → more NaOH to reach pH 9', () => {
    const weak = setCbForPH({ ...emptyStream(1), CT: 0.5e-3 }, 4);
    const strong = setCbForPH({ ...emptyStream(1), CT: 5e-3 }, 4);
    expect(weak.pH).toBeCloseTo(4, 2);
    expect(strong.pH).toBeCloseTo(4, 2);
    expect(baseDemand(strong, 9)).toBeGreaterThan(baseDemand(weak, 9) * 2);
    expect(bufferIntensity(strong, 6.35)).toBeGreaterThan(bufferIntensity(weak, 6.35));
  });
  it('mgCaCO3 conversion: 50 mg/L as CaCO3 = 1 meq/L', () => {
    expect(mgCaCO3_to_eqL(50.04)).toBeCloseTo(1e-3, 6);
  });
});

// Bisulfate (HSO4− ⇌ H+ + SO4 2−, pKa2 1.99) — knowledge/chemistry/acid_base_chemistry.md §Sulfate
import { sulfuricAcidDose, adjustPH } from '../../src/simulation/chemistry/acidBase';
describe('sulfuric acid and bisulfate', () => {
  it('1 mM H2SO4 → pH ≈ 2.73 (not 2.70: HSO4− only partly dissociated)', () => {
    const pH = solvePH({ ...emptyStream(1), SO4T: 1e-3 });
    expect(pH).toBeGreaterThan(2.71);
    expect(pH).toBeLessThan(2.76);
  });
  // ideal solution (I → 0): H = C(1 + Ka/(Ka + H)) → [H+] = 14.2 mM. Measured ≈ 1.96 includes activity effects (I ≈ 0.03 M),
  // which the model neglects by design (see acid_base_chemistry.md §Assumptions).
  it('10 mM H2SO4 → pH 1.85 ideal (a fully dissociated acid would give 1.70)', () => {
    const pH = solvePH({ ...emptyStream(1), SO4T: 10e-3 });
    expect(pH).toBeCloseTo(1.848, 2);
  });
  it('H2SO4 demand vs the old strong-anion model: ≈ +33 % to pH 2, ≈ +14 % to pH 2.5', () => {
    const w = setCbForPH({ ...emptyStream(1), CT: 1e-3 }, 7);
    const ratio = (pH: number) => (2 * sulfuricAcidDose(w, pH)) / -baseDemand(w, pH);
    expect(ratio(2)).toBeGreaterThan(1.25);
    expect(ratio(2)).toBeLessThan(1.45);
    expect(ratio(2.5)).toBeGreaterThan(1.08);
    expect(ratio(2.5)).toBeLessThan(1.2);
    expect(ratio(4)).toBeCloseTo(1, 2); // negligible bisulfate at pH 4
  });
  it('adjustPH reaches the set-point with acid and with alkali', () => {
    const w = setCbForPH({ ...emptyStream(1), CT: 2e-3, SO4T: 5e-3 }, 6);
    expect(solvePH(adjustPH(w, 2.2).stream)).toBeCloseTo(2.2, 3);
    expect(solvePH(adjustPH(w, 9.5, 'lime').stream)).toBeCloseTo(9.5, 3);
  });
  it('background sulfate adds acidity at low pH: more NaOH needed to neutralise a sulfate-rich acidic rinse', () => {
    const lo = setCbForPH({ ...emptyStream(1), CT: 0.5e-3, SO4T: 0 }, 2.5);
    const hi = setCbForPH({ ...emptyStream(1), CT: 0.5e-3, SO4T: 15e-3 }, 2.5);
    expect(baseDemand(hi, 7)).toBeGreaterThan(baseDemand(lo, 7));
  });
});
