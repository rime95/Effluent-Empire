/** Early-game fairness: plain jobs are winnable with the basic kit, and tier-1 technology needs no reputation. */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE, REFERENCE_STD_A } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { canResearch } from '../../src/game/tech';

describe('winnable plain jobs', () => {
  it('a plain Standard A job is only offered where the basic reference design reaches Standard A', () => {
    let a = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const e = generateEnquiry(seed, 1, 45, { tech: [] });
      if (e.variant || e.tier || e.standard !== 'A') continue;
      a++;
      const passes = (t: ReturnType<typeof REFERENCE.food>) => { const sim = simulate(linearGraph(t), e.trueStream); return evaluate(sim.effluent!, 'A', sim).pass; };
      expect(passes(REFERENCE[e.industry](e.trueStream)) || passes(REFERENCE_STD_A[e.industry](e.trueStream))).toBe(true);
    }
    expect(a).toBeGreaterThan(0); // Standard A jobs still exist where the basic kit can do it
  });
  it('every plain Standard B job is solvable with the basic kit (its reference design passes)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const e = generateEnquiry(seed, 1, 45, { tech: [] });
      if (e.variant || e.tier || e.standard !== 'B') continue;
      const sim = simulate(linearGraph(REFERENCE[e.industry](e.trueStream)), e.trueStream);
      expect(evaluate(sim.effluent!, 'B', sim).checks.filter((c) => !c.pass).map((c) => `${e.industry} ${seed} ${c.param}`)).toEqual([]);
    }
  });
});

describe('tier-1 research', () => {
  it('DAF and the sludge dryer need cash only (no reputation)', () => {
    expect(canResearch('daf', { tech: [], reputation: -30, cash: 200_000 }).ok).toBe(true);
    expect(canResearch('dryer', { tech: [], reputation: 0, cash: 200_000 }).ok).toBe(true);
    expect(canResearch('uf', { tech: [], reputation: 0, cash: 200_000 }).ok).toBe(false);
  });
});

describe('reputation recovery', () => {
  it('a low reputation recovers +1 every 2 weeks up to 30; a high one does not drift', async () => {
    const { useGame, REP_RECOVERY } = await import('../../src/game/store');
    useGame.getState().newGame('Recovery Co');
    useGame.setState({ reputation: -10, cash: 5e6 });
    useGame.getState().advanceWeek(20);
    expect(useGame.getState().reputation).toBe(-10 + 20 / REP_RECOVERY.everyWeeks);
    useGame.setState({ reputation: 50 });
    useGame.getState().advanceWeek(6);
    expect(useGame.getState().reputation).toBe(50);
  });
});

describe('no random failures', () => {
  it('operated plants get no random breakdowns or incidents; a loaded save drops any it had', async () => {
    const { OM } = await import('../../src/game/operations');
    const { useGame, migrate } = await import('../../src/game/store');
    expect(OM.randomFailures).toBe(false);
    useGame.getState().newGame('Calm Co');
    const s = useGame.getState();
    const fake = { ...s, plants: [{ id: 'x', status: 'operating', breakdown: { unitId: 'u0', tag: 'EQ-01', description: 'x', weeksLeft: 3 }, incident: { kind: 'pumpTrip' }, graph: { nodes: [], edges: [] }, trueStream: s.enquiries[0].trueStream, capex: 1, contract: null, history: [] }] };
    const m = migrate(JSON.parse(JSON.stringify(fake)))!;
    expect(m.plants[0].breakdown).toBeNull();
    expect(m.plants[0].incident).toBeNull();
  });
});
