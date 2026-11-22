/**
 * Pressure-driven membranes: ultrafiltration (UF) and reverse osmosis (RO). Ref: knowledge/physical/membranes.md
 *
 * GAME MODEL (deliberately simple, no solution-diffusion):
 *  - recovery r = permeate / feed (player set);
 *  - each species has an observed rejection R; permeate C_p = C_f·(1−R)·CF_avg, CF_avg = ln(1/(1−r))/r is the average
 *    concentration factor along the element train (log-mean), concentrate C_c = (C_f − r·C_p)/(1−r) — mass closes exactly;
 *  - RO feed pressure ≈ average osmotic pressure + 10 bar (net driving pressure + element/piping losses), π ≈ 0.7 bar per
 *    1,000 mg/L TDS (verify; NaCl ≈ 0.79); pump energy = P/(36·η) kWh/m³ (P in bar, η pump+motor);
 *  - RO recovery is limited by scaling of sparingly soluble salts: concentration factor ≤ 2.5 without antiscalant, ≤ 6.7
 *    with (GAME MODEL, verify by projection software); beyond it the membranes scale: rejection and energy degrade.
 */
import { METALS, Stream, cloneStream, tdsTotal, tss } from '../core/stream';
import { equilibrate } from '../chemistry/acidBase';
import { Note, ProcessResult, result } from '../treatment/types';

/** dissolved scalars that a membrane can reject (Cb rejected with the salts: the permeate keeps its ion balance) */
const DISSOLVED = ['tds', 'SO4T', 'Cb', 'CT', 'weakAcidT', 'SS', 'SI', 'NH4N', 'NO3N', 'alDissolved', 'feDissolved', 'CrVI', 'sulfideS'] as const;
type DKey = (typeof DISSOLVED)[number];
/** particulate scalars (fully retained by both membranes, up to the UF log removal) */
const PARTICULATE = ['XS', 'XI', 'biomass', 'grit', 'inert', 'colloid', 'floc', 'alSolid', 'feSolid', 'OGfree', 'OGemulsified', 'OGfloc'] as const;

export type Rejection = Partial<Record<DKey | (typeof PARTICULATE)[number] | 'metals' | 'particulate', number>>;

export const CF_avg = (r: number) => (r <= 1e-9 ? 1 : Math.log(1 / (1 - r)) / r);

/** Split a feed into permeate and concentrate at recovery r with per-species rejection. Mass is conserved exactly. */
export function membraneSplit(s: Stream, r: number, rej: Rejection): { permeate: Stream; concentrate: Stream } {
  const rr = Math.min(0.98, Math.max(0.01, r));
  const cf = CF_avg(rr);
  const perm = cloneStream(s);
  const conc = cloneStream(s);
  perm.Q = s.Q * rr;
  conc.Q = s.Q * (1 - rr);
  perm.ml = undefined;
  conc.ml = undefined;
  conc.peakFactor = 1;
  const split = (cf_: number, R: number) => {
    const cp = Math.sign(cf_) * Math.min(Math.abs(cf_), Math.abs(cf_) * (1 - R) * cf);
    return { cp, cc: (cf_ - rr * cp) / (1 - rr) };
  };
  const rec = perm as unknown as Record<string, number>;
  const rcc = conc as unknown as Record<string, number>;
  const src = s as unknown as Record<string, number>;
  for (const k of DISSOLVED) {
    const { cp, cc } = split(src[k] ?? 0, rej[k] ?? 0);
    rec[k] = cp;
    rcc[k] = cc;
  }
  const Rp = rej.particulate ?? 1;
  for (const k of PARTICULATE) {
    const { cp, cc } = split(src[k] ?? 0, rej[k] ?? Rp);
    rec[k] = cp;
    rcc[k] = cc;
  }
  const Rm = rej.metals ?? 0;
  for (const m of METALS) {
    let x = split(s.dissolved[m], Rm);
    perm.dissolved[m] = x.cp;
    conc.dissolved[m] = x.cc;
    x = split(s.complexed?.[m] ?? 0, Rm);
    perm.complexed![m] = x.cp;
    conc.complexed![m] = x.cc;
    x = split(s.precipitated[m], Rp);
    perm.precipitated[m] = x.cp;
    conc.precipitated[m] = x.cc;
    x = split(s.sulfide?.[m] ?? 0, Rp);
    perm.sulfide![m] = x.cp;
    conc.sulfide![m] = x.cc;
  }
  // ammonium passing beyond the salt rejection carries its counter-anion (Cl⁻): move that charge from brine to permeate
  if (rej.NH4N !== undefined && rej.Cb !== undefined && s.NH4N > 0) {
    const atSalt = split(s.NH4N, rej.Cb).cp;
    const extra = (perm.NH4N - atSalt) / 14007; // mol/L in the permeate
    perm.Cb -= extra;
    conc.Cb += (extra * rr) / (1 - rr);
  }
  return { permeate: equilibrate(perm), concentrate: equilibrate(conc) };
}

