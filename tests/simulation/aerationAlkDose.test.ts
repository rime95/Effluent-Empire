/** Alkalinity dosing in the aeration tank — reference: knowledge/biological/activated_sludge.md "Alkalinity dosing". */
import { describe, expect, it } from 'vitest';
import { emptyStream } from '../../src/simulation/core/stream';
import { alkalinity, setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { activatedSludge, activatedSludgeControlled } from '../../src/simulation/biological/activatedSludge';
import { checkMassBalance, components, zeroComponents } from '../../src/simulation/core/massBalance';
import { ALK_REAGENTS, type AlkReagent } from '../../src/simulation/biological/aeration';
import { CATALOGUE, defaultParams } from '../../src/simulation/treatment/catalogue';

// poorly buffered, ammonia-rich feed (e.g. neutralised rinse water): 40 mg/L NH4-N needs ≈ 285 mg/L CaCO3 to nitrify
const feed = () => {
  const s = { ...emptyStream(500), T: 30, CT: 0.6e-3, SS: 300, NH4N: 40 };
  return setCbForPH(s, 7.3);
};
const run = (alkPH: number, alkReagent: AlkReagent = 'NaOH') => activatedSludge(feed(), { volume_m3: 1500, srt_d: 15, do_mgL: 2, alkPH, alkReagent }, { clarifierFollows: true });

describe('aeration tank alkalinity dosing', () => {
  it('without dosing the feed runs out of alkalinity: pH falls and nitrification stalls', () => {
    const r = run(0);
    expect(alkalinity(feed())).toBeLessThan(60);
    expect(r.out.pH).toBeLessThan(6.8);
    expect(r.out.NH4N).toBeGreaterThan(10);
    expect(r.chemicals ?? []).toHaveLength(0);
  });
  it('holding pH 7.2 restores nitrification; the dose follows nitrification stoichiometry', () => {
    const r = run(7.2);
    expect(r.out.pH).toBeCloseTo(7.2, 2);
    expect(r.out.NH4N).toBeLessThan(3);
    const added = r.calcs.alkAdded.value; // mg/L CaCO3
    const nitrified = r.calcs.nitrified.value;
    // demand ≈ 7.14·N nitrified (+ uptake, residual alkalinity) − feed alkalinity, within a broad band
    expect(added).toBeGreaterThan(7.14 * nitrified - alkalinity(feed()) - 20);
    expect(added).toBeLessThan(7.14 * nitrified + 3.57 * 15 + 150);
    expect(r.chemicals?.[0].kgPerDay).toBeCloseTo((500 * (added / 50040) / ALK_REAGENTS.NaOH.eqPerMol) * ALK_REAGENTS.NaOH.mw, 0);
  });
  it('every reagent holds the set-point; per equivalent the alkalinity added is about the same', () => {
    const adds = (['NaOH', 'Na2CO3', 'NaHCO3', 'lime'] as AlkReagent[]).map((g) => {
      const r = run(7.2, g);
      expect(r.out.pH).toBeCloseTo(7.2, 2);
      expect(r.chemicals?.[0].name).toBe(ALK_REAGENTS[g].label);
      // kg/d of product = Q · mol/L · MW / purity, with mol/L = eq added / eq per mol
      const molL = r.calcs.alkAdded.value / 50040 / ALK_REAGENTS[g].eqPerMol;
      expect(r.chemicals?.[0].kgPerDay).toBeCloseTo((500 * molL * ALK_REAGENTS[g].mw) / ALK_REAGENTS[g].purity, 1);
      return r.calcs.alkAdded.value;
    });
    // carbonate reagents bring CO2 too, so they need slightly more equivalents to hold the same pH
    for (const a of adds) expect(Math.abs(a - adds[0]) / adds[0]).toBeLessThan(0.15);
  });
  it('no dose when the tank already runs above the set-point', () => {
    const r = run(5.5);
    expect(r.calcs.alkDose.value).toBe(0);
    expect(r.chemicals ?? []).toHaveLength(0);
  });
  it('catalogue: off by default; the dosing package adds CAPEX', () => {
    const def = CATALOGUE.activatedSludge;
    const p = defaultParams('activatedSludge', 500);
    expect(Number(p.alkPH)).toBe(0);
    const s = feed();
    const off = def.run(s, p, { clarifierFollows: true });
    const on = def.run(s, { ...p, alkPH: 7.2, alkReagent: 'Na2CO3' }, { clarifierFollows: true });
    expect(on.out.pH).toBeGreaterThan(off.out.pH);
    expect(def.capex({ ...p, alkPH: 7.2 }, s, on)).toBeGreaterThan(def.capex(p, s, on));
  });
  it('mass balance closes with dosing; lime impurities leave as mineral solids', () => {
    for (const g of ['NaOH', 'lime'] as AlkReagent[]) {
      const s = feed();
      const r = run(7.2, g);
      const bal = checkMassBalance({ in: components(s), out: components(r.out), sludge: r.removed ? components(r.removed, false) : zeroComponents(), gas: zeroComponents(), consumed: { ...zeroComponents(), ...r.consumed }, produced: { ...zeroComponents(), ...r.produced } });
      expect(bal.ok).toBe(true);
      if (g === 'lime') expect(r.produced?.mineral ?? 0).toBeGreaterThan(0);
    }
  });
  it('MLSS control carries the dosing through every sludge-age iteration', () => {
    const r = activatedSludgeControlled(feed(), { volume_m3: 1500, srt_d: 15, do_mgL: 2, control: 'mlss', mlssTarget_mgL: 2500, ras: 0.75, alkPH: 7.2, alkReagent: 'NaOH' }, { clarifierFollows: true });
    expect(r.out.pH).toBeCloseTo(7.2, 2);
    expect(r.calcs.alkDose.value).toBeGreaterThan(0);
  });
  it('lime above pH 7.5 warns about CaCO3 scaling; carbonate reagents above pH 8 get an info note', () => {
    expect(run(7.8, 'lime').notes.some((n) => n.code === 'as.limeScale')).toBe(true);
    expect(run(7.2, 'lime').notes.some((n) => n.code === 'as.limeScale')).toBe(false);
    expect(run(8.2, 'NaHCO3').notes.some((n) => n.code === 'as.carbonateHighPH')).toBe(true);
  });
});
