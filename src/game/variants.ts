/**
 * Tougher client types opened by the Technology Tree. A variant reshapes the base industry wastewater (physically
 * plausible overlay ranges documented in knowledge/processes/technology_tree.md) and replaces the reference design
 * used for pricing with one that uses the advanced technology. Variants draw from their own RNG stream, so the base
 * enquiry for a seed is unchanged whether or not a variant is applied.
 */
import { Stream, emptyStream, totalQ } from '../simulation/core/stream';
import { setCbForPH } from '../simulation/chemistry/acidBase';
import { MW } from '../simulation/core/units';
import { IndustryId } from './industries';
import { TrainSpec, dafFoodTrain, foodTrain, metalTrain, reuseGraph, segregatedGraph, sludgeLineGraph, sulfideMetalTrain, zldGraph } from './referenceDesigns';
import { ProcessGraph, SimResult, linearGraph } from '../simulation/treatment/graph';
import { Requirements } from './requirements';
import { defaultParams } from '../simulation/treatment/catalogue';
import { Rng } from './rng';
import { TechId } from './tech';

export interface ClientVariant {
  id: string;
  industry: IndustryId;
  requires: TechId[];
  /** shown on the enquiry card: "Tough job: …" */
  label: string;
  /** why the job needs the technology (enquiry detail) */
  brief: string;
  /** reshape the true wastewater */
  overlay: (s: Stream, rng: Rng) => Stream;
  /** reference design (with the advanced technology) used to price the job */
  reference: (s: Stream) => TrainSpec | ProcessGraph;
  /** contract requirements derived from the reference design's simulation (e.g. a disposal-cost cap) */
  requirements?: (ref: SimResult) => Requirements;
  /** force a discharge standard (tight limits are often the reason the technology is needed) */
  standard?: 'A' | 'B';
  /** reputation needed (variants that need no researched technology would otherwise flood the early game) */
  minReputation?: number;
}

/** A segregated raw stream of the same factory: same temperature and background salts as the main rinse. */
function sideStream(main: Stream, Q: number): Stream {
  const s = emptyStream(Q);
  s.T = main.T;
  s.peakFactor = Math.max(main.peakFactor, 1.8); // batch dumps and line drains
  s.CT = 1e-3;
  s.tds = main.tds ?? 0;
  return s;
}

const ru = (k: Parameters<typeof defaultParams>[0], Q: number, over: Record<string, number | string> = {}) => ({ kind: k, params: { ...defaultParams(k, Q), ...over } });

/** main and side flows for a side stream that is fraction f of the factory's total flow */
const splitQ = (Q: number, f: number) => ({ main: Math.round(Q * (1 - f)), side: Math.max(0.5, Math.round(Q * f * 10) / 10) });

/** Chance that an enquiry is a tough job when at least one variant is open. */
export const VARIANT_CHANCE = 0.4;
/** Price premium on tough jobs over reference-design pricing (GAME MODEL). */
export const VARIANT_PREMIUM = 1.15;

