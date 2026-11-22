/**
 * Coagulation / flocculation. Ref: knowledge/chemistry/coagulation_flocculation.md
 *
 * Stoichiometry (documented, standard):
 *   Al2(SO4)3·14H2O + 6HCO3− → 2Al(OH)3(s) + 3SO4²− + 6CO2 + 14H2O   → Cb −6 eq per mol alum
 *   FeCl3 + 3HCO3− → Fe(OH)3(s) + 3Cl− + 3CO2                          → Cb −3 eq per mol FeCl3
 *   PAC (Al basicity B): Cb −3(1−B) eq per mol Al
 * HCO3− → CO2 leaves C_T unchanged (closed system); pH is then re-solved by charge balance.
 * The coagulant metal is partitioned between fresh M(OH)3(am) and dissolved species inside the charge balance
 * (solubility.ts coagSolubility): an overdose beyond the alkalinity leaves Al/Fe dissolved instead of driving pH lower.
 *
 * Destabilisation efficiency E(x, pH) — GAME MODEL (semi-empirical, shape follows the classic four-zone
 * dose/colloid behaviour: under-dose, charge neutralisation, restabilisation, sweep floc):
 *   x = coagulant metal dose / optimum dose (mmol/L basis)
 *   E_cn(x) = (1 − e^(−3x)) · exp(−(max(0, x − 1.2))²)
 *   E_sw(x) = 0.95 · (1 − e^(−max(0, x − 2.5)/1.5))
 *   E = max(E_cn, E_sw) · f_pH
 */
import { Stream, cloneStream, poolMass } from '../core/stream';
import { MW, eqL_to_mgCaCO3, mgL_to_molL } from '../core/units';
import { Note, ProcessResult, result } from '../treatment/types';
import { adjustPH, equilibrate } from './acidBase';
import { REAGENTS } from './neutralisation';
import { coagSolubility } from './solubility';

export type Coagulant = 'alum' | 'ferric' | 'pac';

export interface CoagulantSpec {
  label: string;
  /** product molar mass for dose conversion; PAC uses Al content instead */
  mw: number;
  /** mol coagulant metal per mol product */
  metalPerMol: number;
  /** eq strong-base consumed per mol metal */
  baseEqPerMetal: number;
  /** relative charge-neutralisation efficiency per mol metal (GAME MODEL) */
  efficiency: number;
  /** pH window of good performance */
  pHmin: number;
  pHmax: number;
  /** RM/kg product (for OPEX display) */
  priceRMkg: number;
}

/** verify: PAC Al content 9 % w/w (≈17 % Al2O3), basicity 0.7 */
export const PAC_AL_FRACTION = 0.09;
export const PAC_BASICITY = 0.7;

export const COAGULANTS: Record<Coagulant, CoagulantSpec> = {
  alum: { label: 'Alum (Al₂(SO₄)₃·14H₂O)', mw: MW.alum, metalPerMol: 2, baseEqPerMetal: 3, efficiency: 1.0, pHmin: 5.8, pHmax: 7.5, priceRMkg: 1.2 },
  ferric: { label: 'Ferric chloride (FeCl₃)', mw: MW.FeCl3, metalPerMol: 1, baseEqPerMetal: 3, efficiency: 1.0, pHmin: 4.5, pHmax: 10.0, priceRMkg: 1.8 },
  pac: { label: 'PAC (polyaluminium chloride)', mw: MW.Al / PAC_AL_FRACTION, metalPerMol: 1, baseEqPerMetal: 3 * (1 - PAC_BASICITY), efficiency: 1.3, pHmin: 5.5, pHmax: 8.5, priceRMkg: 2.0 },
};

/**
 * Optimum coagulant metal dose, mmol/L. GAME MODEL: proportional to the destabilisable particle load
 * (colloids, unflocculated precipitates, particulate organics). Calibrated so 100 mg/L colloids ≈ 125 mg/L alum.
 */
export function optimumMetalDose_mmol(s: Stream, c: Coagulant): number {
  const load = 0.004 * s.colloid + 0.0015 * poolMass(s, 'precipitate') + 0.002 * poolMass(s, 'organic') + 0.004 * s.OGemulsified;
  return (0.02 + load) / COAGULANTS[c].efficiency;
}

