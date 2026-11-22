/**
 * Sulfide precipitation (NaHS). Ref: knowledge/chemistry/sulfide_precipitation.md
 * M²⁺ + HS⁻ → MS(s) + H⁺; allocation in order of increasing solubility (CuS < ZnS < NiS); breaks metal complexes;
 * excess sulfide assumed oxidised to sulfate downstream (GAME MODEL). Precipitate is colloidal (needs coagulation).
 */
import { Metal, Stream, cloneStream, poolMass, zeroMetals } from '../core/stream';
import { MW, mgL_to_molL, molL_to_mgL } from '../core/units';
import { equilibrate } from './acidBase';
import { Note, ProcessResult, result } from '../treatment/types';

export const NAHS_MW = 56.06;
/** Ksp (25 °C) of the metal sulfides, verify (published values spread widely) */
export const SULFIDE_KSP: Partial<Record<Metal, number>> = { Cu: 6e-37, Zn: 2e-25, Ni: 3e-19 };
/** H2S pKa values (pK2 13.9: the basis of the Ksp set above) */
export const H2S_PK1 = 7.0;
export const H2S_PK2 = 13.9;
/**
 * Complex breaking for the weak ligands of electroless baths (citrate, lactate, gluconate, ammonia): 98 % of the complexed
 * metal is broken when sulfide is in excess, down to an achievable residual of 0.15 mg/L per metal (verify; field data
 * 0.1–0.5 mg/L Ni). Ni/Zn–EDTA is NOT broken by sulfide (conditional log K ≈ 18): not modelled — EN baths use weak ligands.
 */
export const COMPLEX_BREAK = 0.98;
export const COMPLEX_RESIDUAL_MGL = 0.15;
/** time constant of hydroxide → sulfide conversion of existing M(OH)2 solids, min (GAME MODEL, verify) */
export const HYDROXIDE_CONV_TAU_MIN = 20;
/** at most half of the hydroxide solids convert within a normal reaction time (surface conversion), GAME MODEL */
export const HYDROXIDE_CONV_MAX = 0.5;
/** settling velocity of fresh metal-sulfide precipitate, m/h (colloidal), verify */
export const SULFIDE_V50 = 0.05;
export const NAHS_PRICE_RMKG = 3.5;

const ORDER: Metal[] = ['Cu', 'Zn', 'Ni'];

/** Moles of sulfide the metals in a stream can take (free dissolved + complexed Ni, Cu, Zn), mol/L. */
export function sulfideDemand_molL(s: Stream): number {
  return ORDER.reduce((a, m) => a + mgL_to_molL(s.dissolved[m] + (s.complexed?.[m] ?? 0), MW[m]), 0);
}