/** Registered as each technology's engineering model lands. */
export const VARIANTS: ClientVariant[] = [
  {
    id: 'emulsifiedOil',
    industry: 'food',
    requires: ['daf'],
    label: 'Edible-oil refinery — emulsified oil',
    brief: 'Refinery and frying-line wastewater: most of the oil is emulsified (soapstock, detergents). A gravity separator barely touches it — break the emulsion and float it.',
    overlay: (s, rng) => {
      const og = rng.range(200, 500);
      const free = rng.range(0.2, 0.4);
      s.OGfree = og * free;
      s.OGemulsified = og * (1 - free);
      return s;
    },
    reference: (s) => dafFoodTrain(s),
    standard: 'B',
  },
  {
    id: 'sludgeCap',
    industry: 'plating',
    requires: ['dryer'],
    label: 'Heavy-metal finisher — disposal-cost cap',
    brief: 'High-load nickel/copper lines make a lot of hydroxide sludge, and the client caps what it will pay for scheduled-waste haulage. Wet cake will not fit under the cap.',
    overlay: (s, rng) => {
      s.dissolved = { ...s.dissolved, Ni: rng.range(25, 60), Cu: rng.range(10, 35), Zn: rng.range(5, 20) };
      return s;
    },
    reference: (s) => {
      const train = metalTrain(s.Q, s.CrVI > 0.05, s);
      const clar = train.findIndex((u) => u.kind === 'clarifier');
      const q = (k: 'thickener' | 'filterPress' | 'dryer', over: Record<string, number | string>) => ({ kind: k, params: { ...defaultParams(k, s.Q), ...over } });
      // sludge line sized on the dry-solids load: thickener at ~15 kg/m²·d, press for 3 cycles/d of ~25 % DS cake, dryer to 80 % DS
      const dryKgD = (s.Q * (2.5 * (s.dissolved.Ni + s.dissolved.Cu + s.dissolved.Zn) + 150)) / 1000;
      return sludgeLineGraph(train, clar, [
        q('thickener', { area: Math.max(2, Math.ceil(dryKgD / 15)) }),
        q('filterPress', { volume: Math.max(0.2, Math.ceil((dryKgD / 0.25 / 1000 / 3) * 1.6 * 20) / 20), cycles: 3, conditioning: 'polymer' }),
        q('dryer', { targetDS: 80 }),
      ]);
    },
    requirements: (ref) => ({ sludgeCapRMd: Math.round(ref.opexSplit.sludge * 1.3) }),
    standard: 'B',
  },
  {
    id: 'complexedNi',
    industry: 'plating',
    requires: ['sulfide'],
    label: 'Electroless-nickel plater — complexed nickel',
    brief: 'Electroless-nickel and alkaline copper baths carry citrate, lactate and ammonia: much of the nickel is complexed and stays dissolved however high you raise the pH. The metals panel shows the complexed share.',
    overlay: (s, rng) => {
      const ni = rng.range(15, 40);
      const f = rng.range(0.45, 0.75);
      s.dissolved = { ...s.dissolved, Ni: ni * (1 - f) };
      s.complexed = { ...(s.complexed ?? { Ni: 0, Cu: 0, Zn: 0, Cr: 0 }), Ni: ni * f };
      return s;
    },
    reference: (s) => sulfideMetalTrain(s),
    standard: 'B',
  },
  {
    id: 'waterReuse',
    industry: 'plating',
    requires: ['ro', 'reclaim'],
    label: 'Water-stressed finisher — 30 % reuse',
    brief: 'The plant buys expensive tankered water in dry months: the contract requires at least 30 % of the wastewater back as process rinse water (TDS ≤ 500 mg/L). Only RO permeate is clean enough — and the brine still has to pass the discharge standard.',
    overlay: (s, rng) => {
      s.tds = (s.tds ?? 0) * rng.range(1.2, 2); // hard make-up water, salty acid cleaners
      return s;
    },
    reference: (s) => reuseGraph(metalTrain(s.Q, s.CrVI > 0.05, s), s.Q, 50),
    requirements: () => ({ reuseMin: 0.3 }),
    standard: 'B',
  },
  {
    id: 'zld',
    industry: 'plating',
    requires: ['ro', 'reclaim', 'evaporator'],
    label: 'Electronics finisher — zero liquid discharge',
    brief: 'No discharge permit at all (the site sits above a water intake): every litre is recovered — RO permeate and evaporator distillate go back to the process, the last concentrate leaves by tanker. Budget is generous.',
    overlay: (s) => s,
    reference: (s) => zldGraph(metalTrain(s.Q, s.CrVI > 0.05, s), s.Q),
    requirements: () => ({ zld: true }),
    standard: 'A',
  },
  // ---- segregated raw streams (knowledge/processes/segregated_streams.md): treat each stream, then combine ----
  {
    id: 'chromeSegregated',
    industry: 'plating',
    requires: [],
    minReputation: 10,
    label: 'Chrome line on its own drain',
    brief: 'The hard-chrome line has its own rinse drain: a small acidic stream with all the hexavalent chromium. The usual practice is to reduce Cr(VI) on that stream alone, then send it into the metal train — or blend everything first and reduce the whole flow, if you prefer.',
    overlay: (s, rng) => {
      const q = splitQ(s.Q, rng.range(0.05, 0.15));
      const cr = sideStream(s, q.side);
      cr.CrVI = rng.range(20, 80);
      cr.dissolved = { ...cr.dissolved, Cr: rng.range(1, 5) };
      s.Q = q.main;
      s.CrVI = 0;
      s.side = [{ id: 'cr', label: 'Chrome rinse', stream: setCbForPH(cr, rng.range(3, 3.8)) }];
      return s;
    },
    standard: 'B',
    reference: (s) => segregatedGraph(metalTrain(totalQ(s), false, s), [{ id: 'cr', tag: 'CR', join: 'eq', train: [ru('crReduction', side(s, 'cr').Q, { volume: Math.max(1, Math.ceil(side(s, 'cr').Q / 24 / 2)) })] }]),
  },
  {
    id: 'enSegregated',
    industry: 'plating',
    requires: ['sulfide'],
    label: 'Electroless-nickel line on its own drain',
    brief: 'The electroless-nickel line drains separately: a small stream of nickel held by citrate and lactate that hydroxide will not touch. Break it with sulfide on that stream, then let it join the main metal train — the rinse itself is plain hydroxide work.',
    overlay: (s, rng) => {
      const q = splitQ(s.Q, rng.range(0.03, 0.08));
      const en = sideStream(s, q.side);
      const ni = rng.range(50, 300);
      en.complexed = { Ni: ni * 0.9, Cu: 0, Zn: 0, Cr: 0 };
      en.dissolved = { ...en.dissolved, Ni: ni * 0.1 };
      en.SS = rng.range(150, 400); // lactic / citric / succinic acid (biodegradable COD)
      s.Q = q.main;
      s.side = [{ id: 'en', label: 'Electroless nickel', stream: setCbForPH(en, rng.range(4.5, 5.5)) }];
      return s;
    },
    reference: (s) => {
      const en = side(s, 'en');
      const nahs = Math.min(500, Math.ceil((((en.complexed?.Ni ?? 0) + en.dissolved.Ni) / MW.Ni) * 56.06 * 1.3));
      return segregatedGraph(metalTrain(totalQ(s), s.CrVI > 0.05, s), [
        { id: 'en', tag: 'EN', join: 'coagulation', train: [ru('precipitation', en.Q, { targetPH: 9 }), ru('sulfide', en.Q, { dose: nahs, volume: Math.max(0.5, Math.ceil(en.Q / 48 * 2) / 2) })] },
      ]);
    },
    standard: 'B',
  },
  {
    id: 'dragOut',
    industry: 'plating',
    requires: ['electrowinning'],
    label: 'Concentrated drag-out stream',
    brief: 'Static drag-out tanks are dumped to their own line: a few m³/d at grams per litre of nickel and copper. Plate the metal out and sell it, then send the spent liquor to the main train — or bleed it into the rinse and precipitate it all.',
    overlay: (s, rng) => {
      const d = sideStream(s, Math.round(rng.range(1, 3) * 10) / 10);
      d.dissolved = { ...d.dissolved, Ni: rng.range(2000, 8000), Cu: rng.range(300, 2000) };
      d.SO4T = 0.06;
      d.peakFactor = 1;
      s.side = [{ id: 'do', label: 'Drag-out', stream: setCbForPH(d, rng.range(2, 3)) }];
      return s;
    },
    reference: (s) => {
      const d = side(s, 'do');
      const kg = (d.Q * (d.dissolved.Ni + d.dissolved.Cu)) / 1000;
      return segregatedGraph(metalTrain(totalQ(s), s.CrVI > 0.05, s), [{ id: 'do', tag: 'DO', join: 'eq', train: [ru('electrowinning', d.Q, { area: Math.max(2, Math.ceil(kg * 2)), j: 200 })] }]);
    },
    standard: 'B',
  },
  {
    id: 'niRinseRecovery',
    industry: 'plating',
    requires: ['electrowinning'],
    label: 'Nickel rinse on its own drain — recover the nickel',
    brief: 'The bright-nickel line has a segregated rinse at a few hundred mg/L Ni. Plated out by electrowinning at low current density on a large cathode area, the nickel sells as cathode metal; the spent rinse joins the main metal train. Or blend it in and precipitate it all as sludge.',
    overlay: (s, rng) => {
      const q = splitQ(s.Q, rng.range(0.06, 0.15));
      const ni = sideStream(s, q.side);
      ni.dissolved = { ...ni.dissolved, Ni: rng.range(200, 400) };
      ni.SO4T = (ni.dissolved.Ni / MW.Ni / 1000) * 1.1; // nickel sulfate rinse
      ni.peakFactor = 1.3;
      s.Q = q.main;
      s.side = [{ id: 'ni', label: 'Nickel rinse', stream: setCbForPH(ni, rng.range(4, 5)) }];
      return s;
    },
    reference: (s) => {
      const r = side(s, 'ni');
      const Qs = r.Q / 86400;
      // 85 % recovery: A = (1/0.15 − 1)·Q/k_m; current density at 0.7 × the limiting current density 2·F·k_m·C
      const area = Math.min(1000, Math.ceil(((1 / 0.15 - 1) * Qs) / 1e-5));
      const iL = 2 * 96485 * 1e-5 * (r.dissolved.Ni / MW.Ni);
      return segregatedGraph(metalTrain(totalQ(s), s.CrVI > 0.05, s), [{ id: 'ni', tag: 'NI', join: 'eq', train: [ru('electrowinning', r.Q, { area, j: Math.max(5, Math.round((0.7 * iL) / 5) * 5) })] }]);
    },
    standard: 'B',
  },
  {
    id: 'foodHighStrength',
    industry: 'food',
    requires: ['uasb'],
    label: 'High-strength process stream',
    brief: 'Syrup, reject product and first CIP rinses drain separately: a small acidic stream at 15–40 g/L COD. An anaerobic reactor takes most of it out (and pays back in biogas) before it joins the main aeration train — or size the aeration for the whole load.',
    overlay: (s, rng) => {
      const q = splitQ(s.Q, rng.range(0.05, 0.1));
      const hs = sideStream(s, q.side);
      const cod = rng.range(15000, 40000);
      hs.SS = cod * 0.892; // sugars, reject product: almost all readily biodegradable
      hs.XS = cod * 0.1;
      hs.SI = cod * 0.008;
      hs.NH4N = cod * 0.01;
      hs.T = 35;
      s.Q = q.main;
      s.side = [{ id: 'hs', label: 'High-strength', stream: setCbForPH(hs, rng.range(4.5, 5.5)) }];
      return s;
    },
    reference: (s) => {
      const h = side(s, 'hs');
      const load = (h.Q * (h.SS + h.XS + h.SI)) / 1000;
      // the main aeration train also takes the UASB effluent: alkalinity held at pH 7 (nitrification acidifies), +20 % volume
      const train = foodTrain(s.Q + h.Q, s).map((x) => (x.kind === 'activatedSludge' ? { ...x, params: { ...x.params, volume: Math.ceil(Number(x.params.volume) * 1.5), alkPH: 7, alkReagent: 'NaOH' } } : x));
      return segregatedGraph(train, [
        { id: 'hs', tag: 'HS', join: 'eq', train: [ru('neutralisation', h.Q, { targetPH: 7 }), ru('uasb', h.Q, { volume: Math.max(10, Math.ceil(load / 8 / 10) * 10) })] },
      ]);
    },
    standard: 'B',
  },
];

/** a side stream of a variant's influent */
function side(s: Stream, id: string): Stream {
  const x = s.side?.find((y) => y.id === id);
  if (!x) throw new Error(`segregated stream ${id} missing`);
  return x.stream;
}

export function eligibleVariants(industry: IndustryId, tech: readonly TechId[], reputation = Infinity): ClientVariant[] {
  return VARIANTS.filter((v) => v.industry === industry && v.requires.every((r) => tech.includes(r)) && reputation >= (v.minReputation ?? 0));
}

/** The variant's reference design as a process graph. */
export function referenceGraph(v: ClientVariant, s: Stream): ProcessGraph {
  const d = v.reference(s);
  return Array.isArray(d) ? linearGraph(d) : d;
}
