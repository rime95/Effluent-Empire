import { describe, expect, it } from 'vitest';
import { TIERS, eligibleTiers, generateEnquiry, tierDesign } from '../../src/game/customers';
import { cakeWet_kgd, evaluateRequirements, metalRecovered_kgd } from '../../src/game/requirements';
import { TECH_ORDER } from '../../src/game/tech';
import { simulate } from '../../src/simulation/treatment/graph';

// Ref: knowledge/processes/client_tiers.md ("Integrated megaproject")
describe('integrated megaproject (final boss tier)', () => {
  it('opens only at high reputation with every technology it needs', () => {
    expect(eligibleTiers(90, TECH_ORDER)).toContain('mega');
    expect(eligibleTiers(TIERS.mega.reputation - 1, TECH_ORDER)).not.toContain('mega');
    expect(eligibleTiers(90, TECH_ORDER.filter((t) => t !== 'electrowinning'))).not.toContain('mega');
  });

  for (const seed of [1, 4, 8]) {
    it(`seed ${seed}: three segregated drains, all terms set, and the reference design passes them`, () => {
      const e = generateEnquiry(seed, 0, 90, { tech: TECH_ORDER, force: { tier: 'mega' } });
      expect(e.tier).toBe('mega');
      expect(e.industry).toBe('plating');
      expect(e.trueStream.side?.map((s) => s.id).sort()).toEqual(['cr', 'en', 'ni']);
      const r = e.requirements!;
      expect(r.zld && r.standby).toBe(true);
      expect(r.cakeWetMax_kgd).toBeGreaterThan(0);
      expect(r.metalRecoveryMin_kgd).toBeGreaterThan(0);
      const d = tierDesign('mega', 'plating', e.trueStream, TECH_ORDER, seed);
      expect(d.ref.ok).toBe(true);
      expect(evaluateRequirements(d.ref, r).every((c) => c.pass)).toBe(true);
      expect(metalRecovered_kgd(d.ref)).toBeGreaterThanOrEqual(r.metalRecoveryMin_kgd!);
    });
  }

  it('needs every unit: no dryer breaks the cake cap, no electrowinning breaks the recovery target', () => {
    const e = generateEnquiry(2, 0, 90, { tech: TECH_ORDER, force: { tier: 'mega' } });
    const d = tierDesign('mega', 'plating', e.trueStream, TECH_ORDER, 2);
    // bypass the dryer: press cake straight to disposal
    const g1 = structuredClone(d.graph);
    const dr = g1.nodes.find((n) => n.kind === 'dryer')!;
    const press = g1.nodes.find((n) => n.kind === 'filterPress')!;
    g1.edges = g1.edges.filter((x) => x.from !== dr.id && x.to !== dr.id);
    g1.nodes = g1.nodes.filter((n) => n.id !== dr.id);
    g1.edges.push({ id: 'bypass', from: press.id, to: 'sd', fromPort: 'sludge' });
    const r1 = simulate(g1, e.trueStream);
    expect(cakeWet_kgd(r1)).toBeGreaterThan(e.requirements!.cakeWetMax_kgd!);
    // bypass electrowinning: nickel rinse straight to EQ
    const g2 = structuredClone(d.graph);
    const ew = g2.nodes.find((n) => n.kind === 'electrowinning')!;
    const into = g2.edges.find((x) => x.to === ew.id)!;
    const outE = g2.edges.find((x) => x.from === ew.id)!;
    g2.edges = g2.edges.filter((x) => x !== into && x !== outE);
    g2.nodes = g2.nodes.filter((n) => n.id !== ew.id);
    g2.edges.push({ id: 'bypass', from: into.from, to: outE.to });
    const r2 = simulate(g2, e.trueStream);
    const fail = evaluateRequirements(r2, e.requirements).filter((c) => !c.pass).map((c) => c.id);
    expect(fail).toContain('metalRecoveryMin_kgd');
  });

  it('is the biggest contract: larger than a flagship job on the same seed', () => {
    const mega = generateEnquiry(3, 0, 90, { tech: TECH_ORDER, force: { tier: 'mega' } });
    const flag = generateEnquiry(3, 0, 90, { tech: TECH_ORDER, force: { tier: 'flagship', industry: 'plating' } });
    expect(mega.contractValue).toBeGreaterThan(flag.contractValue);
  });
});