// ---------------------------------------------------------------- UF
export const UF = {
  /** design net flux, L/m²·h (hollow fibre on secondary/chemical effluent 30–60, verify) */
  designFlux: 50,
  /** log removal of suspended solids by an intact UF membrane (≈ 4-log) */
  particulateRejection: 0.9999,
  /** emulsified oil rejection (verify) */
  emulsionRejection: 0.95,
  kWh_m3: 0.15,
  /** chemically-enhanced backwash: NaOCl mg/L of feed (verify) */
  naocl_mgL: 2,
};

export function ultrafilter(s: Stream, p: { area_m2: number; recovery_pct: number }): ProcessResult {
  const notes: Note[] = [];
  const flux = (s.Q * 1000) / 24 / Math.max(p.area_m2, 1e-6);
  const feedTSS = tss(s);
  // fouling: high flux or dirty feed forces more backwash/CEB water → lower achievable recovery (GAME MODEL)
  let r = p.recovery_pct / 100;
  const rMax = Math.max(0.75, 0.96 - 0.002 * Math.max(0, flux - UF.designFlux) - 0.0002 * feedTSS);
  if (r > rMax) {
    notes.push({ level: 'warn', code: 'uf.recovery', text: `Recovery ${(r * 100).toFixed(0)} % is not achievable at ${flux.toFixed(0)} LMH flux with ${feedTSS.toFixed(0)} mg/L feed solids — backwashes come more often; about ${(rMax * 100).toFixed(0)} % is realistic.` });
    r = rMax;
  }
  if (flux > 80) notes.push({ level: 'warn', code: 'uf.flux', text: `Net flux ${flux.toFixed(0)} LMH is high (design 30–60 LMH) — the membranes foul quickly; add membrane area.` });
  if (feedTSS > 300) notes.push({ level: 'warn', code: 'uf.tss', text: `Feed suspended solids ${feedTSS.toFixed(0)} mg/L — UF is a polishing step; clarify first.` });
  if (s.OGfree > 5) notes.push({ level: 'warn', code: 'uf.oil', text: `Free oil ${s.OGfree.toFixed(0)} mg/L coats the fibres irreversibly — remove oil upstream (separator / DAF).` });
  const { permeate, concentrate } = membraneSplit(s, r, { particulate: UF.particulateRejection, OGemulsified: UF.emulsionRejection, OGfree: UF.particulateRejection });
  return result(permeate, {
    reject: concentrate,
    notes,
    energy_kWhd: s.Q * UF.kWh_m3,
    chemicals: [{ name: 'Sodium hypochlorite (UF CEB)', kgPerDay: (s.Q * UF.naocl_mgL) / 1000, priceRMkg: 1.2 }],
    calcs: {
      flux: { label: 'Net flux', value: flux, unit: 'L/m²·h', digits: 0 },
      rec: { label: 'Recovery (net of backwash)', value: r * 100, unit: '%', digits: 0 },
      tssP: { label: 'Permeate suspended solids', value: tss(permeate), unit: 'mg/L', digits: 2 },
      back: { label: 'Backwash water to reject', value: concentrate.Q, unit: 'm³/d', digits: 1 },
    },
  });
}

// ---------------------------------------------------------------- RO
export const RO = {
  /** osmotic pressure per 1,000 mg/L TDS, bar (GAME MODEL; NaCl ≈ 0.79, mixed industrial salts ≈ 0.6–0.75, verify) */
  piPer1000: 0.7,
  /** net driving pressure + element and piping losses, bar (BWRO, verify) */
  overhead_bar: 10,
  pumpEff: 0.75,
  /** scaling limits on the concentration factor 1/(1−r) (GAME MODEL, verify with projection software) */
  cfMax: { none: 2.5, antiscalant: 6.7 },
  antiscalant_mgL: 3,
  /** design flux, L/m²·h (BWRO on wastewater 14–20) */
  flux: 17,
};

/** Observed rejections for a brackish-water polyamide membrane (GAME MODEL, verify: vendor data) */
export const RO_REJECTION: Rejection = {
  // every strong ion at one salt rejection so the permeate and brine keep their charge balance (see membraneSplit)
  tds: 0.985, SO4T: 0.985, Cb: 0.985, metals: 0.985, alDissolved: 0.985, feDissolved: 0.985, CrVI: 0.985, NO3N: 0.985,
  CT: 0.6, // dissolved CO2 passes: permeate pH drops
  NH4N: 0.93, // NH4+ passes more easily (small, weakly hydrated); the extra NH4+ takes an anion with it (Cb correction)
  SS: 0.95, SI: 0.97, weakAcidT: 0.9, sulfideS: 0.5, particulate: 1,
};

