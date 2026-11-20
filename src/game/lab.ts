/**
 * Laboratory: what the player knows about a wastewater. The customer's declared datasheet is noisy and
 * incomplete; paid tests reveal accurate values. The "design basis" stream used for predictions in the
 * Engineering Studio is rebuilt from whatever is currently known — so skipping tests risks a design that
 * fails on the TRUE wastewater at commissioning.
 */
import { Stream, emptyStream, metalTotal, oilGrease, poolMass, tss, bod5, codTotal, METALS, Metal, cloneStream } from '../simulation/core/stream';
import { acidity, alkalinity, setCbForPH, titrationCurve, baseDemand } from '../simulation/chemistry/acidBase';
import { mgCaCO3_to_eqL } from '../simulation/core/units';
import { coagulate, Coagulant } from '../simulation/chemistry/coagulation';
import { hazenRemoval } from '../simulation/physical/settling';
import { POOLS } from '../simulation/core/stream';
import { Rng } from './rng';

export type LabTestId = 'metals' | 'titration' | 'fractionation' | 'oil' | 'jar';

export const LAB_TESTS: Record<LabTestId, { name: string; cost: number; weeks: number; reveals: string }> = {
  metals: { name: 'Heavy metals panel (ICP-OES) + Cr(VI)', cost: 4_000, weeks: 1, reveals: 'Accurate Ni, Cu, Zn, Cr(III) and hexavalent chromium — including metals the customer did not declare.' },
  titration: { name: 'Acid–base titration + sulfate (IC)', cost: 2_500, weeks: 1, reveals: 'Alkalinity, acidity, sulfate and the full titration curve (buffer capacity → true chemical dose).' },
  fractionation: { name: 'COD fractionation + BOD₅ + NH₄-N', cost: 6_000, weeks: 2, reveals: 'Biodegradable vs inert COD, soluble vs particulate, ammoniacal nitrogen.' },
  oil: { name: 'Oil & grease characterisation', cost: 1_500, weeks: 1, reveals: 'Free vs emulsified oil.' },
  jar: { name: 'Jar-test kit (on sample)', cost: 3_000, weeks: 1, reveals: 'Unlocks interactive jar tests on the real sample: colloid load and optimum coagulant dose.' },
};

/** The parameters a datasheet can hold. Undefined = unknown. */
export interface Datasheet {
  Q: number;
  peakFactor: number;
  T: number;
  pH: number;
  COD: number;
  BOD5?: number;
  TSS: number;
  OG: number;
  NH3N?: number;
  Ni?: number;
  Cu?: number;
  Zn?: number;
  /** total trivalent chromium, mg/L */
  Cr?: number;
  /** hexavalent chromium, mg/L as Cr */
  CrVI?: number;
  alkalinity_mgCaCO3?: number;
  acidity_mgCaCO3?: number;
  /** sulfate (ion chromatography), mg/L as SO4 */
  sulfate_mgL?: number;
  fractions?: { SS: number; SI: number; XS: number; XI: number };
  ogFreeFraction?: number;
  colloidFraction?: number;
}

export function declaredDatasheet(trueS: Stream, rng: Rng, hideZn: boolean, hideCrVI = false): Datasheet {
  const n = (x: number, r = 0.2) => Math.max(0, rng.noise(x, r));
  const ds: Datasheet = {
    Q: trueS.Q,
    peakFactor: Math.round(n(trueS.peakFactor, 0.1) * 10) / 10,
    T: Math.round(trueS.T),
    pH: Math.round(rng.noise(trueS.pH, 0.04) * 10) / 10,
    COD: Math.round(n(codTotal(trueS))),
    TSS: Math.round(n(tss(trueS))),
    OG: Math.round(n(oilGrease(trueS), 0.3)),
  };
  for (const m of METALS) {
    const v = metalTotal(trueS, m);
    if (v > 0.05 && !(m === 'Zn' && hideZn) && !(m === 'Cr' && hideCrVI)) ds[m] = Math.round(n(v, 0.15) * 10) / 10;
  }
  if (trueS.CrVI > 0.05 && !hideCrVI) ds.CrVI = Math.round(n(trueS.CrVI, 0.15) * 10) / 10;
  return ds;
}

/** Apply a completed test: merge accurate (±3 %) measurements into the datasheet. */
export function applyTest(ds: Datasheet, test: LabTestId, trueS: Stream, rng: Rng): Datasheet {
  const acc = (x: number) => Math.max(0, rng.noise(x, 0.03));
  const out: Datasheet = { ...ds };
  switch (test) {
    case 'metals':
      for (const m of METALS) out[m] = Math.round(acc(metalTotal(trueS, m)) * 100) / 100;
      out.CrVI = Math.round(acc(trueS.CrVI) * 100) / 100;
      break;
    case 'titration':
      out.alkalinity_mgCaCO3 = Math.round(acc(alkalinity(trueS)));
      out.acidity_mgCaCO3 = Math.round(acc(acidity(trueS)));
      out.pH = Math.round(trueS.pH * 100) / 100;
      out.sulfate_mgL = Math.round(acc((trueS.SO4T ?? 0) * 96_060));
      break;
    case 'fractionation': {
      const cod = codTotal(trueS);
      out.COD = Math.round(acc(cod));
      out.BOD5 = Math.round(acc(bod5(trueS)));
      out.NH3N = Math.round(acc(trueS.NH4N) * 10) / 10;
      out.fractions = { SS: trueS.SS / cod, SI: trueS.SI / cod, XS: trueS.XS / cod, XI: trueS.XI / cod };
      break;
    }
    case 'oil': {
      const og = oilGrease(trueS);
      out.OG = Math.round(acc(og) * 10) / 10;
      out.ogFreeFraction = og > 0 ? trueS.OGfree / og : 0.5;
      break;
    }
    case 'jar':
      out.colloidFraction = tss(trueS) > 0 ? trueS.colloid / tss(trueS) : 0;
      out.TSS = Math.round(acc(tss(trueS)));
      break;
  }
  return out;
}

