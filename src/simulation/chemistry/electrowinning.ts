/**
 * Electrowinning: plating dissolved Cu and Ni out of a concentrated liquor as saleable cathode metal.
 * Ref: knowledge/chemistry/electrowinning.md
 *
 * GAME MODEL (well-mixed cell):
 *  - Faraday: metal deposited = CE·I·t·M/(n·F); current I = j·A;
 *  - mass-transfer limit: a metal can deposit no faster than k_m·A·C_out (k_m ≈ 1×10⁻⁵ m/s, plain plate cathodes),
 *    so a well-mixed cell reaches C_out = C_in/(1 + k_m·A/Q); the current takes the more noble metal first (Cu, then Ni)
 *    and the rest of the current evolves hydrogen (current efficiency falls in dilute liquor);
 *  - Ni needs pH > 3 (else H₂ wins) — below pH 3 no Ni plates;
 *  - anode O₂ evolution releases 2 H⁺ per M²⁺ plated (automatic in the charge balance: the metal cation leaves);
 *  - cell voltage 2.2 V (Cu) / 3.5 V (Ni), verify; plated metal leaves the water as product (consumed term) and is sold.
 */
import { Stream, cloneStream } from '../core/stream';
import { MW } from '../core/units';
import { equilibrate } from './acidBase';
import { Note, ProcessResult, result } from '../treatment/types';

/** verify: value paid for recovered cathode / high-grade scrap metal, RM/kg (LME-linked, GAME MODEL) */
export const METAL_VALUE_RMkg = { Cu: 35, Ni: 70 };
export const EW = { F: 96485, km: 1e-5, ceMax: 0.92, volts: { Cu: 2.2, Ni: 3.5 } as const };

/**
 * Cathode types (GAME MODEL, verify: knowledge/chemistry/electrowinning.md "High-surface cathode").
 * - plate: flat sheet cathodes in a stirred tank, k_m ≈ 1×10⁻⁵ m/s; metal harvested as cathode sheet.
 * - rce: rotating cylinder electrode — the spinning cathode thins the diffusion layer, k_m ≈ 1×10⁻⁴ m/s (10×), so a
 *   dilute rinse needs ~1/10 of the cathode area. Dearer per m² (drive, seals), motor power, and the metal comes off
 *   as powder/flake sold at ~90 % of the cathode price.
 */
export type CathodeType = 'plate' | 'rce';
export const CATHODES: Record<CathodeType, { km: number; valueFactor: number; driveKWhd_m2: number }> = {
  plate: { km: 1e-5, valueFactor: 1, driveKWhd_m2: 0 },
  rce: { km: 1e-4, valueFactor: 0.9, driveKWhd_m2: 6 },
};
const cathodeOf = (c?: string): CathodeType => (c === 'rce' ? 'rce' : 'plate');

/** limiting current density for a metal at concentration C (g/m³): i_L = n·F·k_m·C/M, A/m² */
export function limitingCurrent(m: 'Cu' | 'Ni', C_gm3: number, cathode?: string): number {
  return (2 * EW.F * CATHODES[cathodeOf(cathode)].km * C_gm3) / MW[m];
}

/**
 * Auto-size a cell for a target recovery of the plateable metal (well-mixed cell): A = (1/(1−R) − 1)·Q/k_m, and the
 * current density at 0.7 × the limiting current density of the feed's main metal (enough current for the mass-transfer
 * rate at the outlet with margin, little wasted on hydrogen). Caps follow the catalogue parameter limits.
 */
export function ewAutoSize(s: Stream, recovery: number, cathode?: string): { area: number; j: number } {
  const km = CATHODES[cathodeOf(cathode)].km;
  const R = Math.min(0.98, Math.max(0.1, recovery));
  const Qs = s.Q / 86400;
  const area = Math.min(1000, Math.max(0.5, Math.ceil((((1 / (1 - R) - 1) * Qs) / km) * 2) / 2));
  // current needed = metal plated × n·F/M ÷ CE ÷ A, with 30 % margin; never below 5 A/m²
  const eq = (['Cu', 'Ni'] as const).reduce((a, m) => a + (Qs * s.dissolved[m] * R) / MW[m], 0); // mol/s
  const j = Math.min(600, Math.max(5, Math.ceil(((eq * 2 * EW.F) / EW.ceMax / area) * 1.3 / 5) * 5));
  return { area, j };
}

/** nickel can plate (pH gate) */
const m_niPlateable = (s: Stream) => s.pH >= 3;

