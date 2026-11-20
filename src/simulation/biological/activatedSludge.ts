/**
 * Activated sludge — steady-state completely-mixed reactor with sludge recycle.
 * Ref: knowledge/biological/activated_sludge.md, microbial_kinetics.md, knowledge/design/design_parameters.md
 * Equations: Metcalf & Eddy (5th ed.) Ch. 7–8 (COD basis).
 *
 *   S   = Ks(1 + b·SRT) / (SRT(μ − b) − 1)                    effluent soluble bCOD
 *   PxH = Q·Y(S0 − S) / (1 + b·SRT)                            heterotroph production, g VSS/d
 *   Pxd = fd·b·PxH·SRT                                         cell debris
 *   N   = Kn(1 + bn·SRT) / (SRT(μn − bn) − 1)                  effluent NH4-N (nitrifiers)
 *   Ro  = Q(S0 − S) − 1.42(PxH + Pxd) + 4.57·Q·NOx − 1.42·PxN   oxygen demand
 *   X   = (SRT/HRT) · Px / Q                                   reactor solids concentration
 * Inhibition factors multiply μ (GAME MODEL, documented thresholds; see knowledge doc).
 */
import { METALS, Metal, Stream, cloneStream, emptyStream, poolMass } from '../core/stream';
import { COD_PER_VSS, MW, N_PER_VSS, hrtDays, tempCorrect } from '../core/units';
import { aeratedH2CO3, equilibrate } from '../chemistry/acidBase';
import { Note, ProcessResult, result } from '../treatment/types';

/** Kinetic coefficients at 20 °C — Metcalf & Eddy 5th ed. Table 8-14 (single edition; verify). */
export const KINETICS = {
  heterotroph: { muMax: 6.0, thetaMu: 1.07, Ks: 8, Y: 0.45, b: 0.12, thetaB: 1.04, fd: 0.15, KoH: 0.2 },
  /** AOB only (NOB yield ≈ 0.05 neglected) */
  nitrifier: { muMax: 0.9, thetaMu: 1.072, Kn: 0.5, thetaKn: 1.0, Y: 0.15, b: 0.17, thetaB: 1.029, Ko: 0.5 },
  /** field oxygen transfer efficiency for fine-bubble diffusers, kg O2/kWh (verify) */
  aerationEfficiency: 1.2,
  /** GAME MODEL non-competitive inhibition constants, dissolved metal mg/L (verify against toxicity thresholds) */
  KI: { Cu: 1.0, Ni: 2.5, Zn: 5.0, Cr: 5.0 } as Record<Metal, number>,
  /** nitrifiers are far more sensitive (US EPA Local Limits 2004 nitrification thresholds: Cu 0.05–0.48, Ni 0.25–0.5, Zn 0.08–0.5) */
  KI_N: { Cu: 0.25, Ni: 0.4, Zn: 0.3, Cr: 0.5 } as Record<Metal, number>,
  KI_OG: 150,
  /** g COD per g fat/oil (≈ triolein) */
  COD_PER_OG: 2.9,
  /** O&G sorption partition onto MLSS, L/mg (GAME MODEL); sorbed oil is 80 % biodegraded over the SRT, rest wasted */
  K_OG_ads: 3e-3,
  OG_degraded: 0.8,
};

export interface ActivatedSludgeInput {
  volume_m3: number;
  srt_d: number;
  do_mgL: number;
}

/** GAME MODEL: heterotrophs — full activity at pH 6.5–8.5, linear decline to zero at 5.0 and 10.0. */
export function pHInhibition(pH: number): number {
  if (pH >= 6.5 && pH <= 8.5) return 1;
  if (pH < 6.5) return Math.max(0, (pH - 5.0) / 1.5);
  return Math.max(0, (10.0 - pH) / 1.5);
}

/** GAME MODEL: nitrifiers — full activity at pH 7.2–8.5, steep decline below (zero at 5.5) and above (zero at 10). */
export function pHInhibitionNitrifier(pH: number): number {
  if (pH >= 7.2 && pH <= 8.5) return 1;
  if (pH < 7.2) return Math.max(0, (pH - 5.5) / 1.7);
  return Math.max(0, (10.0 - pH) / 1.5);
}