export function destabilisation(x: number, pHfactor: number): number {
  const cn = (1 - Math.exp(-3 * x)) * Math.exp(-Math.pow(Math.max(0, x - 1.2), 2));
  const sw = 0.95 * (1 - Math.exp(-Math.max(0, x - 2.5) / 1.5));
  return Math.max(cn, sw) * pHfactor;
}

export function pHFactor(pH: number, c: Coagulant): number {
  const { pHmin, pHmax } = COAGULANTS[c];
  if (pH < pHmin) return Math.exp(-Math.pow((pHmin - pH) / 0.8, 2));
  if (pH > pHmax) return Math.exp(-Math.pow((pH - pHmax) / 0.8, 2));
  return 1;
}

export interface CoagulationInput {
  coagulant: Coagulant;
  /** dose, mg/L of product */
  dose_mgL: number;
  /** flocculation time, min */
  flocTime_min: number;
  /** optional pH control in the flash-mix tank (NaOH/H2SO4 trim to this set-point after coagulant dosing); 0 = off */
  pHset?: number;
  /** anionic polyacrylamide flocculant aid, mg/L active (0 = none) */
  polymer_mgL?: number;
}

/** verify: anionic PAM optimum ≈ 0.5–2 mg/L for metal-hydroxide / coagulant floc; price RM/kg (GAME MODEL) */
// verify: polymer-aided hydroxide/coagulant floc typically settles at ≈ 1.5–4 m/h (chemistry review) → gain 0.4 gives ≈ 4.2 m/h
// at the optimum with full flocculation time. Polymer mass itself (≈ 1 mg/L) is neglected in the solids balance.
export const POLYMER = { optimum_mgL: 1.0, maxGain: 0.4, bridging: 0.8, priceRMkg: 14, label: 'Anionic polymer (PAM)' };

/**
 * Polymer bridging effectiveness (GAME MODEL): rises to 1 at the optimum dose and falls off when overdosed
 * (excess polymer re-stabilises / carries over): eff = r·e^(1 − r), r = dose/optimum.
 */
export function polymerEffect(dose_mgL: number): number {
  if (!(dose_mgL > 0)) return 0;
  const r = dose_mgL / POLYMER.optimum_mgL;
  return r * Math.exp(1 - r);
}

