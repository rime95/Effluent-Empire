/**
 * Hexavalent chromium reduction with sodium metabisulfite. Ref: knowledge/chemistry/chromium.md
 *
 * Overall reaction (balanced; Cr(VI) as HCrO4−, S(IV) as HSO3− from Na2S2O5 + H2O → 2 NaHSO3):
 *   HCrO4− + 3/2 HSO3− + 5/2 H+ → Cr3+ + 3/2 SO4 2− + 5/2 H2O
 *   → stoichiometric demand 0.75 mol Na2S2O5 per mol Cr = 2.74 mg Na2S2O5 per mg Cr(VI)  (practice: ~2.8, PF Online)
 * Charge-balance bookkeeping (pH is re-solved, never assumed):
 *   - chromate leaves the anion side of the charge balance (handled by the CrVI term in acidBase.requiredCb)
 *   - Cr3+ enters as dissolved Cr(III) (mean hydrolysis charge z̄)
 *   - each mol Na2S2O5 adds 2 Na+ (ΔCb +2) and 2 sulfate (tracked as SO4T, HSO4−/SO4 2− equilibrium) — net −2 eq at pH ≫ 2
 * Kinetics — GAME MODEL (first order in Cr(VI), strongly acid-catalysed):
 *   k = 1.5 · 10^−(pH − 2) min⁻¹  → t½ ≈ 0.5 min at pH 2, 1.5 min at pH 2.5, 4.6 min at pH 3, 46 min at pH 4, 8 h at pH 5
 *   calibrated so that design practice (pH 2–2.5, 15–20 min) gives > 99.9 % reduction.
 */
import { Stream, cloneStream } from '../core/stream';
import { MW, hrtDays, mgL_to_molL, molL_to_mgL } from '../core/units';
import { Note, ProcessResult, result } from '../treatment/types';
import { adjustPH, equilibrate } from './acidBase';
import { REAGENTS } from './neutralisation';

export const MBS_PER_CR_STOICH = 0.75; // mol Na2S2O5 per mol Cr(VI)
export const MBS_PRICE_RM_KG = 2.5;

export function reductionRate_perMin(pH: number): number {
  return 1.5 * Math.pow(10, -(pH - 2));
}

export interface CrReductionInput {
  targetPH: number;
  /** metabisulfite dose as a multiple of the stoichiometric demand */
  doseFactor: number;
  volume_m3: number;
}

export function reduceChromium(s: Stream, p: CrReductionInput): ProcessResult {
  const notes: Note[] = [];
  // pH is held at the set-point by control (acid dosed to the FINAL state, after the reduction has consumed H+).
  // Reduction extent is therefore evaluated at the set-point pH.
  const crMol = mgL_to_molL(s.CrVI, MW.Cr);
  const mbsMol = crMol * MBS_PER_CR_STOICH * p.doseFactor;
  const hrt_min = hrtDays(p.volume_m3, s.Q * s.peakFactor) * 24 * 60;
  const kinetic = 1 - Math.exp(-reductionRate_perMin(p.targetPH) * hrt_min);
  const reductantLimit = Math.min(1, p.doseFactor); // cannot reduce more than the reductant allows
  const frac = Math.min(kinetic, reductantLimit);
  const reducedMgL = s.CrVI * frac;

  const after = cloneStream(s);
  after.CrVI = s.CrVI - reducedMgL;
  after.dissolved.Cr += reducedMgL;
  // Na2S2O5 → 2 Na+ (strong cation) + S(IV) oxidised to 2 SO4 2− (tracked sulfate)
  after.Cb += 2 * mbsMol;
  after.SO4T = (after.SO4T ?? 0) + 2 * mbsMol;
  const adj = adjustPH(after, p.targetPH, 'NaOH');
  const acid = REAGENTS[adj.reagent];
  const out = equilibrate(adj.stream);

  if (s.CrVI <= 0) notes.push({ level: 'info', code: 'cr.none', text: 'No hexavalent chromium in the feed — this unit only acidifies.' });
  if (p.doseFactor < 1) notes.push({ level: 'warn', code: 'cr.underdose', text: `Metabisulfite at ${(p.doseFactor * 100).toFixed(0)} % of stoichiometric demand cannot reduce all Cr(VI).` });
  if (out.pH > 3 && s.CrVI > 0 && frac < 0.99) notes.push({ level: 'warn', code: 'cr.pH', text: `Reduction is slow at pH ${out.pH.toFixed(1)} (half-life ${(Math.LN2 / reductionRate_perMin(out.pH)).toFixed(0)} min) — operate at pH 2–2.5.` });
  if (hrt_min < 10 && s.CrVI > 0) notes.push({ level: 'warn', code: 'cr.hrt', text: `Only ${hrt_min.toFixed(0)} min retention at peak flow (design practice 15–20 min).` });

  const acidMgL = molL_to_mgL(adj.mol, acid.mw);
  const so4Added = 2 * mbsMol + (adj.reagent === 'H2SO4' ? adj.mol : 0);
  const mbsMgL = molL_to_mgL(mbsMol, MW.Na2S2O5);
  return result(out, {
    produced: { SO4: (s.Q * so4Added * MW.SO4 * 1000) / 1000 },
    chemicals: [
      { name: acid.label, kgPerDay: (s.Q * acidMgL) / 1000, priceRMkg: acid.priceRMkg },
      { name: 'Sodium metabisulfite (Na₂S₂O₅)', kgPerDay: (s.Q * mbsMgL) / 1000, priceRMkg: MBS_PRICE_RM_KG },
    ],
    notes,
    calcs: {
      pH: { label: 'Reaction pH', value: out.pH, unit: '', digits: 2 },
      hrt: { label: 'Retention (peak)', value: hrt_min, unit: 'min', digits: 0 },
      halfLife: { label: 'Cr(VI) half-life at this pH', value: Math.LN2 / reductionRate_perMin(out.pH), unit: 'min', digits: 1 },
      reduced: { label: 'Cr(VI) reduced', value: frac * 100, unit: '%', digits: 1 },
      mbs: { label: 'Na₂S₂O₅ dose', value: mbsMgL, unit: 'mg/L', digits: 0 },
      acid: { label: `${adj.reagent === 'H2SO4' ? 'H₂SO₄' : 'NaOH'} dose`, value: acidMgL, unit: 'mg/L', digits: 0 },
    },
  });
}