/** GAME MODEL: I = 1 / (1 + Σ C_m / KI_m) on dissolved metals. */
export function metalInhibition(s: Stream, KI: Record<Metal, number> = KINETICS.KI): number {
  let sum = 0;
  for (const m of METALS) sum += s.dissolved[m] / KI[m];
  return 1 / (1 + sum);
}

export interface BioState {
  S: number;
  PxH: number;
  Pxd: number;
  PxN: number;
  NOx: number;
  Ne: number;
  washout: boolean;
  nitrifierWashout: boolean;
  fN: number;
}

/** Steady-state biology (all P terms as mg VSS per L of influent). */
export function solveBiology(s: Stream, p: ActivatedSludgeInput, srt: number, inhibition: number, inhibitionN = inhibition): BioState {
  const T = s.T;
  const h = KINETICS.heterotroph;
  const n = KINETICS.nitrifier;
  const muH0 = tempCorrect(h.muMax, h.thetaMu, T) * inhibition * (p.do_mgL / (h.KoH + p.do_mgL));
  const bH = tempCorrect(h.b, h.thetaB, T);
  const muN = tempCorrect(n.muMax, n.thetaMu, T) * inhibitionN * (p.do_mgL / (n.Ko + p.do_mgL));
  const bN = tempCorrect(n.b, n.thetaB, T);
  const Kn = tempCorrect(n.Kn, n.thetaKn, T);
  const S0 = s.SS + s.XS; // bCOD; XS assumed fully hydrolysed at SRT > ~3 d (documented simplification)

  const run = (fN: number): BioState => {
    const muH = muH0 * fN;
    const denom = srt * (muH - bH) - 1;
    let S = denom > 0 ? (h.Ks * (1 + bH * srt)) / denom : S0;
    const washout = denom <= 0 || S >= S0;
    if (washout) S = S0;
    const PxH = (h.Y * (S0 - S)) / (1 + bH * srt);
    const Pxd = h.fd * bH * PxH * srt;
    const uptake = N_PER_VSS * (PxH + Pxd);
    const Navail = Math.max(0, s.NH4N - uptake);
    const dn = srt * (muN - bN) - 1;
    let Ne = dn > 0 ? (Kn * (1 + bN * srt)) / dn : Navail;
    const nitrWash = dn <= 0 || Ne >= Navail;
    if (nitrWash) Ne = Navail;
    const NOx = (Navail - Ne) / (1 + (N_PER_VSS * n.Y) / (1 + bN * srt));
    const PxN = (n.Y * NOx) / (1 + bN * srt);
    return { S, PxH, Pxd, PxN, NOx, Ne, washout, nitrifierWashout: nitrWash, fN };
  };

  // GAME MODEL — nutrient limitation: if assimilative N demand exceeds NH4-N supply, heterotroph growth rate is
  // scaled by f_N (bisection) until uptake equals supply — nitrogen is never created.
  const full = run(1);
  if (N_PER_VSS * (full.PxH + full.Pxd) <= s.NH4N + 1e-12) return full;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const r = run(mid);
    if (N_PER_VSS * (r.PxH + r.Pxd) > s.NH4N) hi = mid;
    else lo = mid;
  }
  return run(lo);
}

