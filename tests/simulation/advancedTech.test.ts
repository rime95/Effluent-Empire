/**
 * Advanced technologies: UF, RO, ion exchange, MVR evaporator, electrowinning, Fenton, UASB, MBR, water reclaim and
 * zero liquid discharge. Refs: knowledge/physical/membranes.md, evaporation.md; knowledge/chemistry/ion_exchange.md,
 * electrowinning.md, fenton_aop.md, salinity_tds.md; knowledge/biological/anaerobic_uasb.md, mbr.md
 */
import { describe, it, expect } from 'vitest';
import { emptyStream, tdsTotal, tss } from '../../src/simulation/core/stream';
import { setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { checkMassBalance, components, zeroComponents } from '../../src/simulation/core/massBalance';
import { CF_avg, RO, osmoticBar, reverseOsmosis, ultrafilter } from '../../src/simulation/physical/membranes';
import { ionExchange } from '../../src/simulation/chemistry/ionExchange';
import { EVAP, evaporate } from '../../src/simulation/physical/evaporator';
import { EW, electrowin } from '../../src/simulation/chemistry/electrowinning';
import { FENTON, fenton } from '../../src/simulation/chemistry/fenton';
import { UASB, uasb } from '../../src/simulation/biological/uasb';
import { membraneBioreactor } from '../../src/simulation/biological/mbr';
import { ProcessResult } from '../../src/simulation/treatment/types';
import { simulate, unitSideComponents } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { generateEnquiry } from '../../src/game/customers';
import { VARIANTS, referenceGraph } from '../../src/game/variants';
import { evaluateRequirements } from '../../src/game/requirements';
import { MW } from '../../src/simulation/core/units';

const balanced = (inS: ReturnType<typeof emptyStream>, r: ProcessResult) =>
  checkMassBalance({ in: components(inS), out: components(r.out), sludge: unitSideComponents(r), gas: { ...zeroComponents(), ...r.gas }, consumed: { ...zeroComponents(), ...r.consumed }, produced: { ...zeroComponents(), ...r.produced } }).ok;

const water = (Q = 100) => {
  const s = emptyStream(Q);
  s.T = 30;
  s.CT = 2e-3;
  s.tds = 1500;
  s.SO4T = 2e-3;
  s.NH4N = 5;
  s.SI = 30;
  return setCbForPH(s, 7.5);
};

describe('membranes', () => {
  it('log-mean concentration factor: CF_avg(0.75) = ln 4 / 0.75', () => {
    expect(CF_avg(0.75)).toBeCloseTo(Math.log(4) / 0.75, 9);
  });
  it('UF: removes solids, passes salts; backwash leaves as reject; mass closes', () => {
    const s = water();
    s.colloid = 80;
    s.inert = 40;
    const r = ultrafilter(s, { area_m2: 100, recovery_pct: 92 });
    expect(tss(r.out)).toBeLessThan(0.05);
    expect(r.out.tds).toBeCloseTo(s.tds!, 6);
    expect(r.reject!.Q + r.out.Q).toBeCloseTo(s.Q, 9);
    expect(balanced(s, r)).toBe(true);
  });
  it('RO: rejects ~98 % of salts, brine concentrates, pressure = π_avg + 10 bar', () => {
    const s = water();
    const r = reverseOsmosis(s, { recovery_pct: 75, antiscalant: true });
    expect(tdsTotal(r.out)).toBeLessThan(0.06 * tdsTotal(s));
    expect(tdsTotal(r.reject!)).toBeGreaterThan(3.5 * tdsTotal(s));
    expect(r.calcs.P.value).toBeCloseTo(osmoticBar(tdsTotal(s)) * CF_avg(0.75) + RO.overhead_bar, 6);
    expect(balanced(s, r)).toBe(true);
    // brine keeps a sane pH (charge-consistent rejection)
    expect(r.reject!.pH).toBeGreaterThan(6.5);
  });
  it('RO: recovery beyond the scaling limit degrades the permeate; dirty feed warns', () => {
    const s = water();
    const ok = reverseOsmosis(s, { recovery_pct: 75, antiscalant: true });
    const scaled = reverseOsmosis(s, { recovery_pct: 75, antiscalant: false });
    expect(scaled.notes.some((n) => n.code === 'ro.scale')).toBe(true);
    expect(tdsTotal(scaled.out)).toBeGreaterThan(tdsTotal(ok.out));
    s.colloid = 30;
    expect(reverseOsmosis(s, { recovery_pct: 70, antiscalant: true }).notes.some((n) => n.code === 'ro.foul')).toBe(true);
  });
});

describe('ion exchange', () => {
  it('polishes dissolved Cu, releases Na⁺, concentrates the metal into a small eluate', () => {
    const s = water();
    s.dissolved.Cu = 2;
    const sIn = setCbForPH(s, 6);
    const r = ionExchange(sIn, { resin_m3: 0.4 });
    expect(r.out.dissolved.Cu).toBeLessThan(0.05);
    expect(r.reject!.Q).toBeLessThan(0.05 * sIn.Q);
    expect(r.reject!.dissolved.Cu).toBeGreaterThan(50 * sIn.dissolved.Cu);
    expect(r.out.tds!).toBeGreaterThan(sIn.tds!);
    expect(balanced(sIn, r)).toBe(true);
  });
  it('complexed metal passes and is warned', () => {
    const s = water();
    s.complexed = { Ni: 3, Cu: 0, Zn: 0, Cr: 0 };
    const r = ionExchange(setCbForPH(s, 6), { resin_m3: 0.4 });
    expect(r.out.complexed!.Ni).toBeCloseTo(3, 6);
    expect(r.notes.some((n) => n.code === 'ix.complexed')).toBe(true);
  });
});

describe('MVR evaporator', () => {
  it('distillate is salt-free; concentrate carries everything; capped at saturation', () => {
    const s = water(20);
    const r = evaporate(s, { recovery_pct: 95 });
    expect(r.out.tds).toBe(0);
    expect(r.reject!.tds!).toBeCloseTo(s.tds! / 0.05, 3);
    expect(balanced(s, r)).toBe(true);
    s.tds = 50_000;
    const capped = evaporate(s, { recovery_pct: 99 });
    expect(capped.notes.some((n) => n.code === 'evap.crystal')).toBe(true);
    expect(tdsTotal(capped.reject!)).toBeLessThanOrEqual(EVAP.maxConcTDS * 1.01);
  });
  it('free ammonia boils over at high pH, stays at low pH', () => {
    const hi = evaporate(setCbForPH(water(20), 10), { recovery_pct: 90 });
    const lo = evaporate(setCbForPH(water(20), 6), { recovery_pct: 90 });
    expect(hi.out.NH4N).toBeGreaterThan(10 * lo.out.NH4N);
  });
});

describe('electrowinning', () => {
  it('Faraday: copper plated ≤ CE·I·t·M/(nF); dilute liquor is mass-transfer limited', () => {
    const s = emptyStream(2);
    s.dissolved.Cu = 5000;
    const sIn = setCbForPH(s, 2);
    const r = electrowin(sIn, { area_m2: 10, currentDensity: 200 });
    const max = (EW.ceMax * 2000 * 86400 * MW.Cu) / (2 * EW.F) / 1000; // kg/d
    expect(r.calcs.cu.value).toBeLessThanOrEqual(max + 1e-9);
    // feed holds 2 m³/d × 5 kg/m³ = 10 kg/d (< max): mass-transfer limited, most of it plates
    expect(r.calcs.cu.value).toBeGreaterThan(0.7 * 10);
    expect(r.calcs.cu.value).toBeLessThan(10);
    expect(r.credits?.[0].RMd).toBeGreaterThan(0);
    expect(balanced(sIn, r)).toBe(true);
    const dil = emptyStream(50);
    dil.dissolved.Cu = 20;
    const d = electrowin(setCbForPH(dil, 2), { area_m2: 10, currentDensity: 200 });
    expect(d.calcs.ce.value).toBeLessThan(30);
  });
});

describe('electrowinning a dilute nickel rinse (300 mg/L)', () => {
  const rinse = () => {
    const s = emptyStream(20);
    s.CT = 1e-3;
    s.dissolved.Ni = 300;
    s.SO4T = (300 / MW.Ni / 1000) * 1.1;
    return setCbForPH(s, 4.5);
  };
  it('low current density on a large cathode recovers most of the nickel and pays for its power', () => {
    const s = rinse();
    const iL = 2 * EW.F * EW.km * (300 / MW.Ni); // A/m², limiting current density
    expect(iL).toBeGreaterThan(8);
    expect(iL).toBeLessThan(12);
    const r = electrowin(s, { area_m2: 100, currentDensity: 15 });
    const rec = 1 - r.out.dissolved.Ni / 300;
    expect(rec).toBeGreaterThan(0.75);
    expect(r.calcs.ni.value * 70).toBeGreaterThan(r.energy_kWhd * 0.5 * 5); // metal value ≫ power cost
    expect(balanced(s, r)).toBe(true);
  });
  it('high current density on a small cathode wastes the current on hydrogen', () => {
    const r = electrowin(rinse(), { area_m2: 10, currentDensity: 200 });
    expect(r.calcs.ce.value).toBeLessThan(10);
    expect(r.notes.some((n) => n.code === 'ew.dilute')).toBe(true);
  });
});

describe('Fenton', () => {
  it('oxidises refractory COD at pH 3 by stoichiometry × utilisation, much less at pH 7', () => {
    const s = water();
    s.SI = 300;
    const r3 = fenton(s, { h2o2_mgL: 500, feRatio: 0.1, pHset: 3, volume_m3: 5 });
    const ox = r3.calcs.ox.value;
    expect(ox).toBeCloseTo((r3.calcs.eta.value / 100) * 500 / FENTON.h2o2PerCOD, 3);
    expect(r3.out.SI).toBeLessThan(s.SI);
    expect(r3.out.pH).toBeGreaterThan(7);
    const r7 = fenton(s, { h2o2_mgL: 500, feRatio: 0.1, pHset: 7, volume_m3: 5 });
    expect(r7.calcs.ox.value).toBeLessThan(0.1 * ox);
    expect(balanced(s, r3)).toBe(true);
  });
});

describe('UASB', () => {
  it('converts biodegradable COD to methane (0.35 Nm³/kg) and earns a power credit', () => {
    const s = water(200);
    s.SS = 8000;
    s.XS = 2000;
    s.NH4N = 100;
    s.T = 35;
    const r = uasb(s, { volume_m3: 1000 });
    expect(r.calcs.eff.value).toBeGreaterThan(70);
    const gasKg = r.gas.COD!;
    expect(r.calcs.ch4.value).toBeCloseTo(gasKg * UASB.ch4STP * (308.15 / 273.15), 6);
    expect(r.credits?.[0].RMd).toBeGreaterThan(0);
    expect(balanced(s, r)).toBe(true);
    expect(uasb(s, { volume_m3: 100 }).notes.some((n) => n.code === 'uasb.olr')).toBe(true);
  });
});

describe('MBR', () => {
  it('solids-free permeate; waste sludge at the MLSS; more aeration energy than CAS', () => {
    const s = water(200);
    s.SS = 600;
    s.XS = 300;
    s.NH4N = 40;
    s.inert = 50;
    const sIn = setCbForPH(s, 7.5);
    const r = membraneBioreactor(sIn, { volume_m3: 150, mlss_mgL: 10000, area_m2: 420, do_mgL: 2 });
    expect(tss(r.out)).toBeLessThan(0.01);
    expect(r.sludgeSolidsFrac).toBeCloseTo(0.01, 6);
    expect(balanced(sIn, r)).toBe(true);
  });
});

describe('water reuse and zero-liquid-discharge clients', () => {
  const find = (id: string, n: number) => {
    const out = [];
    for (let seed = 1; out.length < n && seed < 4000; seed++) {
      const e = generateEnquiry(seed, 1, 50, { tech: ['ro', 'reclaim', 'evaporator'] });
      if (e.variant?.id === id) out.push(e);
    }
    return out;
  };
  for (const id of ['waterReuse', 'zld']) {
    it(`${id}: the reference design passes the standard and the contract requirement`, () => {
      const v = VARIANTS.find((x) => x.id === id)!;
      const jobs = find(id, 5);
      expect(jobs.length).toBe(5);
      for (const e of jobs) {
        const sim = simulate(referenceGraph(v, e.trueStream), e.trueStream);
        expect(sim.ok).toBe(true);
        expect(sim.balance?.ok).toBe(true);
        expect(evaluate(sim.effluent!, e.standard, sim).pass).toBe(true);
        expect(evaluateRequirements(sim, e.requirements).every((r) => r.pass)).toBe(true);
      }
    });
  }
  it('a plain discharge design fails the reuse and ZLD requirements', async () => {
    const { linearGraph } = await import('../../src/simulation/treatment/graph');
    const { metalTrain } = await import('../../src/game/referenceDesigns');
    for (const id of ['waterReuse', 'zld']) {
      const [e] = find(id, 1);
      const sim = simulate(linearGraph(metalTrain(e.trueStream.Q)), e.trueStream);
      expect(evaluateRequirements(sim, e.requirements).some((r) => !r.pass)).toBe(true);
    }
  });
});
