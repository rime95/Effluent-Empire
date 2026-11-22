/** Developer mode: testing tools are inert until switched on, and each action does only what it says. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGame } from '../../src/game/store';
import { TECH_ORDER } from '../../src/game/tech';
import { VARIANTS } from '../../src/game/variants';

describe('developer mode', () => {
  beforeEach(() => useGame.getState().newGame('Dev Test Co'));

  it('does nothing while switched off', () => {
    const s0 = useGame.getState();
    s0.dev({ kind: 'cash', amount: 1e6 });
    s0.dev({ kind: 'allTech' });
    const s = useGame.getState();
    expect(s.cash).toBe(s0.cash);
    expect(s.tech).toEqual([]);
    expect(s.devUsed).toBeFalsy();
  });

  it('cash is booked in the ledger; reputation, tech and the DEV mark', () => {
    const g = useGame.getState();
    g.setDevMode(true);
    const cash0 = useGame.getState().cash;
    g.dev({ kind: 'cash', amount: 500_000 });
    g.dev({ kind: 'reputation', value: 60 });
    g.dev({ kind: 'allTech' });
    const s = useGame.getState();
    expect(s.cash).toBe(cash0 + 500_000);
    expect(s.ledger.at(-1)).toMatchObject({ label: 'Developer: cash grant', amount: 500_000, cat: 'capital' });
    expect(s.reputation).toBe(60);
    expect(s.tech).toEqual(TECH_ORDER);
    g.setDevMode(false);
    expect(useGame.getState().devUsed).toBe(true);
  });

  it('spawns a forced tier client and every tough-job variant', () => {
    const g = useGame.getState();
    g.setDevMode(true);
    g.dev({ kind: 'reputation', value: 60 });
    g.dev({ kind: 'allTech' });
    g.dev({ kind: 'spawn', force: { industry: 'food', tier: 'medium' } });
    const e = useGame.getState().enquiries[0];
    expect(e.industry).toBe('food');
    expect(e.tier).toBe('medium');
    for (const v of VARIANTS) {
      g.dev({ kind: 'spawn', force: { variantId: v.id } });
      expect(useGame.getState().enquiries[0].variant?.id).toBe(v.id);
    }
  });

  it('loads the pricing reference design into the active project', () => {
    const g = useGame.getState();
    g.setDevMode(true);
    g.dev({ kind: 'reputation', value: 60 });
    g.dev({ kind: 'allTech' });
    g.dev({ kind: 'spawn', force: { industry: 'plating', tier: 'mnc' } });
    const e = useGame.getState().enquiries[0];
    useGame.getState().accept(e.id);
    useGame.getState().dev({ kind: 'referenceDesign' });
    const p = useGame.getState().projects.find((x) => x.id === e.id)!;
    expect(p.graph.nodes.some((n) => n.kind === 'ro')).toBe(true);
    expect(p.graph.nodes.every((n) => n.position)).toBe(true);
  });

  it("does not leak into a new game or an older save without the flags", () => {
    useGame.getState().setDevMode(true);
    useGame.getState().newGame("Clean Co");
    expect(useGame.getState().devMode).toBeFalsy();
    expect(useGame.getState().devUsed).toBeFalsy();
    useGame.getState().setDevMode(true);
    const { devMode, devUsed, ...old } = useGame.getState();
    void devMode; void devUsed;
    expect(useGame.getState().load(JSON.stringify(old))).toBe(true);
    expect(useGame.getState().devMode).toBeFalsy();
    expect(useGame.getState().devUsed).toBeFalsy();
  });

  it("spawning a Local SME never produces a tier client", () => {
    const g = useGame.getState();
    g.setDevMode(true);
    g.dev({ kind: "reputation", value: 80 });
    g.dev({ kind: "allTech" });
    for (let i = 0; i < 15; i++) {
      useGame.getState().dev({ kind: "spawn", force: { industry: "food", tier: "basic" } });
      expect(useGame.getState().enquiries[0].tier).toBeUndefined();
    }
  });
});
