/**
 * Technology Tree: advanced treatment technologies bought with cash (GAME MODEL costs, verify against vendor budget
 * prices). Every basic unit is available from the start; only the advanced units listed here are locked until researched.
 * Each technology also opens tougher client types that need it (variants.ts). Ref: knowledge/processes/technology_tree.md
 */

export type TechId =
  | 'daf'
  | 'dryer'
  | 'uf'
  | 'sulfide'
  | 'ionExchange'
  | 'uasb'
  | 'ro'
  | 'reclaim'
  | 'electrowinning'
  | 'aop'
  | 'mbr'
  | 'evaporator';

export type TechCategory = 'physical' | 'chemical' | 'biological' | 'sludge' | 'membrane' | 'recovery';

export interface TechDef {
  id: TechId;
  name: string;
  tier: 1 | 2 | 3 | 4;
  category: TechCategory;
  costRM: number;
  /** company reputation needed to research */
  reputation: number;
  requires: TechId[];
  /** unit kinds (catalogue keys) this technology makes available */
  units: string[];
  /** one-line description of what it does */
  blurb: string;
  /** tougher customers it opens (labels; the generator lives in variants.ts) */
  clients: string[];
  /** false until the engineering model is implemented: shown in the tree as "in development" */
  available: boolean;
}

/** tier 1 needs no reputation (cash only): a struggling company can still research its way out of a hard job */
export const TIER_REPUTATION = { 1: 0, 2: 25, 3: 40, 4: 60 } as const;

export const TECH: Record<TechId, TechDef> = {
  daf: {
    id: 'daf', name: 'Dissolved-air flotation (DAF)', tier: 1, category: 'physical', costRM: 120_000, reputation: TIER_REPUTATION[1], requires: [], units: ['daf'],
    blurb: 'Micro-bubbles float oil, grease and light floc; float scraped to the sludge line.', clients: ['Emulsified-oil food and edible-oil refineries'], available: true,
  },
  dryer: {
    id: 'dryer', name: 'Sludge dryer', tier: 1, category: 'sludge', costRM: 150_000, reputation: TIER_REPUTATION[1], requires: [], units: ['dryer'],
    blurb: 'Thermal drying of press cake to 70–90 % dry solids: far fewer tonnes of scheduled waste to haul.', clients: ['Sludge-heavy metal finishers with a disposal-cost cap'], available: true,
  },
  uf: {
    id: 'uf', name: 'Ultrafiltration (UF)', tier: 2, category: 'membrane', costRM: 160_000, reputation: TIER_REPUTATION[2], requires: [], units: ['uf'],
    blurb: 'Hollow-fibre membranes remove suspended solids and colloids almost completely: the pretreatment for RO and MBR.', clients: ['Pretreatment for RO (no client of its own)'], available: true,
  },
  sulfide: {
    id: 'sulfide', name: 'Sulfide precipitation', tier: 2, category: 'chemical', costRM: 140_000, reputation: TIER_REPUTATION[2], requires: [], units: ['sulfide'],
    blurb: 'NaHS precipitates metal sulfides, orders of magnitude less soluble than hydroxides.', clients: ['Electroless-nickel platers (complexed Ni)'], available: true,
  },
  ionExchange: {
    id: 'ionExchange', name: 'Ion exchange (chelating resin)', tier: 2, category: 'chemical', costRM: 180_000, reputation: TIER_REPUTATION[2], requires: [], units: ['ionExchange'],
    blurb: 'Selective resin polishes trace heavy metals; acid regenerant concentrates them.', clients: ['Pays through metal recovery: eluate to electrowinning'], available: true,
  },
  uasb: {
    id: 'uasb', name: 'Anaerobic UASB + biogas', tier: 2, category: 'biological', costRM: 300_000, reputation: TIER_REPUTATION[2], requires: [], units: ['uasb'],
    blurb: 'Anaerobic sludge blanket converts high-strength COD to methane; biogas powers the plant.', clients: ['Cuts aeration power and earns a biogas credit on high-strength food waste'], available: true,
  },
  ro: {
    id: 'ro', name: 'Reverse osmosis (RO)', tier: 3, category: 'membrane', costRM: 350_000, reputation: TIER_REPUTATION[3], requires: ['uf'], units: ['ro'],
    blurb: 'High-pressure membranes reject dissolved salts: process-grade permeate and a brine stream.', clients: ['Water-stressed finishers with reuse targets (with the reclaim system)'], available: true,
  },
  reclaim: {
    id: 'reclaim', name: 'Water reclaim system', tier: 3, category: 'recovery', costRM: 200_000, reputation: TIER_REPUTATION[3], requires: ['ro'], units: ['reclaim'],
    blurb: 'Returns treated water to the client’s process: a reuse credit and a smaller discharge.', clients: ['Water-stressed finishers: ≥ 30 % reuse'], available: true,
  },
  electrowinning: {
    id: 'electrowinning', name: 'Electrowinning', tier: 3, category: 'recovery', costRM: 250_000, reputation: TIER_REPUTATION[3], requires: ['ionExchange'], units: ['electrowinning'],
    blurb: 'Plates copper and nickel out of a liquor as saleable metal: g/L eluate or drag-out at high current density, a few-hundred-mg/L nickel rinse at low current density on a large cathode.', clients: ['Drag-out recovery (g/L Cu/Ni)', 'Segregated nickel rinse recovery (200–400 mg/L Ni)'], available: true,
  },
  aop: {
    id: 'aop', name: 'Advanced oxidation (Fenton / ozone)', tier: 3, category: 'chemical', costRM: 220_000, reputation: TIER_REPUTATION[3], requires: [], units: ['aop'],
    blurb: 'Hydroxyl radicals break down refractory COD and colour that biology cannot.', clients: ['Refractory (inert) COD polishing'], available: true,
  },
  mbr: {
    id: 'mbr', name: 'Membrane bioreactor (MBR)', tier: 3, category: 'biological', costRM: 280_000, reputation: TIER_REPUTATION[3], requires: ['uf'], units: ['mbr'],
    blurb: 'Activated sludge at high MLSS with membranes instead of a clarifier: compact, solids-free effluent.', clients: ['Compact plants; solids-free feed for RO'], available: true,
  },
  evaporator: {
    id: 'evaporator', name: 'Vacuum evaporator (MVR)', tier: 4, category: 'recovery', costRM: 500_000, reputation: TIER_REPUTATION[4], requires: ['ro'], units: ['evaporator'],
    blurb: 'Boils water off under vacuum: distillate for reuse, a small concentrate for haulage — zero liquid discharge.', clients: ['Zero-liquid-discharge electronics finishers'], available: true,
  },
};

