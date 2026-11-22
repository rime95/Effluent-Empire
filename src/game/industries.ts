/**
 * Industry wastewater templates. Ranges are indicative of typical raw industrial effluents (verify per project:
 * see knowledge/processes/technology_profiles.md). Each produces the *true* influent; the player only sees lab results.
 */
import { Stream, emptyStream } from '../simulation/core/stream';
import { setCbForPH } from '../simulation/chemistry/acidBase';
import { Rng } from './rng';
import { GENERIC_NAMES } from './clientNames';

export type IndustryId = 'plating' | 'food' | 'semiconductor';

type R = [number, number];

export interface IndustryTemplate {
  id: IndustryId;
  name: string;
  sector: string;
  description: string;
  Q: R;
  pH: R;
  /** total inorganic carbon, mmol/L (buffer) */
  CT: R;
  /** volatile fatty acids, mmol/L */
  vfa: R;
  T: R;
  peak: R;
  metals: { Ni: R; Cu: R; Zn: R };
  /** probability that zinc is present but not declared by the customer */
  hiddenZn: number;
  /** probability the plant has a chrome-plating line (hexavalent chromium), its range (mg/L as Cr) and the chance it is undeclared */
  crVIChance?: number;
  crVI?: R;
  hiddenCrVI?: number;
  /** background sulfate, mmol/L (metal sulfate salts, acid pickling) */
  SO4: R;
  COD: R;
  /** COD fractions SS, SI, XS, XI (sum 1) */
  frac: [number, number, number, number];
  /** NH4-N, mg/L (absolute range) */
  NH4N: R;
  /** if set, NH4-N is drawn as this fraction of COD instead (organic industries, BOD:N ≈ 100:3–5) */
  NH4NperCOD?: R;
  OG: R;
  OGfreeFraction: R;
  grit: R;
  inert: R;
  colloid: R;
  budgetPerM3d: R;
  names: string[];
  /** background dissolved salts not tracked as species (Na, K, Ca, Mg, Cl, silica), mg/L — GAME MODEL typical figure */
  tds?: number;
}

export const INDUSTRIES: Record<IndustryId, IndustryTemplate> = {
  plating: {
    id: 'plating',
    name: 'Metal Finishing',
    sector: 'Electroplating',
    description: 'Acidic rinse waters from nickel, copper and zinc plating lines. Low buffer capacity, organic brighteners.',
    Q: [80, 400],
    pH: [2.5, 4.0],
    CT: [0.2, 1.0],
    vfa: [0, 0],
    T: [28, 34],
    peak: [1.8, 2.5],
    metals: { Ni: [5, 25], Cu: [2, 15], Zn: [0, 8] },
    hiddenZn: 0.4,
    crVIChance: 0.35,
    crVI: [5, 40],
    hiddenCrVI: 0.3,
    SO4: [3, 12],
    COD: [80, 250],
    frac: [0.2, 0.4, 0.15, 0.25],
    NH4N: [2, 10],
    OG: [5, 25],
    OGfreeFraction: [0.3, 0.5],
    grit: [5, 20],
    inert: [20, 60],
    colloid: [20, 80],
    budgetPerM3d: [3200, 4200],
    names: GENERIC_NAMES.plating,
    tds: 900,
  },
  food: {
    id: 'food',
    name: 'Food Processing',
    sector: 'Food manufacturing',
    description: 'High-strength, readily biodegradable organics with fats, oils and grease from washing and cooking.',
    Q: [150, 600],
    pH: [5.5, 7.2],
    CT: [6, 14],
    vfa: [2, 10],
    T: [28, 34],
    peak: [1.5, 2.2],
    metals: { Ni: [0, 0], Cu: [0, 0.1], Zn: [0, 0.3] },
    hiddenZn: 0,
    COD: [2000, 5000],
    frac: [0.45, 0.03, 0.42, 0.1],
    NH4N: [0, 0],
    NH4NperCOD: [0.022, 0.03],
    OG: [60, 250],
    OGfreeFraction: [0.6, 0.8],
    grit: [10, 40],
    inert: [20, 60],
    colloid: [40, 150],
    budgetPerM3d: [3500, 4800],
    SO4: [0.5, 2],
    names: GENERIC_NAMES.food,
    tds: 700,
  },
  semiconductor: {
    id: 'semiconductor',
    name: 'Semiconductor',
    sector: 'Wafer fabrication',
    description: 'Large flows of acidic copper-bearing rinse water with colloidal CMP slurry and ammonia.',
    Q: [300, 1500],
    pH: [3.0, 5.0],
    CT: [0.1, 0.5],
    vfa: [0, 0],
    T: [25, 30],
    peak: [1.2, 1.5],
    metals: { Ni: [0, 2], Cu: [5, 20], Zn: [0, 0] },
    hiddenZn: 0,
    COD: [40, 110],
    frac: [0.5, 0.3, 0.1, 0.1],
    NH4N: [5, 18],
    OG: [0, 2],
    OGfreeFraction: [0.5, 0.5],
    grit: [0, 5],
    inert: [10, 40],
    colloid: [100, 300],
    budgetPerM3d: [2200, 3000],
    SO4: [1, 6],
    names: GENERIC_NAMES.semiconductor,
    tds: 400,
  },
};

export interface GeneratedWastewater {
  stream: Stream;
  hidden: { undeclaredZn: boolean; undeclaredCrVI: boolean };
}

export function generateWastewater(t: IndustryTemplate, rng: Rng): GeneratedWastewater {
  const r = (x: R) => rng.range(x[0], x[1]);
  const s = emptyStream(Math.round(r(t.Q) / 10) * 10);
  s.T = r(t.T);
  s.peakFactor = r(t.peak);
  s.CT = r(t.CT) / 1000;
  s.weakAcidT = r(t.vfa) / 1000;
  s.dissolved = { Ni: r(t.metals.Ni), Cu: r(t.metals.Cu), Zn: r(t.metals.Zn), Cr: 0 };
  const undeclaredZn = rng.chance(t.hiddenZn);
  if (undeclaredZn) s.dissolved.Zn = Math.max(s.dissolved.Zn, rng.range(3, 8));
  const cod = r(t.COD);
  [s.SS, s.SI, s.XS, s.XI] = t.frac.map((f) => rng.noise(f, 0.15) * cod) as [number, number, number, number];
  s.NH4N = t.NH4NperCOD ? cod * r(t.NH4NperCOD) : r(t.NH4N);
  const og = r(t.OG);
  const free = r(t.OGfreeFraction);
  s.OGfree = og * free;
  s.OGemulsified = og * (1 - free);
  s.grit = r(t.grit);
  s.inert = r(t.inert);
  s.colloid = r(t.colloid);
  const pH = r(t.pH);
  // drawn last so that existing seeds keep their original wastewater
  const hasCr = !!t.crVIChance && !!t.crVI && rng.chance(t.crVIChance);
  const undeclaredCrVI = hasCr && rng.chance(t.hiddenCrVI ?? 0);
  if (hasCr) {
    s.CrVI = r(t.crVI!);
    s.dissolved.Cr = s.CrVI * rng.range(0.05, 0.15); // some Cr(III) from drag-out reduction
  }
  s.SO4T = r(t.SO4) / 1000;
  // background salts (Na, K, Ca, Mg, Cl, silica): a fixed industry figure, no RNG draw (keeps existing seeds) — GAME MODEL
  s.tds = t.tds ?? 0;
  return { stream: setCbForPH(s, pH), hidden: { undeclaredZn, undeclaredCrVI } };
}