export function electrowin(s: Stream, p: { area_m2: number; currentDensity: number; cathode?: string }): ProcessResult {
  const notes: Note[] = [];
  const cat = CATHODES[cathodeOf(p.cathode)];
  const A = Math.max(p.area_m2, 0.01);
  const j = Math.max(p.currentDensity, 1);
  const I = j * A; // A
  const Qs = s.Q / 86400; // m³/s
  let charge = I; // C/s still available
  const out = cloneStream(s);
  const plated: Record<'Cu' | 'Ni', number> = { Cu: 0, Ni: 0 }; // kg/d
  let energyW = 0;
  for (const m of ['Cu', 'Ni'] as const) {
    const cin = s.dissolved[m]; // g/m³
    if (cin <= 0 || charge <= 0) continue;
    if (m === 'Ni' && s.pH < 3) {
      if (cin > 50) notes.push({ level: 'warn', code: 'ew.niAcid', text: `Nickel will not plate at pH ${s.pH.toFixed(1)} — hydrogen evolution takes the current. Run nickel cells at pH 3–4.` });
      continue;
    }
    const cMT = cin / (1 + (cat.km * A) / Math.max(Qs, 1e-12)); // mass-transfer-limited outlet, g/m³
    const mtRate = Qs * (cin - cMT); // g/s
    const curRate = (EW.ceMax * charge * MW[m]) / (2 * EW.F); // g/s
    const rate = Math.min(mtRate, curRate);
    const used = (rate * 2 * EW.F) / MW[m] / EW.ceMax;
    charge -= used;
    energyW += used * EW.volts[m];
    out.dissolved[m] = cin - (Qs > 0 ? rate / Qs : 0);
    plated[m] = (rate * 86400) / 1000;
  }
  energyW += charge * EW.volts.Cu; // remaining current: hydrogen / oxygen evolution
  const driveKWhd = cat.driveKWhd_m2 * A; // RCE motors
  const kgTotal = plated.Cu + plated.Ni;
  const ce = I > 0 ? (((plated.Cu * 1000) / 86400 / MW.Cu + (plated.Ni * 1000) / 86400 / MW.Ni) * 2 * EW.F) / I : 0;
  const credit = (plated.Cu * METAL_VALUE_RMkg.Cu + plated.Ni * METAL_VALUE_RMkg.Ni) * cat.valueFactor;
  // current the plated metal actually needed (at the best current efficiency): if the cell is driven far above it, the
  // problem is excess current, not a dilute liquor
  const needA = ((((plated.Cu * 1000) / 86400 / MW.Cu + (plated.Ni * 1000) / 86400 / MW.Ni) * 2 * EW.F) / EW.ceMax);
  if (kgTotal > 0 && ce < 0.3) {
    // load-limited (most of the plateable metal is captured) vs mass-transfer-limited (much of it passes through)
    const feedKg = (s.Q * (s.dissolved.Cu + (m_niPlateable(s) ? s.dissolved.Ni : 0))) / 1000;
    if (I > 3 * needA && kgTotal >= 0.7 * feedKg) {
      const jFit = Math.max(5, Math.ceil((needA * 1.3) / A / 5) * 5);
      notes.push({ level: 'warn', code: 'ew.overcurrent', text: `Current efficiency only ${(ce * 100).toFixed(0)} %: the cell runs ${I.toFixed(0)} A but plating ${kgTotal.toFixed(2)} kg/d of metal needs only about ${needA.toFixed(0)} A — the rest makes hydrogen and wastes power. Lower the current density to about ${jFit} A/m² (or press Auto-size).` });
    } else {
      notes.push({ level: 'warn', code: 'ew.dilute', text: `Current efficiency only ${(ce * 100).toFixed(0)} %: the liquor is too dilute for this cathode (mass-transfer limited) — lower the current density, add cathode area, use a rotating cylinder cathode, or feed a more concentrated stream (eluate, drag-out).` });
    }
  }
  if ((s.dissolved.Cu + s.dissolved.Ni) < 100) notes.push({ level: 'info', code: 'ew.feed', text: 'Electrowinning recovers metal from concentrated liquors (IX eluate, drag-out). It is not a polishing step — the spent electrolyte goes back to treatment.' });
  if ((s.complexed?.Ni ?? 0) + (s.complexed?.Cu ?? 0) > 1) notes.push({ level: 'info', code: 'ew.complexed', text: 'Complexed metal is not modelled as plateable (it plates poorly from most complexing baths).' });
  return result(equilibrate(out), {
    consumed: { Cu: plated.Cu, Ni: plated.Ni },
    credits: credit > 0 ? [{ name: 'Recovered metal sales', RMd: credit }] : [],
    notes,
    energy_kWhd: (energyW * 24) / 1000 + driveKWhd,
    calcs: {
      I: { label: 'Cell current', value: I, unit: 'A', digits: 0 },
      cu: { label: 'Copper plated', value: plated.Cu, unit: 'kg/d', digits: 2 },
      ni: { label: 'Nickel plated', value: plated.Ni, unit: 'kg/d', digits: 2 },
      niRec: { label: 'Nickel recovery (in → out)', value: s.dissolved.Ni > 0 ? (plated.Ni * 1000) / 86400 / Math.max(Qs, 1e-12) / s.dissolved.Ni * 100 : 0, unit: '%', digits: 0 },
      niOut: { label: 'Nickel left in the liquor', value: out.dissolved.Ni, unit: 'mg/L', digits: 0 },
      iL: { label: 'Limiting current density (feed Ni)', value: limitingCurrent('Ni', s.dissolved.Ni, p.cathode), unit: 'A/m²', digits: 0 },
      ce: { label: 'Current efficiency', value: ce * 100, unit: '%', digits: 0 },
      spec: { label: 'Specific energy', value: kgTotal > 0 ? (energyW * 24) / 1000 / kgTotal : 0, unit: 'kWh/kg metal', digits: 1 },
      credit: { label: 'Metal sold (netted from OPEX)', value: credit, unit: 'RM/d', digits: 0 },
    },
  });
}