export const osmoticBar = (tdsMgL: number) => (RO.piPer1000 * tdsMgL) / 1000;

export function reverseOsmosis(s: Stream, p: { recovery_pct: number; antiscalant: boolean }): ProcessResult {
  const notes: Note[] = [];
  const r = Math.min(0.95, Math.max(0.3, p.recovery_pct / 100));
  const cf = 1 / (1 - r);
  const cfMax = p.antiscalant ? RO.cfMax.antiscalant : RO.cfMax.none;
  let rej: Rejection = RO_REJECTION;
  let energyFactor = 1;
  const scaling = cf > cfMax;
  if (scaling) {
    rej = Object.fromEntries(Object.entries(RO_REJECTION).map(([k, v]) => [k, k === 'particulate' ? 1 : v * 0.92])) as Rejection;
    energyFactor *= 1.3;
    notes.push({ level: 'warn', code: 'ro.scale', text: `Recovery ${(r * 100).toFixed(0)} % concentrates the feed ${cf.toFixed(1)}× — beyond the ${cfMax}× scaling limit${p.antiscalant ? '' : ' without antiscalant'}. CaSO₄/CaCO₃/silica scale the tail elements: salt passage rises and pressure climbs. ${p.antiscalant ? 'Lower the recovery.' : 'Dose antiscalant or lower the recovery.'}` });
  }
  const feedTSS = tss(s);
  const oil = s.OGfree + s.OGemulsified + (s.OGfloc ?? 0);
  if (feedTSS > 2 || oil > 0.5) {
    energyFactor *= 1.2;
    notes.push({ level: 'warn', code: 'ro.foul', text: `Feed carries ${feedTSS.toFixed(1)} mg/L solids and ${oil.toFixed(1)} mg/L oil — RO needs SDI < 3 (UF or fine filtration first). The elements foul: pressure rises and cleanings become frequent.` });
  }
  if (s.SS + s.XS > 50) notes.push({ level: 'info', code: 'ro.biofoul', text: `Biodegradable COD ${(s.SS + s.XS).toFixed(0)} mg/L feeds biofouling on the membranes — treat biologically first.` });
  const { permeate, concentrate } = membraneSplit(s, r, rej);
  const tdsF = tdsTotal(s);
  const piAvg = osmoticBar(tdsF) * CF_avg(r);
  const P = piAvg + RO.overhead_bar;
  const kWh_m3 = (P / (36 * RO.pumpEff)) * energyFactor;
  const tdsC = tdsTotal(concentrate);
  if (osmoticBar(tdsC) > 35) notes.push({ level: 'warn', code: 'ro.pressure', text: `Concentrate osmotic pressure ${osmoticBar(tdsC).toFixed(0)} bar — beyond brackish-water elements (≈ 41 bar max); use fewer stages of recovery or an evaporator for the brine.` });
  const chemicals = [{ name: 'RO cleaning chemicals (CIP)', kgPerDay: (s.Q * 0.5) / 1000, priceRMkg: 6 }];
  if (p.antiscalant) chemicals.push({ name: 'Antiscalant', kgPerDay: (s.Q * RO.antiscalant_mgL) / 1000, priceRMkg: 18 });
  return result(permeate, {
    reject: concentrate,
    notes,
    energy_kWhd: s.Q * kWh_m3,
    chemicals,
    calcs: {
      rec: { label: 'Recovery', value: r * 100, unit: '%', digits: 0 },
      cf: { label: 'Concentration factor', value: cf, unit: '×', digits: 1 },
      tdsF: { label: 'Feed TDS', value: tdsF, unit: 'mg/L', digits: 0 },
      tdsP: { label: 'Permeate TDS', value: tdsTotal(permeate), unit: 'mg/L', digits: 0 },
      tdsC: { label: 'Brine TDS', value: tdsC, unit: 'mg/L', digits: 0 },
      pi: { label: 'Average osmotic pressure', value: piAvg, unit: 'bar', digits: 1 },
      P: { label: 'Feed pressure', value: P, unit: 'bar', digits: 1 },
      spec: { label: 'Specific energy (per m³ feed)', value: kWh_m3, unit: 'kWh/m³', digits: 2 },
      area: { label: 'Membrane area at design flux', value: (permeate.Q * 1000) / 24 / RO.flux, unit: 'm²', digits: 0 },
    },
  });
}