/** Default assumptions for unknown parameters (deliberately generic — the lab exists to replace them). */
export const ASSUMED = {
  fractions: { SS: 0.4, SI: 0.1, XS: 0.4, XI: 0.1 },
  CT_mmol: 2,
  ogFreeFraction: 0.6,
  colloidFraction: 0.3,
  NH3N_perCOD: 0.03,
};

/** Build the design-basis stream from what is currently known. */
export function designBasis(ds: Datasheet): { stream: Stream; assumptions: string[] } {
  const a: string[] = [];
  const s = emptyStream(ds.Q);
  s.T = ds.T;
  s.peakFactor = ds.peakFactor;
  const f = ds.fractions ?? (a.push('COD fractions assumed (40 % readily biodegradable, 10 % inert soluble).'), ASSUMED.fractions);
  s.SS = ds.COD * f.SS;
  s.SI = ds.COD * f.SI;
  s.XS = ds.COD * f.XS;
  s.XI = ds.COD * f.XI;
  s.NH4N = ds.NH3N ?? (a.push('NH₄-N assumed at 3 % of COD.'), ds.COD * ASSUMED.NH3N_perCOD);
  const free = ds.ogFreeFraction ?? (a.push('Oil assumed 60 % free / 40 % emulsified.'), ASSUMED.ogFreeFraction);
  s.OGfree = ds.OG * free;
  s.OGemulsified = ds.OG * (1 - free);
  for (const m of METALS) s.dissolved[m as Metal] = ds[m as Metal] ?? 0;
  s.CrVI = ds.CrVI ?? 0;
  if (ds.sulfate_mgL !== undefined) s.SO4T = ds.sulfate_mgL / 96_060;
  else if (ds.pH < 4) a.push('Sulfate unknown (assumed 0) — below pH 4 bisulfate buffering changes acid and caustic doses. Run the titration + IC test.');
  if (ds.Ni === undefined && ds.Cu === undefined && ds.Zn === undefined) a.push('No metals declared — not tested.');
  // solids: particulate organics are already in TSS; the remainder is split colloid / settleable mineral
  const orgTSS = (s.XS + s.XI) / 1.42;
  const mineral = Math.max(0, ds.TSS - orgTSS);
  const cf = ds.colloidFraction ?? (a.push('Colloid fraction of TSS assumed 30 % (run a jar test).'), ASSUMED.colloidFraction);
  s.colloid = Math.min(mineral, ds.TSS * cf);
  s.inert = mineral - s.colloid;
  // buffer capacity
  s.CT = ASSUMED.CT_mmol / 1000;
  let stream = setCbForPH(s, ds.pH);
  if (ds.alkalinity_mgCaCO3 !== undefined) {
    // choose C_T so that the measured alkalinity is reproduced at the measured pH (bisection on C_T)
    let lo = 0;
    let hi = 0.05;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const t = setCbForPH({ ...cloneStream(s), CT: mid }, ds.pH);
      if (alkalinity(t) < ds.alkalinity_mgCaCO3) lo = mid;
      else hi = mid;
    }
    stream = setCbForPH({ ...cloneStream(s), CT: (lo + hi) / 2 }, ds.pH);
  } else a.push('Buffer capacity assumed (C_T 2 mmol/L) — chemical doses may be wrong. Run a titration.');
  return { stream, assumptions: a };
}

/** Titration curve on the true sample: pH vs NaOH (+) / H2SO4 (−) dose in mg/L. */
export function titrationData(trueS: Stream): { doseNaOH_mgL: number; pH: number }[] {
  const doses = Array.from({ length: 61 }, (_, i) => (i - 10) * 20); // −200 … +1000 mg/L as NaOH
  return titrationCurve(trueS, doses.map((d) => d / 40_000)).map((p, i) => ({ doseNaOH_mgL: doses[i], pH: p.pH }));
}

/** Jar test on the true sample: optional pre-adjustment to pH, then coagulant series, 30 min settling (SOR ≈ 0.5 m/h). */
export function jarTest(trueS: Stream, coagulant: Coagulant, doses: number[], prePH?: number): { dose: number; supernatantTSS: number; pH: number }[] {
  let base = cloneStream(trueS);
  if (prePH !== undefined) {
    base.Cb += baseDemand(base, prePH);
    base = setCbForPH(base, prePH);
  }
  return doses.map((dose) => {
    const r = coagulate(base, { coagulant, dose_mgL: dose, flocTime_min: 15 });
    const o = r.out;
    const remaining = POOLS.reduce((acc, p) => acc + poolMass(o, p) * (1 - hazenRemoval(o.v50[p], 0.5)), 0);
    return { dose, supernatantTSS: remaining, pH: o.pH };
  });
}

export function alkalinityToCb(mg: number): number {
  return mgCaCO3_to_eqL(mg);
}
