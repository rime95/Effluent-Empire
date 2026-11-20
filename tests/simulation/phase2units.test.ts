// Reference: knowledge/chemistry/chromium.md, knowledge/physical/adsorption.md
import { emptyStream, cloneStream, METALS } from '../../src/simulation/core/stream';
import { setCbForPH, baseDemand, equilibrate } from '../../src/simulation/chemistry/acidBase';
import { minimumSolubilityPH, solubilityMgL } from '../../src/simulation/chemistry/solubility';
import { reduceChromium, reductionRate_perMin, MBS_PER_CR_STOICH } from '../../src/simulation/chemistry/chromiumReduction';
import { adsorb, freundlichQ } from '../../src/simulation/physical/carbon';
import { neutralise } from '../../src/simulation/chemistry/neutralisation';
import { checkMassBalance, components, zeroComponents } from '../../src/simulation/core/massBalance';
import { MW } from '../../src/simulation/core/units';
import { ProcessResult } from '../../src/simulation/treatment/types';
import { createRng } from '../../src/game/rng';

const balanced = (inS: ReturnType<typeof emptyStream>, r: ProcessResult) =>
  checkMassBalance({ in: components(inS), out: components(r.out), sludge: r.removed ? components(r.removed, false) : zeroComponents(), gas: { ...zeroComponents(), ...r.gas }, consumed: { ...zeroComponents(), ...r.consumed }, produced: { ...zeroComponents(), ...r.produced } });

const chromeRinse = (crVI = 20) => setCbForPH({ ...emptyStream(200), CT: 0.5e-3, CrVI: crVI, dissolved: { Ni: 5, Cu: 0, Zn: 0, Cr: 1 } }, 4.0);

describe('hexavalent chromium reduction', () => {
  it('stoichiometry: 0.75 mol Na2S2O5 per mol Cr = 2.74 mg/mg', () => {
    expect((MBS_PER_CR_STOICH * MW.Na2S2O5) / MW.Cr).toBeCloseTo(2.74, 2);
  });
  it('rate falls tenfold per pH unit', () => {
    expect(reductionRate_perMin(2) / reductionRate_perMin(3)).toBeCloseTo(10, 6);
  });
  it('design practice (pH 2.5, 20 min, 1.3× dose) reduces > 99.9 %', () => {
    const s = chromeRinse();
    const r = reduceChromium(s, { targetPH: 2.5, doseFactor: 1.3, volume_m3: (200 / 1440) * 20 });
    expect(r.out.CrVI).toBeLessThan(0.02);
    expect(r.out.pH).toBeCloseTo(2.5, 2); // set-point held after the reduction consumed H+
    expect(r.out.dissolved.Cr).toBeGreaterThan(20);
  });
  it('at pH 4 reduction is incomplete; with half the reductant at most 50 % is reduced', () => {
    const s = chromeRinse();
    expect(reduceChromium(s, { targetPH: 4, doseFactor: 1.3, volume_m3: (200 / 1440) * 20 }).out.CrVI).toBeGreaterThan(5);
    expect(reduceChromium(s, { targetPH: 2, doseFactor: 0.5, volume_m3: 50 }).out.CrVI).toBeCloseTo(10, 6);
  });
  it('chromium mass is conserved', () => {
    const s = chromeRinse();
    expect(balanced(s, reduceChromium(s, { targetPH: 2.5, doseFactor: 1.3, volume_m3: 3 })).ok).toBe(true);
  });
  it('Cr(VI) is NOT removed by hydroxide precipitation; Cr(III) is', () => {
    const s = chromeRinse();
    const precip = neutralise(s, { targetPH: 8.5, base: 'NaOH', volume_m3: 5 }).out;
    expect(precip.CrVI).toBeCloseTo(20, 6);
    expect(precip.dissolved.Cr).toBeLessThan(0.1);
  });
  it('Cr(OH)3 solubility minimum lies between pH 7 and 10', () => {
    const m = minimumSolubilityPH('Cr');
    expect(m.pH).toBeGreaterThan(7);
    expect(m.pH).toBeLessThan(10);
    expect(solubilityMgL('Cr', 4)).toBeGreaterThan(10); // acidic: Cr3+ soluble
  });
  it('chromate counts in the charge balance (acidity): more Cr(VI) → more base to pH 8', () => {
    const lo = setCbForPH({ ...emptyStream(100), CT: 1e-3, CrVI: 1 }, 4);
    const hi = setCbForPH({ ...emptyStream(100), CT: 1e-3, CrVI: 50 }, 4);
    expect(baseDemand(hi, 8)).toBeGreaterThan(baseDemand(lo, 8));
    const e = equilibrate(cloneStream(hi));
    expect(e.pH).toBeCloseTo(4, 2);
  });
});

describe('activated carbon', () => {
  it('Freundlich: q(100 mg/L) = 20·100^0.4 = 126.2 mg/g', () => {
    expect(freundlichQ(100)).toBeCloseTo(126.2, 1);
  });
  it('removes inert soluble COD that biology cannot, consuming carbon in proportion', () => {
    const s = setCbForPH({ ...emptyStream(500), SI: 120, SS: 5, CT: 3e-3 }, 7.5);
    const r = adsorb(s, { ebct_min: 15 });
    expect(r.out.SI).toBeLessThan(30);
    const removedCOD = s.SI - r.out.SI + (s.SS - r.out.SS);
    // CUR: Q·ΔC / q(C0,adsorbable) — g/d ÷ (g/kg) = kg/d. 0.8·120 + 0.3·5 = 97.5 mg/L adsorbable
    expect(r.chemicals[0].kgPerDay).toBeCloseTo((500 * removedCOD) / freundlichQ(0.8 * 120 + 0.3 * 5), 6);
    expect(r.chemicals[0].kgPerDay / 500).toBeGreaterThan(0.5); // ≈ 0.7 kg carbon per m³ — bulk COD on carbon is expensive
    expect(balanced(s, r).ok).toBe(true);
  });
  it('suspended solids blind the bed', () => {
    const clean = setCbForPH({ ...emptyStream(500), SI: 120, CT: 3e-3 }, 7.5);
    const dirty = setCbForPH({ ...emptyStream(500), SI: 120, CT: 3e-3, inert: 80 }, 7.5);
    expect(adsorb(dirty, { ebct_min: 15 }).out.SI).toBeGreaterThan(adsorb(clean, { ebct_min: 15 }).out.SI);
  });
});

describe('mass balance with chromium on random streams', () => {
  const rng = createRng(77);
  for (let i = 0; i < 20; i++) {
    it(`case ${i}`, () => {
      const s = emptyStream(rng.range(50, 1000));
      s.CT = rng.range(0, 5) / 1000;
      for (const m of METALS) s.dissolved[m] = rng.range(0, 10);
      s.CrVI = rng.range(0, 40);
      const inS = setCbForPH(s, rng.range(2.5, 9));
      const r = reduceChromium(cloneStream(inS), { targetPH: rng.range(2, 4), doseFactor: rng.range(0, 2), volume_m3: rng.range(1, 20) });
      expect(balanced(inS, r).ok).toBe(true);
      const n = neutralise(cloneStream(r.out), { targetPH: rng.range(7, 10), base: 'NaOH', volume_m3: 5 });
      expect(balanced(r.out, n).ok).toBe(true);
    });
  }
});
