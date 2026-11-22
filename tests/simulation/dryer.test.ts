/** Thermal sludge dryer and the disposal-cost-cap client. Ref: knowledge/physical/sludge_drying.md */
import { describe, it, expect } from 'vitest';
import { DRYER, dry, drySolidsKgD, heatPerKgWater_kWh } from '../../src/simulation/physical/dryer';
import { emptyStream } from '../../src/simulation/core/stream';
import { generateEnquiry } from '../../src/game/customers';
import { simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { VARIANTS, referenceGraph } from '../../src/game/variants';
import { evaluateRequirements } from '../../src/game/requirements';
import { commission, newProject } from '../../src/game/project';

/** 1 m³/d of press cake at 25 % DS (250 kg dry solids as metal hydroxide). */
const cake = () => {
  const s = emptyStream(1);
  s.T = 30;
  s.precipitated = { Ni: 100_000, Cu: 0, Zn: 0, Cr: 0 };
  s.feSolid = 0;
  s.inert = 250_000 - 100_000 * (92.7 / 58.7);
  return s;
};

describe('dryer mass and heat balance', () => {
  it('heat per kg water: (2.257 + 4.19e-3·70) MJ ÷ 3.6 ÷ 0.75 ≈ 0.94 kWh_th', () => {
    expect(heatPerKgWater_kWh(30)).toBeCloseTo((2.257 + 0.00419 * 70) / 3.6 / 0.75, 6);
    expect(heatPerKgWater_kWh(30)).toBeGreaterThan(0.8);
    expect(heatPerKgWater_kWh(30)).toBeLessThan(1.0);
  });

  it('25 % → 80 % DS: evaporates feed − D/0.8 of water, LPG = heat ÷ 12.8 kWh/kg', () => {
    const s = cake();
    const D = drySolidsKgD(s);
    expect(D).toBeCloseTo(250, 0);
    const r = dry(s, { targetDS_pct: 80 });
    const W = 1000 - D / 0.8;
    expect(r.calcs.evap.value).toBeCloseTo(W, 6);
    expect(r.chemicals[0].kgPerDay).toBeCloseTo((W * heatPerKgWater_kWh(30)) / DRYER.lpgKWhPerKg, 6);
    expect(r.sludgeSolidsFrac).toBeCloseTo(0.8, 6);
    expect(r.calcs.cut.value).toBeCloseTo(100 * (1 - D / 0.8 / 1000), 6); // ≈ 69 % fewer wet tonnes
  });

  it('warns on thin feed and on over-drying; nothing to do when the feed is already drier than the target', () => {
    const thin = cake();
    thin.Q = 5; // same solids spread over 5 m³ → ~5 % DS (concentrations unchanged ⇒ scale them down)
    thin.inert /= 5;
    thin.precipitated = { Ni: 20_000, Cu: 0, Zn: 0, Cr: 0 };
    expect(dry(thin, { targetDS_pct: 80 }).notes.some((n) => n.code === 'dryer.thin')).toBe(true);
    expect(dry(cake(), { targetDS_pct: 95 }).notes.some((n) => n.code === 'dryer.dust')).toBe(true);
    const dense = cake();
    dense.inert += 300_000; // ≈ 55 % DS granulate
    expect(dry(dense, { targetDS_pct: 50 }).calcs.evap.value).toBe(0);
  });
});

describe('disposal-cost-cap client (dryer variant)', () => {
  const find = (n: number) => {
    const out = [];
    for (let seed = 1; out.length < n && seed < 3000; seed++) {
      const e = generateEnquiry(seed, 1, 30, { tech: ['dryer'] });
      if (e.variant?.id === 'sludgeCap') out.push(e);
    }
    return out;
  };
  const v = VARIANTS.find((x) => x.id === 'sludgeCap')!;

  it('only appears once the dryer is researched, and carries a disposal-cost cap', () => {
    for (let seed = 1; seed < 200; seed++) expect(generateEnquiry(seed, 1, 30, { tech: [] }).variant?.id).not.toBe('sludgeCap');
    const [e] = find(1);
    expect(e.requirements?.sludgeCapRMd).toBeGreaterThan(0);
  });

  it('the dryer reference design meets the standard and the cap; the same plant without the dryer breaks the cap', () => {
    for (const e of find(5)) {
      const g = referenceGraph(v, e.trueStream);
      const sim = simulate(g, e.trueStream);
      expect(sim.balance?.ok).toBe(true);
      expect(evaluate(sim.effluent!, e.standard, sim).pass).toBe(true);
      expect(evaluateRequirements(sim, e.requirements).every((r) => r.pass)).toBe(true);
      const noDryer = { nodes: g.nodes.filter((n) => n.kind !== 'dryer'), edges: [...g.edges.filter((x) => x.from !== 's2' && x.to !== 's2'), { id: 'x', from: 's1', to: 'sd', fromPort: 'sludge' as const }] };
      const sim2 = simulate(noDryer, e.trueStream);
      expect(evaluateRequirements(sim2, e.requirements).every((r) => r.pass)).toBe(false);
    }
  });

  it('a failed contract requirement fails commissioning even when the effluent passes', () => {
    const [e] = find(1);
    const g = referenceGraph(v, e.trueStream);
    const noDryer = { nodes: g.nodes.filter((n) => n.kind !== 'dryer'), edges: [...g.edges.filter((x) => x.from !== 's2' && x.to !== 's2'), { id: 'x', from: 's1', to: 'sd', fromPort: 'sludge' as const }] };
    const p = { ...newProject(e, 1), graph: noDryer };
    const rep = commission(p, 5);
    expect(rep.compliance.pass).toBe(true);
    expect(rep.requirements?.some((r) => !r.pass)).toBe(true);
    expect(rep.pass).toBe(false);
  });
});
