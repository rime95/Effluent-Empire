// Edge cases and graph topology (QA review). Ref: knowledge/README.md §Mass balance
import { unitSideComponents } from '../../src/simulation/treatment/graph';
import { checkMassBalance, components, zeroComponents } from '../../src/simulation/core/massBalance';
import { emptyStream, METALS, cloneStream, tss } from '../../src/simulation/core/stream';
import { setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { solubilityMgL } from '../../src/simulation/chemistry/solubility';
import { neutralise } from '../../src/simulation/chemistry/neutralisation';
import { activatedSludge } from '../../src/simulation/biological/activatedSludge';
import { clarify } from '../../src/simulation/physical/units';
import { CATALOGUE, UnitType, defaultParams } from '../../src/simulation/treatment/catalogue';
import { ProcessGraph, linearGraph, simulate, validateGraph } from '../../src/simulation/treatment/graph';
import { createRng } from '../../src/game/rng';

const food = () => setCbForPH({ ...emptyStream(400), T: 30, SS: 1500, XS: 1200, SI: 80, XI: 250, NH4N: 90, CT: 10e-3, colloid: 80, inert: 40 }, 6.8);

describe('mass balance check', () => {
  it('NaN or Infinity never passes', () => {
    const z = zeroComponents();
    expect(checkMassBalance({ in: { ...z, COD: NaN }, out: z, sludge: z, gas: z, consumed: z, produced: z }).ok).toBe(false);
    expect(checkMassBalance({ in: { ...z, Q: Infinity }, out: z, sludge: z, gas: z, consumed: z, produced: z }).ok).toBe(false);
  });
});

describe('zero flow', () => {
  it('simulate rejects Q = 0 instead of producing NaN', () => {
    const s = emptyStream(0);
    const sim = simulate(linearGraph([{ kind: 'eq', params: defaultParams('eq', 100) }]), s);
    expect(sim.ok).toBe(false);
    expect(sim.errors.map((e) => e.code)).toContain('graph.noFlow');
  });
  it('activated sludge with Q = 0 passes the stream through', () => {
    const r = activatedSludge(emptyStream(0), { volume_m3: 100, srt_d: 10, do_mgL: 2 }, { clarifierFollows: true });
    expect(Number.isFinite(r.out.pH)).toBe(true);
  });
});

describe('activated sludge behaviour', () => {
  it('washout keeps particulate COD (no hydrolysis without biomass) and the balance closes', () => {
    const s = food();
    const r = activatedSludge(s, { volume_m3: 16, srt_d: 0.04, do_mgL: 2 }, { clarifierFollows: false }); // HRT 1 h < SRT_min
    expect(r.notes.some((n) => n.code === 'as.washout')).toBe(true);
    expect(r.out.XS).toBeCloseTo(s.XS, 6);
    const bal = checkMassBalance({ in: components(s), out: components(r.out), sludge: unitSideComponents(r), gas: zeroComponents(), consumed: { ...zeroComponents(), ...r.consumed }, produced: { ...zeroComponents(), ...r.produced } });
    expect(bal.ok).toBe(true);
  });
  it('secondary clarifier: effluent TSS rises with SOR, and a sensible design meets 100 mg/L', () => {
    const s = food();
    const ml = activatedSludge(s, { volume_m3: 1200, srt_d: 10, do_mgL: 2 }, { clarifierFollows: true }).out;
    const effAt = (sorAvg: number) => tss(clarify(ml, { area_m2: s.Q / 24 / sorAvg }).out);
    expect(effAt(0.3)).toBeLessThanOrEqual(effAt(0.6)); // below critical SOR/v_s carry-over is fines-limited
    expect(effAt(0.6)).toBeLessThan(effAt(3.0)); // blanket washout once SOR approaches v_s
    expect(effAt(0.4)).toBeLessThan(100);
  });
  it('nitrifiers are inhibited by copper long before heterotrophs', () => {
    const s = cloneStream(food());
    s.dissolved.Cu = 0.6;
    const r = activatedSludge(s, { volume_m3: 1200, srt_d: 12, do_mgL: 2 }, { clarifierFollows: true });
    expect(r.calcs.inhibN.value).toBeLessThan(r.calcs.inhib.value);
  });
});

describe('graph topology', () => {
  it('flags dangling pipes, outlets on discharge and inlets on influent', () => {
    const g: ProcessGraph = {
      nodes: [
        { id: 'in', kind: 'influent', params: {} },
        { id: 'out', kind: 'discharge', params: {} },
      ],
      edges: [
        { id: 'a', from: 'in', to: 'out' },
        { id: 'b', from: 'out', to: 'in' },
        { id: 'c', from: 'in', to: 'ghost' },
      ],
    };
    const codes = validateGraph(g).map((e) => e.code);
    expect(codes).toContain('graph.dangling');
    expect(codes).toContain('graph.dischargeOutlet');
    expect(codes).toContain('graph.influentInlet');
  });
  it('split → parallel treatment → blend conserves flow and mass', () => {
    const s = setCbForPH({ ...emptyStream(300), CT: 1e-3, dissolved: { Ni: 10, Cu: 5, Zn: 3, Cr: 0 }, colloid: 40, inert: 30, SS: 50, SI: 60 }, 3.5);
    const Q = s.Q / 2;
    const g: ProcessGraph = {
      nodes: [
        { id: 'in', kind: 'influent', params: {} },
        { id: 'p1', kind: 'precipitation', params: { ...defaultParams('precipitation', Q), targetPH: 9.8 } },
        { id: 'p2', kind: 'precipitation', params: { ...defaultParams('precipitation', Q), targetPH: 9.8 } },
        { id: 'cl', kind: 'clarifier', params: defaultParams('clarifier', s.Q) },
        { id: 'out', kind: 'discharge', params: {} },
      ],
      edges: [
        { id: 'e1', from: 'in', to: 'p1' },
        { id: 'e2', from: 'in', to: 'p2' },
        { id: 'e3', from: 'p1', to: 'cl' },
        { id: 'e4', from: 'p2', to: 'cl' },
        { id: 'e5', from: 'cl', to: 'out' },
      ],
    };
    const sim = simulate(g, s);
    expect(sim.ok).toBe(true);
    expect(sim.effluent!.Q).toBeCloseTo(300, 9);
    for (const n of Object.values(sim.nodes)) expect(n.balance.ok).toBe(true);
    expect(sim.balance!.ok).toBe(true);
  });
});

describe('amphoteric metals', () => {
  it('Zn at pH 12.5 re-dissolves to its solubility and the unit warns', () => {
    const s = setCbForPH({ ...emptyStream(100), CT: 0.5e-3, dissolved: { Ni: 0, Cu: 0, Zn: 8, Cr: 0 } }, 3.5);
    const r = neutralise(s, { targetPH: 12.5, base: 'NaOH', volume_m3: 5 });
    expect(r.out.dissolved.Zn).toBeCloseTo(Math.min(8, solubilityMgL('Zn', r.out.pH)), 6);
    expect(r.notes.some((n) => n.code === 'neut.amphoteric')).toBe(true);
  });
});

describe('property test: random parameters and fully populated streams (incl. mixed-liquor context)', () => {
  const rng = createRng(4242);
  const types = Object.keys(CATALOGUE) as UnitType[];
  for (let i = 0; i < 160; i++) {
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
      s.biomass = rng.chance(0.4) ? rng.range(0, 300) : 0;
      s.alSolid = rng.chance(0.3) ? rng.range(0, 20) : 0;
      s.feSolid = rng.chance(0.3) ? rng.range(0, 20) : 0;
      s.floc = rng.range(0, 50);
      s.NH4N = rng.range(0, 150);
      s.NO3N = rng.range(0, 20);
      s.OGfree = rng.range(0, 150);
      s.OGemulsified = rng.range(0, 80);
      s.grit = rng.range(0, 50);
      s.inert = rng.range(0, 100);
      s.colloid = rng.range(0, 200);
      let inS = setCbForPH(s, rng.range(2, 12.5));
      if (inS.biomass > 0 && rng.chance(0.5)) inS = { ...inS, ml: { mlss: rng.range(1500, 6000), srt: rng.range(2, 20), clarifierFollows: true } };
      const params = defaultParams(type, inS.Q);
      for (const d of CATALOGUE[type].params) if (d.min !== undefined && d.max !== undefined && !d.options) params[d.key] = rng.range(d.min, Math.min(d.max, d.min + (d.max - d.min) * 0.3));
      const r = CATALOGUE[type].run(cloneStream(inS), params, { clarifierFollows: rng.chance(0.7) });
      const bal = checkMassBalance({
        in: components(inS),
        out: components(r.out),
        sludge: unitSideComponents(r),
        gas: { ...zeroComponents(), ...r.gas },
        consumed: { ...zeroComponents(), ...r.consumed },
        produced: { ...zeroComponents(), ...r.produced },
      });
      expect(bal.ok, JSON.stringify(bal.errors)).toBe(true);
      for (const c of Object.values(r.calcs)) expect(Number.isFinite(c.value) || c.value === Infinity, c.label).toBe(true);
    });
  }
});

