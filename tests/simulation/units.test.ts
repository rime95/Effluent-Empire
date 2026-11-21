// Reference calculations: knowledge/design/design_parameters.md, knowledge/physical/sedimentation.md,
// knowledge/chemistry/coagulation_flocculation.md, knowledge/biological/activated_sludge.md
import { hrtDays, kgPerDay, mgPerL, surfaceOverflowRate_mh, mgL_to_molL, molL_to_mgL, MW, tempCorrect } from '../../src/simulation/core/units';
import { emptyStream, cloneStream, METALS } from '../../src/simulation/core/stream';
import { hazenRemoval, normalCdf, stokesVelocity_mh, waterViscosity } from '../../src/simulation/physical/settling';
import { coagulate, destabilisation, COAGULANTS } from '../../src/simulation/chemistry/coagulation';
import { alkalinityFiltered as alkalinity, setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { activatedSludge, solveBiology } from '../../src/simulation/biological/activatedSludge';
import { CATALOGUE, UnitType, defaultParams } from '../../src/simulation/treatment/catalogue';
import { checkMassBalance, components, zeroComponents } from '../../src/simulation/core/massBalance';
import { createRng } from '../../src/game/rng';

describe('hydraulics and dosing (knowledge/design/design_parameters.md, chemistry/chemical_dosing.md)', () => {
  it('HRT: V 500 m³, Q 250 m³/d → 2 d', () => expect(hrtDays(500, 250)).toBe(2));
  it('dose: Q 250 m³/d × 100 mg/L → 25 kg/d', () => expect(kgPerDay(250, 100)).toBe(25));
  it('SOR: Q 480 m³/d over 20 m² → 1.0 m/h', () => expect(surfaceOverflowRate_mh(480, 20)).toBeCloseTo(1.0, 10));
  it('conversion round-trips', () => {
    expect(mgPerL(kgPerDay(333, 47.2), 333)).toBeCloseTo(47.2, 10);
    expect(molL_to_mgL(mgL_to_molL(12, MW.Ni), MW.Ni)).toBeCloseTo(12, 10);
  });
  it('temperature correction: θ = 1.07, 10 °C above 20 → ×1.967', () => expect(tempCorrect(1, 1.07, 30)).toBeCloseTo(1.9672, 3));
});

describe('settling (knowledge/physical/sedimentation.md)', () => {
  it('Φ(0)=0.5, Φ(1.96)≈0.975', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it('Hazen removal: monotonic in SOR, → 1 at low SOR, → 0 at very high SOR', () => {
    expect(hazenRemoval(2, 0.01)).toBeGreaterThan(0.999);
    expect(hazenRemoval(2, 1000)).toBeLessThan(0.01);
    expect(hazenRemoval(2, 1)).toBeGreaterThan(hazenRemoval(2, 2));
  });
  it('narrow distribution: removal = v/SOR when SOR > v (ideal basin), complete when SOR < v', () => {
    expect(hazenRemoval(1, 2, 0.01)).toBeCloseTo(0.5, 2);
    expect(hazenRemoval(1, 4, 0.01)).toBeCloseTo(0.25, 2);
    expect(hazenRemoval(1, 0.5, 0.01)).toBeCloseTo(1, 4);
  });
  it('water viscosity 25 °C ≈ 0.89 mPa·s', () => expect(waterViscosity(25) * 1000).toBeCloseTo(0.89, 2));
  it('Stokes: 100 µm oil droplet (ρ 900) rises ≈ 2.2 m/h at 25 °C', () => {
    const v = -stokesVelocity_mh(100e-6, 900, 25);
    expect(v).toBeGreaterThan(2.0);
    expect(v).toBeLessThan(2.4);
  });
});

describe('coagulation (knowledge/chemistry/coagulation_flocculation.md)', () => {
  const water = () => setCbForPH({ ...emptyStream(1000), CT: 4e-3, colloid: 80 }, 7.2);
  it('alum consumes ≈ 0.50 mg CaCO3 alkalinity per mg alum', () => {
    const s = water();
    const r = coagulate(s, { coagulant: 'alum', dose_mgL: 100, flocTime_min: 20 });
    expect(r.calcs.alk.value / 100).toBeCloseTo(0.505, 2);
    expect(alkalinity(s) - alkalinity(r.out)).toBeCloseTo(50.5, 0);
  });
  it('ferric chloride consumes ≈ 0.925 mg CaCO3 per mg FeCl3', () => {
    const r = coagulate(water(), { coagulant: 'ferric', dose_mgL: 100, flocTime_min: 20 });
    expect(r.calcs.alk.value / 100).toBeCloseTo(0.925, 2);
  });
  it('alum produces 0.262 mg Al(OH)3 per mg alum (as Al: 0.0908)', () => {
    const s = water();
    const r = coagulate(s, { coagulant: 'alum', dose_mgL: 100, flocTime_min: 20 });
    expect(r.out.alSolid + r.out.alDissolved).toBeCloseTo((100 / MW.alum) * 2 * MW.Al, 6);
    expect(r.out.alDissolved).toBeLessThan(0.2); // near the Al(OH)3 solubility minimum
  });
  it('under-dose and over-dose both perform worse than the optimum', () => {
    expect(destabilisation(1, 1)).toBeGreaterThan(destabilisation(0.3, 1));
    expect(destabilisation(1, 1)).toBeGreaterThan(destabilisation(2.2, 1));
    expect(destabilisation(6, 1)).toBeGreaterThan(destabilisation(2.2, 1)); // sweep floc recovers
  });
  it('every coagulant has a sensible pH window', () => {
    for (const c of Object.values(COAGULANTS)) expect(c.pHmax).toBeGreaterThan(c.pHmin);
  });
});

describe('activated sludge (knowledge/biological/activated_sludge.md worked example)', () => {
  // 20 °C, SRT 10 d, DO 2 mg/L, S0 = 300 mg bCOD/L, no inhibition
  const s = setCbForPH({ ...emptyStream(1000), T: 20, SS: 300, NH4N: 40, CT: 5e-3 }, 7.2);
  const bio = solveBiology(s, { volume_m3: 250, srt_d: 10, do_mgL: 2 }, 10, 1);
  it('effluent S = Ks(1+bθ)/(θ(μ−b)−1) = 0.336 mg/L', () => expect(bio.S).toBeCloseTo(0.3362, 3));
  it('PxH = Y(S0−S)/(1+bθ) = 61.29 mg VSS/L', () => expect(bio.PxH).toBeCloseTo(61.29, 1));
  it('cell debris = fd·b·PxH·θ = 11.03 mg VSS/L', () => expect(bio.Pxd).toBeCloseTo(11.03, 1));
  it('washout below minimum SRT (1/(μ−b) = 0.19 d)', () => expect(solveBiology(s, { volume_m3: 250, srt_d: 0.15, do_mgL: 2 }, 0.15, 1).washout).toBe(true));
  it('warmer water lowers effluent S', () => {
    const warm = solveBiology({ ...s, T: 30 }, { volume_m3: 250, srt_d: 10, do_mgL: 2 }, 10, 1);
    expect(warm.S).toBeLessThan(bio.S);
  });
  it('nitrification at long SRT consumes alkalinity and lowers pH', () => {
    const r = activatedSludge(s, { volume_m3: 250, srt_d: 15, do_mgL: 2 }, { clarifierFollows: true });
    expect(r.calcs.nitrified.value).toBeGreaterThan(20);
    expect(alkalinity(r.out)).toBeLessThan(alkalinity(s));
  });
  it('no clarifier → SRT forced to HRT', () => {
    const r = activatedSludge(s, { volume_m3: 250, srt_d: 15, do_mgL: 2 }, { clarifierFollows: false });
    expect(r.calcs.srt.value).toBeCloseTo(0.25, 6);
  });
});

describe('mass balance closes for every unit on random streams (property test)', () => {
  const rng = createRng(42);
  const types = Object.keys(CATALOGUE) as UnitType[];
  for (let i = 0; i < 40; i++) {
    const type = types[i % types.length];
    it(`${type} #${i}`, () => {
      const s = emptyStream(rng.range(20, 2000));
      s.T = rng.range(15, 35);
      s.peakFactor = rng.range(1, 3);
      s.CT = rng.range(0, 10) / 1000;
      s.weakAcidT = rng.range(0, 5) / 1000;
      for (const m of METALS) s.dissolved[m] = rng.chance(0.5) ? rng.range(0, 30) : 0;
      s.SS = rng.range(0, 3000);
      s.SI = rng.range(0, 200);
      s.XS = rng.range(0, 1500);
      s.XI = rng.range(0, 400);
      s.NH4N = rng.range(0, 150);
      s.OGfree = rng.range(0, 150);
      s.OGemulsified = rng.range(0, 80);
      s.grit = rng.range(0, 50);
      s.inert = rng.range(0, 100);
      s.colloid = rng.range(0, 200);
      const inS = setCbForPH(s, rng.range(2.5, 10));
      const params = defaultParams(type, inS.Q);
      const r = CATALOGUE[type].run(cloneStream(inS), params, { clarifierFollows: rng.chance(0.7) });
      const bal = checkMassBalance({
        in: components(inS),
        out: components(r.out),
        sludge: r.removed ? components(r.removed, false) : zeroComponents(),
        gas: { ...zeroComponents(), ...r.gas },
        consumed: { ...zeroComponents(), ...r.consumed },
        produced: { ...zeroComponents(), ...r.produced },
      });
      expect(bal.ok, JSON.stringify(bal.errors)).toBe(true);
    });
  }
});
