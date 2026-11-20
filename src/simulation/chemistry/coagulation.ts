/**
 * Coagulation / flocculation. Ref: knowledge/chemistry/coagulation_flocculation.md
 *
 * Stoichiometry (documented, standard):
 *   Al2(SO4)3·14H2O + 6HCO3− → 2Al(OH)3(s) + 3SO4²− + 6CO2 + 14H2O   → Cb −6 eq per mol alum
 *   FeCl3 + 3HCO3− → Fe(OH)3(s) + 3Cl− + 3CO2                          → Cb −3 eq per mol FeCl3
 *   PAC (Al basicity B): Cb −3(1−B) eq per mol Al
 * The CO2 formed stays in C_T (closed system); pH is then re-solved by charge balance.
 * Al and Fe are assumed to precipitate completely as hydroxide (valid near their solubility minima, pH ≈ 5.5–8).
 *
 * Destabilisation efficiency E(x, pH) — GAME MODEL (semi-empirical, shape follows the classic four-zone
 * dose/colloid behaviour: under-dose, charge neutralisation, restabilisation, sweep floc):
 *   x = coagulant metal dose / optimum dose (mmol/L basis)
 *   E_cn(x) = (1 − e^(−3x)) · exp(−(max(0, x − 1.2))²)
 *   E_sw(x) = 0.95 · (1 − e^(−max(0, x − 2.5)/1.5))
 *   E = max(E_cn, E_sw) · f_pH
 */
import { Stream, cloneStream, poolMass } from '../core/stream';
import { MW, eqL_to_mgCaCO3, mgL_to_molL, molL_to_mgL } from '../core/units';
import { Note, ProcessResult, result } from '../treatment/types';
import { adjustPH, equilibrate } from './acidBase';
import { REAGENTS } from './neutralisation';

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
  const load = 0.004 * s.colloid + 0.0015 * poolMass(s, 'precipitate') + 0.002 * poolMass(s, 'organic') + 0.0005 * s.OGemulsified;
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
  if (p.pHset && p.pHset > 0) {
    const adj = adjustPH(out, p.pHset, 'NaOH');
    out = equilibrate(adj.stream);
    const r = REAGENTS[adj.reagent];
    if (adj.reagent === 'H2SO4') trimSO4 = adj.mol;
    chemicals.push({ name: r.label, kgPerDay: (s.Q * adj.mol * r.mw * 1000) / 1000, priceRMkg: r.priceRMkg });
  }

  // Al(OH)3(am) solubility (verify: log*Ks0 = 10.8; Al(OH)4− formation log*K = −12.1 relative to the solid; MWH Ch. 9 /
  // Stumm & Morgan Fig. 6.6). Dissolved Al3+ adds +3 eq and aluminate −1 eq relative to the neutral solid.
  if (p.coagulant !== 'ferric') {
    for (let i = 0; i < 4; i++) {
      const totalAl = out.alSolid + out.alDissolved;
      const al3 = Math.pow(10, 10.8 - 3 * out.pH);
      const alO4 = Math.pow(10, -12.1 + out.pH);
      const solMgL = molL_to_mgL(al3 + alO4, MW.Al);
      const diss = Math.min(totalAl, solMgL);
      const delta = diss - out.alDissolved;
      if (Math.abs(delta) < 1e-6) break;
      const zbar = (3 * al3 - alO4) / (al3 + alO4);
      const t = cloneStream(out);
      t.alDissolved = diss;
      t.alSolid = totalAl - diss;
      t.Cb += mgL_to_molL(delta, MW.Al) * zbar;
      out = equilibrate(t);
    }
    if (out.alDissolved > 0.5) notes.push({ level: 'warn', code: 'coag.aluminate', text: `${out.alDissolved.toFixed(1)} mg/L Al stays dissolved at pH ${out.pH.toFixed(2)} — aluminium hydroxide is soluble outside pH ≈ 5.5–8.` });
  }

  const fpH = pHFactor(out.pH, p.coagulant);
  const E = destabilisation(x, fpH);
  // floc growth with flocculation time (GAME MODEL: first-order approach, τ = 8 min)
  const growth = 1 - Math.exp(-p.flocTime_min / 8);
  const vFloc = 0.3 + 2.7 * growth;

  const moved = out.colloid * E;
  out.colloid -= moved;
  out.floc += moved;
  out.v50.floc = vFloc;
  out.v50.alFloc = vFloc;
  out.v50.feFloc = vFloc * 1.15;
  out.v50.precipitate = out.v50.precipitate * (1 - E) + vFloc * E;
  out.v50.organic = out.v50.organic * (1 - E) + vFloc * E;
  // emulsion breaking: destabilised emulsified oil becomes separable free oil (GAME MODEL, 70 % of E)
  const broken = out.OGemulsified * 0.7 * E;
  out.OGemulsified -= broken;
  out.OGfree += broken;

  const alkUsed = eqL_to_mgCaCO3(molMetal * spec.baseEqPerMetal);
  if (x < 0.6) notes.push({ level: 'warn', code: 'coag.underdose', text: `Under-dosed: ${p.dose_mgL.toFixed(0)} mg/L is ${(x * 100).toFixed(0)} % of the estimated optimum — colloids stay stable.` });
  else if (x > 1.6 && x < 3) notes.push({ level: 'warn', code: 'coag.restabilise', text: `Over-dosed into the restabilisation zone (${x.toFixed(1)}× optimum): particle charge reversed.` });
  else if (x >= 3) notes.push({ level: 'info', code: 'coag.sweep', text: `Sweep-floc regime (${x.toFixed(1)}× optimum): good removal but high sludge and chemical cost.` });
  if (fpH < 0.8) notes.push({ level: 'warn', code: 'coag.pH', text: `pH ${out.pH.toFixed(2)} is outside the ${spec.label} window (${spec.pHmin}–${spec.pHmax}).` });
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
    },
  });
}
