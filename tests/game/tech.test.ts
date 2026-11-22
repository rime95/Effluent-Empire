// Technology Tree rules, research cash, and enquiry generation with tech / names. Ref: knowledge/processes/technology_tree.md
import { describe, expect, it } from 'vitest';
import { TECH, TECH_ORDER, UNIT_TECH, canResearch, isUnitUnlocked } from '../../src/game/tech';
import { generateEnquiry } from '../../src/game/customers';
import { GENERIC_NAMES } from '../../src/game/clientNames';
import { useGame, migrate } from '../../src/game/store';
import { CATALOGUE } from '../../src/simulation/treatment/catalogue';

describe('technology tree rules', () => {
  it('prerequisites are researchable earlier in the tree (no cycles, lower or equal tier)', () => {
    for (const id of TECH_ORDER) for (const r of TECH[id].requires) expect(TECH[r].tier).toBeLessThanOrEqual(TECH[id].tier);
  });

  it('every basic catalogue unit is unlocked with no research; advanced units are locked until researched', () => {
    for (const k of Object.keys(CATALOGUE)) expect(isUnitUnlocked(k, [])).toBe(!(k in UNIT_TECH));
    for (const [k, t] of Object.entries(UNIT_TECH)) if (k in CATALOGUE) expect(isUnitUnlocked(k, [t])).toBe(true);
    expect(isUnitUnlocked('daf', [])).toBe(false);
  });

  it('canResearch checks availability, prerequisites, reputation and cash', () => {
    const avail = TECH_ORDER.find((id) => TECH[id].available && TECH[id].requires.length === 0);
    if (avail) {
      const t = TECH[avail];
      expect(canResearch(avail, { tech: [], reputation: t.reputation, cash: t.costRM }).ok).toBe(true);
      if (t.reputation > 0) expect(canResearch(avail, { tech: [], reputation: t.reputation - 1, cash: t.costRM }).ok).toBe(false);
      expect(canResearch(avail, { tech: [], reputation: t.reputation, cash: t.costRM - 1 }).ok).toBe(false);
      expect(canResearch(avail, { tech: [avail], reputation: 99, cash: 1e9 }).ok).toBe(false);
    }
    const dependent = TECH_ORDER.find((id) => TECH[id].requires.length > 0)!;
    const chk = canResearch(dependent, { tech: [], reputation: 99, cash: 1e9 });
    expect(chk.ok).toBe(false);
  });

  it('research books the cost and unlocks the units', () => {
    const avail = TECH_ORDER.find((id) => TECH[id].available && TECH[id].requires.length === 0);
    if (!avail) return;
    useGame.setState({ tech: [], cash: 1_000_000, reputation: 99, gameOver: false, ledger: [] });
    expect(useGame.getState().research(avail).ok).toBe(true);
    expect(useGame.getState().cash).toBe(1_000_000 - TECH[avail].costRM);
    expect(useGame.getState().tech).toContain(avail);
    for (const u of TECH[avail].units) expect(isUnitUnlocked(u, useGame.getState().tech)).toBe(true);
    expect(useGame.getState().ledger.at(-1)!.cat).toBe('research');
  });

  it('old saves load with an empty tree', () => {
    const s = migrate({ version: 2, chem: 2, companyName: 'X', cash: 1, week: 3, reputation: 0 });
    expect(s!.tech).toEqual([]);
  });
});

describe('enquiry generation', () => {
  it('legacy generation is unchanged by the tech option when no tough job is open', () => {
    for (let seed = 100; seed < 120; seed++) {
      const a = generateEnquiry(seed, 1, 0);
      const b = generateEnquiry(seed, 1, 0, { tech: [] });
      expect(b.trueStream).toEqual(a.trueStream);
      expect(b.contractValue).toBe(a.contractValue);
      expect(b.variant).toBeUndefined();
    }
  });

  it('about 40 generic names per industry, all distinct', () => {
    for (const names of Object.values(GENERIC_NAMES)) {
      expect(names.length).toBeGreaterThanOrEqual(40);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('a name already in play is not reused', () => {
    const a = generateEnquiry(321, 1, 0);
    const b = generateEnquiry(321, 1, 0, { usedNames: new Set([a.company]) });
    expect(b.company).not.toBe(a.company);
    expect(b.trueStream).toEqual(a.trueStream); // only the name changes
  });
});