export const TECH_ORDER: TechId[] = ['daf', 'dryer', 'uf', 'sulfide', 'ionExchange', 'uasb', 'ro', 'reclaim', 'electrowinning', 'aop', 'mbr', 'evaporator'];

/** Unit kind → technology that unlocks it (kinds not listed are basic and always available). */
export const UNIT_TECH: Record<string, TechId> = Object.fromEntries(TECH_ORDER.flatMap((id) => TECH[id].units.map((u) => [u, id])));

export function isUnitUnlocked(kind: string, unlocked: readonly TechId[]): boolean {
  const t = UNIT_TECH[kind];
  return !t || unlocked.includes(t);
}

export type ResearchCheck = { ok: true } | { ok: false; reason: string };

export function canResearch(id: TechId, s: { tech: readonly TechId[]; reputation: number; cash: number }, creditLine = 0): ResearchCheck {
  const t = TECH[id];
  if (s.tech.includes(id)) return { ok: false, reason: 'Already researched.' };
  if (!t.available) return { ok: false, reason: 'In development — available in a coming update.' };
  const missing = t.requires.filter((r) => !s.tech.includes(r));
  if (missing.length) return { ok: false, reason: `Needs ${missing.map((m) => TECH[m].name).join(', ')} first.` };
  if (t.reputation > 0 && s.reputation < t.reputation) return { ok: false, reason: `Needs reputation ${t.reputation} (you have ${Math.floor(s.reputation)}).` };
  if (s.cash + creditLine < t.costRM) return { ok: false, reason: `Needs RM ${t.costRM.toLocaleString()} (cash + credit).` };
  return { ok: true };
}
