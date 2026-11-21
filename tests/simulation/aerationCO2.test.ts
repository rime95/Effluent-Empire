/** Aeration-tank CO2 balance — reference: knowledge/chemistry/acid_base_chemistry.md "Aeration CO2 balance". */
import { describe, expect, it } from 'vitest';
import { emptyStream } from '../../src/simulation/core/stream';
import { aerationCarbonate, alkalinity, equilibrate, setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { KH_CO2, P_CO2_ATM, pK1, pK2 } from '../../src/simulation/chemistry/constants';
import { AERATION, airFlow_mold, co2Produced_mold, gasMolPerM3 } from '../../src/simulation/biological/aeration';
import { activatedSludge } from '../../src/simulation/biological/activatedSludge';

const water = (alk: number, pH = 7.5, Q = 1000) => {
  // C_T from the alkalinity at pH (bicarbonate range), then Cb from the pH
  const s = { ...emptyStream(Q), T: 30, CT: (alk / 50000) * 1.1 };
  return setCbForPH(s, pH);
};
const h2co3Of = (s: ReturnType<typeof equilibrate>) => {
  const K1 = 10 ** -pK1(30), H = 10 ** -s.pH;
  return s.CT / (1 + K1 / H + (K1 * 10 ** -pK2(30)) / (H * H));
};

describe('aeration CO2 balance', () => {
  it('no production and a very large air flow → liquid in equilibrium with atmospheric CO2', () => {
    const s = water(100);
    const e = equilibrate(s, aerationCarbonate({ Q_m3d: s.Q, CTin: s.CT, T: s.T, co2Produced_mold: 0, air_mold: 1e12 }));
    expect(h2co3Of(e) / (KH_CO2(30) * P_CO2_ATM)).toBeCloseTo(1, 1);
    expect(e.pH).toBeGreaterThan(8); // air-equilibrated 100 mg/L alkalinity water sits near pH 8.3
    expect(alkalinity(e)).toBeCloseTo(alkalinity(s), 0); // stripping CO2 does not change alkalinity
  });
  it('no air and no production → C_T conserved (same as a closed tank)', () => {
    const s = water(100);
    const e = equilibrate(s, aerationCarbonate({ Q_m3d: s.Q, CTin: s.CT, T: s.T, co2Produced_mold: 0, air_mold: 0 }));
    expect(e.CT).toBeCloseTo(s.CT, 9);
    expect(e.pH).toBeCloseTo(equilibrate(s).pH, 6);
  });
  it('carbon balance closes: liquid in + produced + air in = liquid out + off-gas', () => {
    const s = water(150);
    const P = 3000, G = 5e5;
    const e = equilibrate(s, aerationCarbonate({ Q_m3d: s.Q, CTin: s.CT, T: s.T, co2Produced_mold: P, air_mold: G }));
    const offGas = (G * h2co3Of(e)) / KH_CO2(30);
    expect(s.Q * 1000 * s.CT + P + G * P_CO2_ATM).toBeCloseTo(s.Q * 1000 * e.CT + offGas, 0);
  });
  it('air flow: the larger of O2 demand and the mixing minimum', () => {
    const o2 = 500e3; // g/d
    const a = airFlow_mold(o2, 100, 30);
    expect(a.air_mold).toBeCloseTo(o2 / 32 / (AERATION.OTE * AERATION.yO2), 0);
    expect(a.mixingLimited).toBe(false);
    const b = airFlow_mold(1000, 5000, 30);
    expect(b.mixingLimited).toBe(true);
    expect(b.air_mold / gasMolPerM3(30) / 1440).toBeCloseTo(AERATION.mixingAir_m3m3min * 5000, 3);
    expect(co2Produced_mold(32 * 100)).toBeCloseTo(AERATION.RQ * 100, 9);
  });
});

describe('aeration tank pH responds to load and flow (no fixed CO2 assumption)', () => {
  const feed = (cod: number, Q: number) => {
    const s = water(200, 7.2, Q);
    s.SS = cod;
    s.NH4N = 0.05 * cod;
    return s;
  };
  const run = (cod: number, Q: number, V = 1000) => activatedSludge(feed(cod, Q), { volume_m3: V, srt_d: 10, do_mgL: 2 }, { clarifierFollows: true });
  it('a higher organic load produces more CO2 and a lower reactor pH', () => {
    const lo = run(300, 1000);
    const hi = run(3000, 1000);
    expect(hi.calcs.co2.value).toBeGreaterThan(lo.calcs.co2.value);
    expect(hi.out.pH).toBeLessThan(lo.out.pH);
  });
  it('O2-limited basin: CO2 approaches the ceiling K_H·RQ·OTE·y_O2, independent of flow (air scales with load)', () => {
    const ceiling = KH_CO2(30) * AERATION.RQ * AERATION.OTE * AERATION.yO2 * 44010; // mg/L
    const a = run(3000, 600);
    const b = run(3000, 2400);
    for (const r of [a, b]) {
      expect(r.calcs.air.label).toContain('O₂');
      expect(r.calcs.co2.value).toBeLessThan(ceiling * 1.2); // + the influent C_T degassing in the basin
      expect(r.calcs.co2.value).toBeGreaterThan(ceiling * 0.6);
    }
    expect(Math.abs(a.calcs.co2.value - b.calcs.co2.value) / ceiling).toBeLessThan(0.15);
  });
  it('flow matters through the mixing floor: a mixing-limited basin strips more CO2 than an O2-limited one', () => {
    const mixing = run(600, 300); // light load in a big tank
    const o2lim = run(3000, 2400);
    expect(mixing.calcs.air.label).toContain('mixing');
    expect(mixing.calcs.co2.value).toBeLessThan(o2lim.calcs.co2.value);
  });
  it('net CO2 production may be negative (nitrifier fixation): no carbon is created', () => {
    const s = water(100);
    const m = aerationCarbonate({ Q_m3d: s.Q, CTin: s.CT, T: s.T, co2Produced_mold: -50, air_mold: 0 });
    expect(m.carbonIn_mold).toBeCloseTo(s.Q * 1000 * s.CT - 50, 6);
    const e = equilibrate(s, m);
    expect(e.CT).toBeLessThan(s.CT);
  });
  it('a lightly loaded basin runs on the mixing-air minimum and its dissolved CO2 stays a few mg/L', () => {
    const r = run(100, 500, 2000);
    expect(r.calcs.air.label).toContain('mixing');
    expect(r.calcs.co2.value).toBeLessThan(5);
    expect(r.out.pH).toBeGreaterThan(7.3);
  });
});