export function precipitateSulfide(s: Stream, p: { dose_mgL: number; volume_m3: number }): ProcessResult {
  const notes: Note[] = [];
  const out = cloneStream(s);
  const cxMap = { ...(s.complexed ?? zeroMetals()) };
  const sfMap = { ...(s.sulfide ?? zeroMetals()) };
  out.complexed = cxMap;
  out.sulfide = sfMap;
  const S = mgL_to_molL(Math.max(0, p.dose_mgL), NAHS_MW);
  const demand = sulfideDemand_molL(s);
  let left = S;
  const taken: Partial<Record<Metal, number>> = {};
  for (const m of ORDER) {
    // free metal first, then the complexed share (broken at COMPLEX_BREAK efficiency)
    const free = mgL_to_molL(out.dissolved[m], MW[m]);
    // breakable share: 98 %, but never below the achievable residual
    const cxBreakable = Math.max(0, Math.min(cxMap[m] * COMPLEX_BREAK, cxMap[m] - COMPLEX_RESIDUAL_MGL));
    const cx = mgL_to_molL(cxBreakable, MW[m]);
    const xFree = Math.min(free, left);
    left -= xFree;
    const xCx = Math.min(cx, left);
    left -= xCx;
    const mg = molL_to_mgL(xFree, MW[m]);
    const mgCx = molL_to_mgL(xCx, MW[m]);
    out.dissolved[m] -= mg;
    cxMap[m] -= mgCx;
    sfMap[m] += mg + mgCx;
    taken[m] = mg + mgCx;
  }
  // remaining sulfide converts existing hydroxide solids (M(OH)2 is unstable against MS with excess HS−): a GAME MODEL
  // surface-conversion fraction that grows with reaction time — sulfide dosed on unclarified water pays for the solids
  const hrtMin = (p.volume_m3 / Math.max(s.Q, 1e-9)) * 1440;
  const convFrac = HYDROXIDE_CONV_MAX * (1 - Math.exp(-hrtMin / HYDROXIDE_CONV_TAU_MIN));
  let convertedMol = 0;
  for (const m of ORDER) {
    if (left <= 0) break;
    const solid = mgL_to_molL(out.precipitated[m], MW[m]) * convFrac;
    const x = Math.min(solid, left);
    left -= x;
    convertedMol += x;
    const mg = molL_to_mgL(x, MW[m]);
    out.precipitated[m] -= mg;
    sfMap[m] += mg;
    taken[m] = (taken[m] ?? 0) + mg;
  }
  const excess = Math.max(0, left);
  // charge (process review 2026-11-22):
  //  • Na+ +1 eq for every mol NaHS;
  //  • free metal: M2+ leaves the metal charge balance (−2) → net −1 eq/mol (the H+ released) — automatic in equilibrate;
  //  • complexed metal carries no charge in the model: the freed ligand keeps the metal's former 2 eq as an anion → −2 eq;
  //  • hydroxide converted: M(OH)2 + HS− → MS + OH− + H2O → the OH− (+1 eq) offsets the H+ that free metal would release;
  //  • excess HS− stays as residual sulfide (weak acid, outside the strong-ion balance): pH-neutral above pH 8.
  const cxMolBroken = ORDER.reduce((a, m) => a + mgL_to_molL((s.complexed?.[m] ?? 0) - cxMap[m], MW[m]), 0);
  out.Cb += S - excess - 2 * cxMolBroken + 2 * convertedMol;
  // excess NaHS: Na+ is balanced by the HS− anion it came with (pH-neutral above ~pH 8; GAME MODEL: H2S formation below pKa1 not counted)
  out.sulfideS = (out.sulfideS ?? 0) + excess;
  // fresh sulfide is colloidal: precipitate-pool v50 becomes the mass-weighted mix of old precipitate and new sulfide
  const newSulfideMass = ORDER.reduce((a, m) => a + ((taken[m] ?? 0) * (MW[m] + 32.06)) / MW[m], 0);
  const oldMass = poolMass(s, 'precipitate');
  out.v50.precipitate = oldMass + newSulfideMass > 0 ? (s.v50.precipitate * oldMass + SULFIDE_V50 * newSulfideMass) / (oldMass + newSulfideMass) : s.v50.precipitate;
  const eq = equilibrate(out);

  // residual (Ksp-limited) dissolved metal where sulfide is in excess: effectively nil — reported, not applied
  const H = Math.pow(10, -eq.pH);
  const a2 = Math.pow(10, -H2S_PK1 - H2S_PK2) / (H * H + Math.pow(10, -H2S_PK1) * H + Math.pow(10, -H2S_PK1 - H2S_PK2));
  void a2;
  const h2sFrac = H / (H + Math.pow(10, -H2S_PK1));
  const ratio = demand > 0 ? S / demand : Infinity;
  if (excess > 0 && eq.pH < 8) notes.push({ level: 'warn', code: 'sulf.h2s', text: `Excess sulfide at pH ${eq.pH.toFixed(1)}: ${(100 * h2sFrac).toFixed(0)} % of it is H₂S — toxic off-gas. Keep pH ≥ 8 in the sulfide tank and ventilate.` });
  if (excess * 32060 > 0.5) notes.push({ level: 'warn', code: 'sulf.residual', text: `${(excess * 32060).toFixed(1)} mg/L sulfide left over — the discharge limit is 0.5 mg/L. Ferric coagulant downstream scavenges it (FeS + S⁰) and aeration oxidises it; otherwise trim the dose.` });
  if (demand > 0 && ratio > 1.5) notes.push({ level: 'info', code: 'sulf.over', text: `Dose is ${ratio.toFixed(1)}× stoichiometric — the excess is wasted reagent and residual sulfide (odour, toxicity). 1.1–1.3× is typical.` });
  if (demand > 0 && ratio < 1) {
    const left2 = ORDER.filter((m) => eq.dissolved[m] + (eq.complexed?.[m] ?? 0) > 0.05);
    notes.push({ level: 'warn', code: 'sulf.under', text: `Dose covers only ${(100 * ratio).toFixed(0)} % of the sulfide demand — ${left2.join(', ') || 'some metal'} stays in solution (nickel sulfide forms last).` });
  }
  if (newSulfideMass > 1) notes.push({ level: 'info', code: 'sulf.fines', text: 'Fresh metal sulfide is colloidal (v₅₀ ≈ 0.05 m/h): coagulate and flocculate it (coagulant + polymer) before the clarifier.' });
  const hrt = (p.volume_m3 / Math.max(s.Q, 1e-9)) * 1440;
  if (hrt < 10) notes.push({ level: 'warn', code: 'sulf.hrt', text: `Reaction time ${hrt.toFixed(0)} min is short — allow 15–30 min for sulfide to break the complexes and precipitate.` });
  const kg = (s.Q * Math.max(0, p.dose_mgL)) / 1000;
  return result(eq, {
    notes,
    chemicals: kg > 0 ? [{ name: 'Sodium hydrosulfide (NaHS)', kgPerDay: kg, priceRMkg: NAHS_PRICE_RMKG }] : [],
    energy_kWhd: p.volume_m3 * 0.03 * 24,
    calcs: {
      demand: { label: 'Sulfide demand (Ni+Cu+Zn, free + complexed)', value: demand * 1000, unit: 'mmol/L', digits: 3 },
      ratio: { label: 'Dose ÷ stoichiometric', value: Number.isFinite(ratio) ? ratio : 0, unit: '×', digits: 2 },
      bound: { label: 'Metal bound as sulfide', value: ORDER.reduce((a, m) => a + (taken[m] ?? 0), 0), unit: 'mg/L', digits: 2 },
      cxLeft: { label: 'Complexed metal remaining', value: ORDER.reduce((a, m) => a + (eq.complexed?.[m] ?? 0), 0), unit: 'mg/L', digits: 3 },
      excess: { label: 'Excess sulfide (as S)', value: excess * 32060, unit: 'mg/L', digits: 1 },
      conv: { label: 'Hydroxide solids converted to sulfide', value: convertedMol * 1000, unit: 'mmol/L', digits: 3 },
      h2s: { label: 'H₂S share of excess sulfide', value: excess > 0 ? 100 * h2sFrac : 0, unit: '%', digits: 0 },
      hrt: { label: 'Reaction time', value: hrt, unit: 'min', digits: 0 },
    },
  });
}

void SULFIDE_KSP;
