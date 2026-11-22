/**
 * Chelating ion exchange (iminodiacetate resin, Na form) polishing dissolved heavy metals.
 * Ref: knowledge/chemistry/ion_exchange.md
 *
 * GAME MODEL:
 *  - takes free dissolved Cu, Ni, Zn, Cr(III) (selectivity Cu > Ni > Zn > Cr(III) ≫ Ca); complexed and particulate metal
 *    pass straight through (warned);
 *  - 2 Na⁺ released per M²⁺ taken (Cb rises; the salt goes to TDS);
 *  - operating capacity 1.0 eq/L resin at 10 BV/h, falling 3 %/BV·h above that (kinetics), floor 0.5 eq/L (verify);
 *  - leakage fraction 0.5 % at 10 BV/h, proportional to the service flow rate, ×5 below pH 4 (H⁺ competes) and a 0.01 mg/L
 *    floor per metal (verify);
 *  - regeneration: HCl at 2.5× and NaOH at 1.5× the equivalents removed; 4 bed volumes of regenerant + rinse per cycle
 *    leave through the reject port carrying all the metal (the eluate), with the spent NaCl.
 */
import { METALS, Metal, Stream, cloneStream, emptyStream, tss } from '../core/stream';
import { MW, mgL_to_molL } from '../core/units';
import { equilibrate } from './acidBase';
import { Note, ProcessResult, result } from '../treatment/types';

export const IX = {
  capacityEqL: 1.0,
  refBVh: 10,
  leakRef: 0.005,
  leakFloor_mgL: 0.01,
  hclRatio: 2.5,
  naohRatio: 1.5,
  regenBV: 4,
  hclRMkg: 0.9, // as 100 % HCl (supplied 33 %), verify
  naohRMkg: 2.2,
};

const CHARGE: Record<Metal, number> = { Ni: 2, Cu: 2, Zn: 2, Cr: 3 };

export function ionExchange(s: Stream, p: { resin_m3: number }): ProcessResult {
  const notes: Note[] = [];
  const Vr = Math.max(p.resin_m3, 0.01);
  const qh = s.Q / 24;
  const bvh = qh / Vr;
  const capacity = Math.max(0.5, IX.capacityEqL * (1 - 0.03 * Math.max(0, bvh - IX.refBVh)));
  const leak = Math.min(0.2, IX.leakRef * (bvh / IX.refBVh) * (s.pH < 4 ? 5 : 1));
  const out = cloneStream(s);
  let eqL = 0;
  const removedMg: Record<Metal, number> = { Ni: 0, Cu: 0, Zn: 0, Cr: 0 };
  for (const m of METALS) {
    const c = s.dissolved[m];
    const left = Math.min(c, Math.max(IX.leakFloor_mgL, c * leak));
    removedMg[m] = c - left;
    out.dissolved[m] = left;
    eqL += mgL_to_molL(removedMg[m], MW[m]) * CHARGE[m];
  }
  // Na+ released for every equivalent taken: strong cation into the water (its mass to TDS)
  out.Cb += eqL;
  out.tds = (out.tds ?? 0) + eqL * MW.Na * 1000;
  const eqD = eqL * s.Q * 1000; // eq/d
  const runH = eqD > 0 ? (capacity * Vr * 1000) / (eqD / 24) : Infinity;
  const cycles = Number.isFinite(runH) ? Math.max(1 / 7, 24 / runH) : 0; // at least weekly (bed hygiene)
  const regenM3 = cycles * IX.regenBV * Vr;
  const hclEq = eqD * IX.hclRatio;
  const naohEq = eqD * IX.naohRatio;
  // eluate: all the metal + the spent regenerant salts, at the regenerant volume (extra water brought in)
  const rej = emptyStream(regenM3);
  rej.T = s.T;
  const k = regenM3 > 0 ? s.Q / regenM3 : 0;
  for (const m of METALS) rej.dissolved[m] = removedMg[m] * k;
  // charge: metals carry their own charge; Cl⁻ from HCl, Na⁺ from NaOH; the Na⁺ released to the water stays there
  rej.Cb = regenM3 > 0 ? (naohEq - hclEq) / (regenM3 * 1000) : 0;
  rej.tds = regenM3 > 0 ? ((hclEq * MW.Cl + naohEq * MW.Na) * 1000) / (regenM3 * 1000) : 0;
  const reject = regenM3 > 0 ? equilibrate(rej) : rej;
  if (runH < 8) notes.push({ level: 'warn', code: 'ix.short', text: `Each column only runs ${runH.toFixed(1)} h before it is exhausted — IX is for polishing (a few mg/L). Precipitate the bulk metal first or add resin.` });
  if (bvh > 30) notes.push({ level: 'warn', code: 'ix.bvh', text: `Service flow ${bvh.toFixed(0)} BV/h is above the 8–20 BV/h a chelating resin needs — leakage rises; add resin volume.` });
  if (s.pH < 4) notes.push({ level: 'warn', code: 'ix.acid', text: `Feed pH ${s.pH.toFixed(1)}: H⁺ competes for the chelating sites — run at pH 4–7.` });
  if (s.pH > 8.5) notes.push({ level: 'info', code: 'ix.alk', text: `At pH ${s.pH.toFixed(1)} most metal is already hydroxide particles that the resin cannot take — filter well before IX, or polish at pH 5–7.` });
  const cx = METALS.reduce((a, m) => a + (s.complexed?.[m] ?? 0), 0);
  if (cx > 0.1) notes.push({ level: 'warn', code: 'ix.complexed', text: `${cx.toFixed(1)} mg/L complexed metal passes the resin — the ligand holds it. Break the complex first (sulfide).` });
  if (tss(s) > 5) notes.push({ level: 'warn', code: 'ix.tss', text: `Feed suspended solids ${tss(s).toFixed(1)} mg/L blind the resin bed — sand-filter first (< 5 mg/L).` });
  const outEq = equilibrate(out);
  return result(outEq, {
    reject,
    produced: { Q: regenM3, TDS: (eqD * MW.Na + hclEq * MW.Cl + naohEq * MW.Na) / 1000 },
    notes,
    energy_kWhd: 0.03 * s.Q,
    chemicals: eqD > 0 ? [
      { name: 'Hydrochloric acid (IX regeneration, as 100 %)', kgPerDay: (hclEq * 36.46) / 1000, priceRMkg: IX.hclRMkg },
      { name: 'Caustic soda (IX conditioning)', kgPerDay: (naohEq * MW.NaOH) / 1000, priceRMkg: IX.naohRMkg },
    ] : [],
    calcs: {
      bvh: { label: 'Service flow rate', value: bvh, unit: 'BV/h', digits: 1 },
      cap: { label: 'Operating capacity', value: capacity, unit: 'eq/L resin', digits: 2 },
      run: { label: 'Run length per column', value: Number.isFinite(runH) ? runH : 0, unit: 'h', digits: 0 },
      leak: { label: 'Leakage (fraction of feed metal)', value: leak * 100, unit: '%', digits: 2 },
      eluate: { label: 'Regenerant / eluate volume', value: regenM3, unit: 'm³/d', digits: 2 },
      load: { label: 'Metal load removed', value: eqD, unit: 'eq/d', digits: 1 },
    },
  });
}