// Regulation 11(2), P.U.(A) 434/2009 — knowledge/regulations/malaysia_environmental_quality.md
import { evaluate, combinedMetalsApply } from '../../src/simulation/treatment/compliance';
describe('combined metals rule (Reg. 11(2))', () => {
  const eff = (Ni: number, Cu: number, Zn: number, dissolvedFrac = 1) => {
    const s = setCbForPH({ ...emptyStream(100), CT: 2e-3 }, 7.5);
    s.dissolved = { Ni: Ni * dissolvedFrac, Cu: Cu * dissolvedFrac, Zn: Zn * dissolvedFrac, Cr: 0 };
    s.precipitated = { Ni: Ni * (1 - dissolvedFrac), Cu: Cu * (1 - dissolvedFrac), Zn: Zn * (1 - dissolvedFrac), Cr: 0 };
    return s;
  };
  it('does not apply with a single metal', () => {
    expect(combinedMetalsApply(eff(0.8, 0, 0))).toBe(false);
    expect(evaluate(eff(0.8, 0, 0), 'B').checks.some((c) => c.param === 'MetalsTotal')).toBe(false);
  });
  it('Standard A: each metal within its own limit but the sum > 0.5 fails', () => {
    const r = evaluate(eff(0.18, 0.18, 0.18, 0), 'A');
    expect(r.checks.find((c) => c.param === 'Ni')!.pass).toBe(true);
    expect(r.checks.find((c) => c.param === 'MetalsTotal')!.pass).toBe(false);
  });
  it('Standard B: soluble sum > 1.0 fails even when the total is < 3.0', () => {
    const r = evaluate(eff(0.6, 0.6, 0.3, 1), 'B');
    expect(r.checks.find((c) => c.param === 'MetalsTotal')!.pass).toBe(true);
    expect(r.checks.find((c) => c.param === 'MetalsSoluble')!.pass).toBe(false);
  });
});
