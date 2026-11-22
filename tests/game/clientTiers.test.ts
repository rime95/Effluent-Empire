/**
 * Client tiers (medium = large local companies, MNC = multinationals). Ref: knowledge/processes/client_tiers.md
 */
import { describe, it, expect } from 'vitest';
import { eligibleTiers, generateEnquiry, tierDesign } from '../../src/game/customers';
import { REAL_CLIENTS, brandText, fictionalAlias } from '../../src/game/realClients';
import { GENERIC_NAMES } from '../../src/game/clientNames';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { evaluateRequirements } from '../../src/game/requirements';
import type { TechId } from '../../src/game/tech';

const ALL: TechId[] = ['daf', 'dryer', 'uf', 'sulfide', 'ionExchange', 'uasb', 'ro', 'reclaim', 'electrowinning', 'aop', 'mbr', 'evaporator'];

describe('client tiers', () => {
  it('eligibility: medium at reputation 25, MNC at 50 with the reclaim system', () => {
    expect(eligibleTiers(10, ALL)).toEqual([]);
    expect(eligibleTiers(30, ALL)).toEqual(['medium']);
    expect(eligibleTiers(60, [])).toEqual(['medium']);
    expect(eligibleTiers(60, ['reclaim'])).toEqual(['medium', 'mnc']);
  });

  it('legacy generation (no tech option) never produces a tier client', () => {
    for (let seed = 1; seed < 200; seed++) expect(generateEnquiry(seed, 1, 90).tier).toBeUndefined();
  });

  it('a tier draw leaves the base wastewater of the seed unchanged', () => {
    for (let seed = 1; seed < 120; seed++) {
      const base = generateEnquiry(seed, 1, 60);
      const t = generateEnquiry(seed, 1, 60, { tech: ['reclaim'] });
      if (!t.tier) continue;
      expect(t.trueStream.Q).toBeCloseTo(base.trueStream.Q, 9);
      expect(t.industry).toBe(base.industry);
    }
  });

  it('tier clients carry real names from the tier list, standby and (MNC) reuse/ZLD requirements', () => {
    let med = 0, mnc = 0;
    for (let seed = 1; seed < 400 && (med < 5 || mnc < 5); seed++) {
      const e = generateEnquiry(seed, 1, 60, { tech: ALL });
      if (!e.tier) continue;
      expect(REAL_CLIENTS[e.tier as "medium" | "mnc"][e.industry]).toContain(e.company);
      expect(e.requirements?.standby).toBe(true);
      if (e.tier === 'mnc') {
        mnc++;
        expect(Boolean(e.requirements?.reuseMin) || Boolean(e.requirements?.zld)).toBe(true);
      } else med++;
    }
    expect(med).toBeGreaterThanOrEqual(5);
    expect(mnc).toBeGreaterThanOrEqual(5);
  });

  for (const industry of ['plating', 'food', 'semiconductor'] as const)
    it(`${industry}: tier contracts are set from a reference design that meets them (most MNC feeds keep a reuse/ZLD target)`, () => {
      let mncKept = 0;
      for (let seed = 1; seed <= 8; seed++)
        for (const tier of ['medium', 'mnc'] as const) {
          const e = generateEnquiry(seed, 1, 60, { tech: ALL, force: { tier, industry } });
          const d = tierDesign(tier, industry, e.trueStream, ALL, seed);
          expect(e.tier).toBe(d.tier);
          expect(e.requirements).toEqual(d.requirements);
          if (tier === 'mnc' && d.tier === 'mnc') mncKept++;
          // re-simulate independently
          const sim = simulate(d.graph, e.trueStream);
          expect(sim.ok).toBe(true);
          expect(sim.balance?.ok).toBe(true);
          if (!d.standard) continue; // feed beyond every reference design: drawn standard kept (as basic jobs)
          expect(e.standard).toBe(d.standard);
          expect(evaluate(sim.effluent!, e.standard, sim).pass).toBe(true);
          expect(evaluateRequirements(sim, e.requirements).filter((r) => !r.pass).map((r) => r.why)).toEqual([]);
        }
      expect(mncKept).toBeGreaterThanOrEqual(5);
    });

  it('the same design without standby fails the standby requirement', () => {
    const e = generateEnquiry(3, 1, 60, { tech: ALL, force: { tier: 'medium', industry: 'plating' } });
    const sim = simulate(linearGraph(REFERENCE.plating(e.trueStream)), e.trueStream);
    expect(evaluateRequirements(sim, e.requirements).find((r) => r.id === 'standby')?.pass).toBe(false);
  });

  it('fictional-names setting: every real name has a unique alias that is not a generic name', () => {
    const all = Object.values(REAL_CLIENTS).flatMap((byInd) => Object.values(byInd).flat());
    const aliases = all.map(fictionalAlias);
    expect(new Set(aliases).size).toBe(all.length);
    const generic = new Set(Object.values(GENERIC_NAMES).flat());
    for (const a of aliases) {
      expect(all).not.toContain(a);
      expect(generic.has(a)).toBe(false);
    }
    const n = all[0];
    expect(brandText(`Advance payment (30 %): ${n} (second site)`, true)).toBe(`Advance payment (30 %): ${fictionalAlias(n)} (second site)`);
    expect(brandText(`Contract with ${n}`, false)).toBe(`Contract with ${n}`);
  });
});