export function coagulate(s: Stream, p: CoagulationInput): ProcessResult {
  const spec = COAGULANTS[p.coagulant];
  const notes: Note[] = [];
  const molProduct = mgL_to_molL(p.dose_mgL, spec.mw);
  const molMetal = molProduct * spec.metalPerMol;
  const optimum = optimumMetalDose_mmol(s, p.coagulant);
  const x = (molMetal * 1000) / optimum;

  const dosed = cloneStream(s);
  if (p.coagulant === 'alum') {
    // Al2(SO4)3: Al precipitates as Al(OH)3, its 3 SO4 2− per mol stay in solution (tracked as sulfate, not as ΔCb)
    dosed.SO4T = (dosed.SO4T ?? 0) + 3 * molProduct;
  } else {
    // FeCl3 / PAC (chloride, a strong anion): ΔCb = −(eq consumed per metal)
    dosed.Cb -= molMetal * spec.baseEqPerMetal;
  }
  const metalMgL = molMetal * 1000 * (p.coagulant === 'ferric' ? MW.Fe : MW.Al);
  if (p.coagulant === 'ferric') dosed.feSolid += metalMgL;
  else dosed.alSolid += metalMgL;
  let out = equilibrate(dosed);
  let trimSO4 = 0;
  const chemicals = [{ name: spec.label, kgPerDay: (s.Q * p.dose_mgL) / 1000, priceRMkg: spec.priceRMkg }];
  if ((p.polymer_mgL ?? 0) > 0) chemicals.push({ name: POLYMER.label, kgPerDay: (s.Q * (p.polymer_mgL ?? 0)) / 1000, priceRMkg: POLYMER.priceRMkg });
  // Al / Fe left dissolved: equilibrate() partitions the coagulant metal against fresh M(OH)3(am) inside the charge
  // balance (solubility.ts coagSolubility), so the pH, the dissolved Al/Fe and the alkalinity they release or consume
  // are solved together — and re-solved by every later unit that changes the pH.
  if (p.pHset && p.pHset > 0) {
    // pH controller holds the set-point: one exact net dose of a single reagent
    const adj = adjustPH(out, p.pHset, 'NaOH');
    out = equilibrate(adj.stream);
    const r = REAGENTS[adj.reagent];
    if (adj.reagent === 'H2SO4') trimSO4 += adj.mol;
    if (adj.mol > 0) chemicals.push({ name: r.label, kgPerDay: (s.Q * adj.mol * r.mw * 1000) / 1000, priceRMkg: r.priceRMkg });
  }
  if (p.coagulant !== 'ferric' && out.alDissolved > 0.5)
    notes.push({ level: 'warn', code: 'coag.aluminate', text: `${out.alDissolved.toFixed(1)} mg/L Al stays dissolved at pH ${out.pH.toFixed(2)} — aluminium hydroxide is soluble outside pH ≈ 5.5–8.` });

  const fpH = pHFactor(out.pH, p.coagulant);
  if (p.coagulant === 'ferric' && (out.feDissolved ?? 0) > 0.5)
    notes.push({ level: 'warn', code: 'coag.ferricDissolved', text: `${(out.feDissolved ?? 0).toFixed(1)} mg/L Fe stays dissolved at pH ${out.pH.toFixed(2)} — the dose exceeded the alkalinity and ferric hydroxide dissolves below pH ≈ 3.` });
  const solidFrac = p.coagulant === 'ferric'
    ? out.feSolid + (out.feDissolved ?? 0) > 0 ? out.feSolid / (out.feSolid + (out.feDissolved ?? 0)) : 1
    : out.alSolid + out.alDissolved > 0 ? out.alSolid / (out.alSolid + out.alDissolved) : 1; // dissolved coagulant metal forms no floc
  const E = destabilisation(x * solidFrac, fpH);
  // floc growth with flocculation time (GAME MODEL: first-order approach, τ = 8 min)
  const growth = 1 - Math.exp(-p.flocTime_min / 8);
  // polymer bridging grows floc further (GAME MODEL): × (1 + 0.4·eff) → ≈ 4.2 m/h at the optimum with full flocculation time
  const polyEff = polymerEffect(p.polymer_mgL ?? 0);
  const vFloc = (0.3 + 2.7 * growth) * (1 + POLYMER.maxGain * polyEff);

  const moved = out.colloid * E;
  out.colloid -= moved;
  out.floc += moved;
  out.v50.floc = vFloc;
  out.v50.alFloc = vFloc;
  out.v50.feFloc = vFloc * 1.15;
  out.v50.precipitate = out.v50.precipitate * (1 - E) + vFloc * E;
  // anionic polymer bridges hydroxide precipitate directly (no charge neutralisation needed). verify: bridging share 0.8
  if (polyEff > 0) out.v50.precipitate += (vFloc - out.v50.precipitate) * POLYMER.bridging * Math.min(1, polyEff) * (1 - E);
  out.v50.organic = out.v50.organic * (1 - E) + vFloc * E;
  // emulsion breaking (GAME MODEL): 70 % of E with coagulant alone, up to 92 % of E with polymer bridging. The broken
  // oil is enmeshed in floc of near-neutral density (OGfloc): it barely settles or rises — bubble attachment (DAF) floats
  // it (process review 2026-11-22; chemically assisted DAF practice, verify)
  const broken = out.OGemulsified * (0.7 + 0.22 * Math.min(1, polyEff)) * E;
  out.OGemulsified -= broken;
  out.OGfloc = (out.OGfloc ?? 0) + broken;

  // alkalinity actually consumed: stoichiometric, less what the metal still dissolved did not use (relative to the
  // neutral solid: Al3+ +3, aluminate −1 …) — an overdose cannot consume more alkalinity than the water has
  const alDissZ = out.alDissolved > 0 ? mgL_to_molL(out.alDissolved, MW.Al) * coagSolubility('Al', out.pH).zbar : 0;
  const feDissZ = (out.feDissolved ?? 0) > 0 ? mgL_to_molL(out.feDissolved ?? 0, MW.Fe) * coagSolubility('Fe', out.pH).zbar : 0;
  const alkUsed = eqL_to_mgCaCO3(molMetal * spec.baseEqPerMetal - alDissZ - feDissZ);
  if (x < 0.6) notes.push({ level: 'warn', code: 'coag.underdose', text: `Under-dosed: ${p.dose_mgL.toFixed(0)} mg/L is ${(x * 100).toFixed(0)} % of the estimated optimum — colloids stay stable.` });
  else if (x > 1.6 && x < 3) notes.push({ level: 'warn', code: 'coag.restabilise', text: `Over-dosed into the restabilisation zone (${x.toFixed(1)}× optimum): particle charge reversed.` });
  else if (x >= 3) notes.push({ level: 'info', code: 'coag.sweep', text: `Sweep-floc regime (${x.toFixed(1)}× optimum): good removal but high sludge and chemical cost.` });
  if (fpH < 0.8) notes.push({ level: 'warn', code: 'coag.pH', text: `pH ${out.pH.toFixed(2)} is outside the ${spec.label} window (${spec.pHmin}–${spec.pHmax}).` });
  // metals re-dissolved by the coagulant's acidity (precipitation undone before the clarifier)
  for (const m of ['Ni', 'Cu', 'Zn', 'Cr'] as const) {
    const back = out.dissolved[m] - s.dissolved[m];
    if (back > 0.2 && back > 0.1 * (s.dissolved[m] + s.precipitated[m]))
      notes.push({
        level: 'error',
        code: `coag.redissolve.${m}`,
        text:
          `${back.toFixed(1)} mg/L ${m} RE-DISSOLVED: the coagulant lowered the pH from ${s.pH.toFixed(2)} to ${out.pH.toFixed(2)}, where ${m}(OH)₂ is soluble. ` +
          (p.coagulant === 'ferric' || s.pH <= COAGULANTS[p.coagulant].pHmax
            ? `Set this unit's pH control set-point to ${s.pH.toFixed(1)}.`
            : `Aluminium coagulants dissolve as aluminate above pH ≈ ${COAGULANTS[p.coagulant].pHmax} — switch to ferric with pH control at ${s.pH.toFixed(1)}, use polymer alone, or settle the hydroxide before any acidic coagulant.`),
      });
  }
  if (out.pH < s.pH - 1) notes.push({ level: 'warn', code: 'coag.alkalinity', text: `Coagulant consumed ${alkUsed.toFixed(0)} mg/L alkalinity as CaCO₃; pH fell from ${s.pH.toFixed(2)} to ${out.pH.toFixed(2)}.` });

  return result(out, {
    produced: { [p.coagulant === 'ferric' ? 'Fe' : 'Al']: (s.Q * metalMgL) / 1000, SO4: (s.Q * ((p.coagulant === 'alum' ? 3 * molProduct : 0) + trimSO4) * MW.SO4 * 1000) / 1000 },
    chemicals,
    notes,
    calcs: {
      optimum: { label: 'Estimated optimum dose', value: (optimum / 1000) * (spec.mw / spec.metalPerMol) * 1000, unit: 'mg/L', digits: 0 },
      ratio: { label: 'Dose / optimum', value: x, unit: '×', digits: 2 },
      destab: { label: 'Destabilisation', value: E * 100, unit: '%', digits: 0 },
      alk: { label: 'Alkalinity consumed', value: alkUsed, unit: 'mg/L CaCO₃', digits: 0 },
      pH: { label: 'pH after dosing', value: out.pH, unit: '', digits: 2 },
      vFloc: { label: 'Floc settling velocity (v₅₀)', value: vFloc, unit: 'm/h', digits: 2 },
      vPrec: { label: 'Precipitate settling velocity (v₅₀)', value: out.v50.precipitate, unit: 'm/h', digits: 2 },
      ...(polyEff > 0 ? { poly: { label: 'Polymer effectiveness', value: polyEff * 100, unit: '%', digits: 0 } } : {}),
    },
  });
}
