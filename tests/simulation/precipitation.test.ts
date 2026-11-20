// Reference: knowledge/chemistry/solubility_product.md §Solubility curves
import { emptyStream } from '../../src/simulation/core/stream';
import { equilibrate, setCbForPH, baseDemand } from '../../src/simulation/chemistry/acidBase';
import { minimumSolubilityPH, solubilityMgL } from '../../src/simulation/chemistry/solubility';

describe('hydroxide solubility', () => {
  it('Ni(OH)2: minimum between pH 9.5 and 11 (NEA hydrolysis constants)', () => {
    const m = minimumSolubilityPH('Ni');
    expect(m.pH).toBeGreaterThan(9.5);
    expect(m.pH).toBeLessThan(11);
  });
  it('Cu(OH)2: minimum between pH 8.5 and 10.5', () => {
    const m = minimumSolubilityPH('Cu');
    expect(m.pH).toBeGreaterThan(8.5);
    expect(m.pH).toBeLessThan(10.5);
  });
  it('Zn(OH)2: minimum between pH 8.5 and 10.5, amphoteric rise above', () => {
    const m = minimumSolubilityPH('Zn');
    expect(m.pH).toBeGreaterThan(8.5);
    expect(m.pH).toBeLessThan(10.5);
    expect(solubilityMgL('Zn', 12)).toBeGreaterThan(solubilityMgL('Zn', m.pH) * 10);
  });
  it('Ni is essentially fully soluble at pH 8 for 12 mg/L', () => {
    expect(solubilityMgL('Ni', 8)).toBeGreaterThan(12);
  });
});

describe('precipitation in solution', () => {
  const plating = () => {
    const s = emptyStream(100);
    s.CT = 0.5e-3;
    s.dissolved = { Ni: 12, Cu: 8, Zn: 5, Cr: 0 };
    return setCbForPH(s, 3.5);
  };
  it('below saturation nothing precipitates', () => {
    const s = plating();
    expect(s.precipitated.Ni).toBe(0);
    expect(s.dissolved.Ni).toBeCloseTo(12, 6);
  });
  it('raising pH to 10 precipitates Ni; metal mass is conserved', () => {
    const s = plating();
    s.Cb += baseDemand(s, 10);
    const e = equilibrate(s);
    expect(e.pH).toBeCloseTo(10, 2);
    expect(e.dissolved.Ni).toBeLessThan(0.2);
    expect(e.dissolved.Ni + e.precipitated.Ni).toBeCloseTo(12, 8);
  });
  it('precipitation consumes base: dose with metals > dose without', () => {
    const withM = plating();
    const noM = setCbForPH({ ...emptyStream(100), CT: 0.5e-3 }, 3.5);
    expect(baseDemand(withM, 10)).toBeGreaterThan(baseDemand(noM, 10));
  });
});