export function activatedSludge(s: Stream, p: ActivatedSludgeInput, ctx: { clarifierFollows: boolean }): ProcessResult {
  const notes: Note[] = [];
  if (s.Q <= 0 || p.volume_m3 <= 0) return result(cloneStream(s), { notes: [{ level: 'error', code: 'as.noFlow', text: 'No flow or zero volume: reactor bypassed.' }] });
  const hrt = hrtDays(p.volume_m3, s.Q);
  const srt = ctx.clarifierFollows ? Math.max(p.srt_d, hrt) : hrt;
  if (!ctx.clarifierFollows)
    notes.push({ level: 'error', code: 'as.noClarifier', text: 'No secondary clarifier directly downstream: biomass cannot be retained, so SRT = HRT and the mixed liquor leaves with the effluent.' });
  const ratio = srt / Math.max(hrt, 1e-9);

  // pH ↔ biology feedback (CSTR: reactor pH = effluent pH). The reactor pH must be self-consistent:
  //   g(pH*) = pH_computed(pH*) − pH* = 0.
  // Several roots can exist (a healthy reactor and a "soured" dead one). A commissioned plant is seeded with active
  // sludge, so we take the HIGHEST root: scan downward from pH 10 and refine by bisection.
  const OGin = s.OGfree + s.OGemulsified;
  const ogFracAt = (mlss: number) => (KINETICS.K_OG_ads * mlss) / (1 + KINETICS.K_OG_ads * mlss);
  const atPH = (reactorPH: number) => {
    // O&G: sorbed onto floc (partition), 80 % biodegraded -> its COD (2.9 g/g) joins the substrate (O2 + biomass)
    const pre = solveBiology(s, p, srt, pHInhibition(reactorPH) * metalInhibition(s));
    const ogFrac = ogFracAt(ratio * (s.biomass + pre.PxH + pre.Pxd + s.XI / COD_PER_VSS));
    const ogDeg = OGin * ogFrac * KINETICS.OG_degraded;
    const ogBulk = OGin * (1 - ogFrac);
    const ogF = 1 / (1 + ogBulk / KINETICS.KI_OG);
    const inhib = pHInhibition(reactorPH) * metalInhibition(s) * ogF;
    const inhibN = pHInhibitionNitrifier(reactorPH) * metalInhibition(s, KINETICS.KI_N) * ogF;
    const feed = cloneStream(s);
    feed.SS = s.SS + KINETICS.COD_PER_OG * ogDeg;
    const S0 = feed.SS + feed.XS;
    const bio = solveBiology(feed, p, srt, inhib, inhibN);
    const netBiomass = s.biomass + bio.PxH + bio.Pxd + bio.PxN;

    let out = cloneStream(s);
    // hydrolysis of XS needs active biomass: on washout, particulates pass through unchanged
    out.SS = bio.washout ? feed.SS : bio.S;
    out.XS = bio.washout ? s.XS : 0;
    out.XI = s.XI; // inert particulates are enmeshed in floc and settle with it
    out.v50.organic = 3.0;
    out.v50.biomass = 3.0;
    // bioflocculation: colloids are enmeshed in activated-sludge floc
    out.floc = s.floc + s.colloid;
    out.colloid = 0;
    out.v50.floc = 3.0;
    out.v50.inert = 3.0;
    out.biomass = netBiomass;
    out.weakAcidT = S0 > 0 ? s.weakAcidT * (bio.S / S0) : s.weakAcidT;
    const uptakeN = N_PER_VSS * (bio.PxH + bio.Pxd + bio.PxN);
    out.NH4N = bio.Ne;
    out.NO3N = s.NO3N + bio.NOx;
    // charge: NH4+ uptake removes a strong cation (−1 eq/mol N); nitrification NH4+ → NO3− (−2 eq/mol N)
    out.Cb = s.Cb - (uptakeN + 2 * bio.NOx) / 1000 / MW.N;

    out.OGfree = s.OGfree * (1 - ogFrac);
    out.OGemulsified = s.OGemulsified * (1 - ogFrac);

    out = equilibrate(out, { kind: 'open', H2CO3: aeratedH2CO3(s.T) });
    return { out, bio, inhib, inhibN, ogFrac, ogDeg, S0, g: out.pH - reactorPH };
  };
  let hi = 10;
  let lo = 10;
  let rootFound = false;
  for (let x = 10; x >= 2; x -= 0.1) {
    if (atPH(x).g >= 0) {
      lo = x;
      rootFound = x < 10;
      break;
    }
    hi = x;
    lo = x;
  }
  if (lo < hi) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (atPH(mid).g >= 0) lo = mid;
      else hi = mid;
    }
  }
  const state = atPH((lo + hi) / 2);
  const { bio, inhib, inhibN, ogFrac, ogDeg, S0 } = state;
  const out = state.out;
  if (!rootFound) notes.push({ level: 'warn', code: 'as.pHroot', text: `Reactor pH could not be resolved self-consistently (≈ ${out.pH.toFixed(1)}): extreme alkalinity or acidity in the feed.` });

  const solidsNet =
    poolMass(out, 'biomass') + poolMass(out, 'organic') + out.inert + out.floc + out.colloid + out.grit + poolMass(out, 'precipitate') + poolMass(out, 'alFloc') + poolMass(out, 'feFloc');
  const mlss = ratio * solidsNet;
  const mlvss = ratio * (out.biomass + poolMass(out, 'organic'));
  out.ml = { mlss, srt, clarifierFollows: ctx.clarifierFollows };
  if (!ctx.clarifierFollows) {
    out.ml = undefined; // nothing retained: effluent carries the full (washed-out) solids
  }

  const Q = s.Q;
  const kg = (mgL: number) => (Q * mgL) / 1000;
  const codConsumed = bio.washout ? 0 : S0 - bio.S - COD_PER_VSS * (bio.PxH + bio.Pxd);
  const o2 = kg(codConsumed + 4.57 * bio.NOx - COD_PER_VSS * bio.PxN);
  const fm = mlvss > 0 ? (Q * S0) / (p.volume_m3 * mlvss) : 0;

  if (bio.washout && bio.fN < 0.1) notes.push({ level: 'error', code: 'as.nutrient', text: 'Growth halted by nitrogen deficiency — the feed contains almost no ammoniacal nitrogen for biomass synthesis.' });
  else if (bio.washout) notes.push({ level: 'error', code: 'as.washout', text: `Heterotroph washout: SRT ${srt.toFixed(1)} d is below the minimum for growth (activity ${(inhib * 100).toFixed(0)} %).` });
  if (inhib < 0.7) notes.push({ level: 'warn', code: 'as.inhibition', text: `Biology inhibited to ${(inhib * 100).toFixed(0)} % of normal rate (pH ${out.pH.toFixed(2)}, dissolved metals, O&G).` });
  if (bio.fN < 0.95) notes.push({ level: 'warn', code: 'as.nutrient', text: `Nitrogen-limited growth: heterotroph rate reduced to ${(bio.fN * 100).toFixed(0)} % — add a nutrient source.` });
  if (mlss > 5000) notes.push({ level: 'warn', code: 'as.mlss', text: `MLSS ${mlss.toFixed(0)} mg/L is high for gravity clarification (typical 2,000–4,500).` });
  if (fm > 1.0) notes.push({ level: 'warn', code: 'as.fm', text: `F/M ${fm.toFixed(2)} kg bCOD/kg VSS·d is high: poor settling likely.` });
  if (out.pH < 6.8 && bio.NOx > 0) notes.push({ level: 'warn', code: 'as.alk', text: `Reactor pH ${out.pH.toFixed(2)}: insufficient alkalinity for nitrification (7.1 mg CaCO₃ per mg N nitrified).` });
  if (inhibN < 0.5 && inhib >= 0.7) notes.push({ level: 'warn', code: 'as.nitInhib', text: `Nitrifiers inhibited to ${(inhibN * 100).toFixed(0)} % (they are far more sensitive to metals and low pH than heterotrophs).` });

  const removed = emptyStream(s.Q);
  removed.OGemulsified = OGin * ogFrac * (1 - KINETICS.OG_degraded);

  return result(out, {
    consumed: { COD: kg(codConsumed), OG: kg(ogDeg) },
    // degraded oil enters the COD balance as substrate; nitrifiers fix COD from CO2
    produced: { COD: kg(COD_PER_VSS * bio.PxN + KINETICS.COD_PER_OG * ogDeg) },
    removed,
    energy_kWhd: o2 / KINETICS.aerationEfficiency + p.volume_m3 * 0.003 * 24,
    notes,
    calcs: {
      hrt: { label: 'HRT', value: hrt * 24, unit: 'h', digits: 1 },
      srt: { label: 'SRT (sludge age)', value: srt, unit: 'd', digits: 1 },
      mlss: { label: 'MLSS', value: mlss, unit: 'mg/L', digits: 0 },
      mlvss: { label: 'MLVSS', value: mlvss, unit: 'mg/L', digits: 0 },
      fm: { label: 'F/M', value: fm, unit: 'kg bCOD/kg VSS·d', digits: 2 },
      S: { label: 'Effluent soluble bCOD', value: bio.S, unit: 'mg/L', digits: 1 },
      o2: { label: 'Oxygen demand', value: o2, unit: 'kg O₂/d', digits: 0 },
      sludge: { label: 'Net solids production', value: kg(solidsNet), unit: 'kg/d', digits: 0 },
      nitrified: { label: 'NH₄-N nitrified', value: bio.NOx, unit: 'mg/L', digits: 1 },
      pH: { label: 'Reactor pH', value: out.pH, unit: '', digits: 2 },
      inhib: { label: 'Heterotroph activity', value: inhib * 100, unit: '%', digits: 0 },
      inhibN: { label: 'Nitrifier activity', value: inhibN * 100, unit: '%', digits: 0 },
    },
  });
}
