/**
 * pH adjustment / hydroxide precipitation reactor. Ref: knowledge/chemistry/chemical_dosing.md, precipitation.md
 *
 * Dose from charge balance (titration to target pH, including base consumed by metal hydroxide precipitation):
 *   ΔCb = requiredCb(target) − Cb
 * NaOH: 1 eq/mol; Ca(OH)2: 2 eq/mol (strong-ion change). H2SO4 adds sulfate; its dose is solved for the target pH because
 * HSO4− (pKa 1.99) takes back protons below pH ≈ 3 (see knowledge/chemistry/acid_base_chemistry.md).
 * Precipitate particle growth with reaction time — GAME MODEL: v50 = 0.05 + 0.25·(1 − e^(−HRT/20 min)) m/h (pin floc).
 */
import { METALS, Stream } from '../core/stream';
import { minimumSolubilityPH } from './solubility';
import { MW, hrtDays } from '../core/units';
import { Note, ProcessResult, result } from '../treatment/types';
import { adjustPH, equilibrate } from './acidBase';

export type Reagent = 'NaOH' | 'lime' | 'H2SO4';

export const REAGENTS: Record<Reagent, { label: string; mw: number; eqPerMol: number; sign: 1 | -1; purity: number; priceRMkg: number }> = {
  NaOH: { label: 'Caustic soda (NaOH, as 100 %)', mw: MW.NaOH, eqPerMol: 1, sign: 1, purity: 1, priceRMkg: 2.0 },
  // verify: hydrated lime ~90 % Ca(OH)2, remainder inert (adds sludge)
  lime: { label: 'Hydrated lime (Ca(OH)₂, 90 %)', mw: MW.CaOH2, eqPerMol: 2, sign: 1, purity: 0.9, priceRMkg: 0.8 },
  H2SO4: { label: 'Sulphuric acid (H₂SO₄, as 100 %)', mw: MW.H2SO4, eqPerMol: 2, sign: -1, purity: 1, priceRMkg: 0.8 },
};

export interface NeutralisationInput {
  targetPH: number;
  /** base reagent used when base is required */
  base: 'NaOH' | 'lime';
  /** tank volume, m³ */
  volume_m3: number;
}

export function neutralise(s: Stream, p: NeutralisationInput): ProcessResult {
  const notes: Note[] = [];
  const adj = adjustPH(s, p.targetPH, p.base);
  const demand = adj.demandEq;
  const reagent: Reagent = adj.reagent;
  const r = REAGENTS[reagent];
  const mgL_active = adj.mol * r.mw * 1000;
  const mgL_product = mgL_active / r.purity;

  const dosed = adj.stream;
  if (reagent === 'lime') dosed.inert += mgL_product - mgL_active; // lime impurities → mineral solids
  const out = equilibrate(dosed);

  const hrt_min = hrtDays(p.volume_m3, s.Q * s.peakFactor) * 24 * 60;
  out.v50.precipitate = 0.05 + 0.25 * (1 - Math.exp(-hrt_min / 20));
  if (hrt_min < 10) notes.push({ level: 'warn', code: 'neut.hrt', text: `Reaction time ${hrt_min.toFixed(0)} min at peak flow is short: pH control will be unstable and precipitates very fine.` });
  for (const m of METALS) {
    const total = out.dissolved[m] + out.precipitated[m];
    if (total > 0.5 && out.pH > minimumSolubilityPH(m, s.T).pH + 0.7 && out.dissolved[m] > 0.2 * total)
      notes.push({ level: 'warn', code: 'neut.amphoteric', text: `pH ${out.pH.toFixed(1)} is above the ${m}(OH)₂ solubility minimum: ${out.dissolved[m].toFixed(2)} mg/L ${m} re-dissolves as hydroxo-anions (amphoteric).` });
  }
  if (Math.abs(out.pH - p.targetPH) > 0.05) notes.push({ level: 'warn', code: 'neut.target', text: `Could not reach pH ${p.targetPH}; achieved ${out.pH.toFixed(2)}.` });

  return result(out, {
    produced: reagent === 'lime' ? { mineral: (s.Q * (mgL_product - mgL_active)) / 1000 } : reagent === 'H2SO4' ? { SO4: (s.Q * adj.mol * MW.SO4 * 1000) / 1000 } : {},
    chemicals: [{ name: r.label, kgPerDay: (s.Q * mgL_product) / 1000, priceRMkg: r.priceRMkg }],
    notes,
    calcs: {
      dose: { label: `${reagent} dose`, value: mgL_product, unit: 'mg/L', digits: 0 },
      demand: { label: 'Base demand', value: demand * 1000, unit: 'meq/L', digits: 2 },
      pH: { label: 'Outlet pH', value: out.pH, unit: '', digits: 2 },
      hrt: { label: 'Reaction time (peak)', value: hrt_min, unit: 'min', digits: 0 },
    },
  });
}
