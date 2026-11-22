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
/** fraction of a metal complex broken per pass when sulfide is in excess (strong EDTA chelates resist), verify */
export const COMPLEX_BREAK = 0.98;
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
    const cx = mgL_to_molL(cxMap[m], MW[m]) * COMPLEX_BREAK;
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
  const excess = Math.max(0, left);
  // charge: Na+ added for every mol NaHS; metal removed from solution leaves the metal charge balance (H+ released)
  out.Cb += S;
  // excess sulfide: assumed oxidised to sulfate downstream (GAME MODEL; keeps S in the balance, acid-forming like HS− + 2O2)
  out.SO4T = (out.SO4T ?? 0) + excess;
  // fresh sulfide is colloidal: precipitate-pool v50 becomes the mass-weighted mix of old precipitate and new sulfide
  const newSulfideMass = ORDER.reduce((a, m) => a + ((taken[m] ?? 0) * (MW[m] + 32.06)) / MW[m], 0);
  const oldMass = poolMass(s, 'precipitate');
  out.v50.precipitate = oldMass + newSulfideMass > 0 ? (s.v50.precipitate * oldMass + SULFIDE_V50 * newSulfideMass) / (oldMass + newSulfideMass) : s.v50.precipitate;
  const eq = equilibrate(out);

  // residual (Ksp-limited) dissolved metal where sulfide is in excess: effectively nil — reported, not applied
  const H = Math.pow(10, -eq.pH);
  const a2 = Math.pow(10, -H2S_PK1 - H2S_PK2) / (H * H + Math.pow(10, -H2S_PK1) * H + Math.pow(10, -H2S_PK1 - H2S_PK2));
  const s2 = excess * a2;
  const h2sFrac = H / (H + Math.pow(10, -H2S_PK1));
  const ratio = demand > 0 ? S / demand : Infinity;
  if (excess > 0 && eq.pH < 8) notes.push({ level: 'warn', code: 'sulf.h2s', text: `Excess sulfide at pH ${eq.pH.toFixed(1)}: ${(100 * h2sFrac).toFixed(0)} % of it is H₂S — toxic off-gas. Keep pH ≥ 8 in the sulfide tank and ventilate.` });
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
    energy_kWhd: p.volume_m3 * 0.01 * 24,
    produced: { SO4: (s.Q * excess * MW.SO4 * 1000) / 1000 },
    calcs: {
      demand: { label: 'Sulfide demand (Ni+Cu+Zn, free + complexed)', value: demand * 1000, unit: 'mmol/L', digits: 3 },
      ratio: { label: 'Dose ÷ stoichiometric', value: Number.isFinite(ratio) ? ratio : 0, unit: '×', digits: 2 },
      bound: { label: 'Metal bound as sulfide', value: ORDER.reduce((a, m) => a + (taken[m] ?? 0), 0), unit: 'mg/L', digits: 2 },
      cxLeft: { label: 'Complexed metal remaining', value: ORDER.reduce((a, m) => a + (eq.complexed?.[m] ?? 0), 0), unit: 'mg/L', digits: 3 },
      excess: { label: 'Excess sulfide (as S)', value: excess * 32060, unit: 'mg/L', digits: 1 },
      s2: { label: 'Free S²⁻ (excess · α₂)', value: s2 * 32060, unit: 'mg/L', digits: 6 },
      h2s: { label: 'H₂S share of excess sulfide', value: excess > 0 ? 100 * h2sFrac : 0, unit: '%', digits: 0 },
      hrt: { label: 'Reaction time', value: hrt, unit: 'min', digits: 0 },
    },
  });
}

void SULFIDE_KSP;
