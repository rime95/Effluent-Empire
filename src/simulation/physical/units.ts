import { clarifierUnderflowFraction, removedDryKgD } from './sludge';
/**
 * Physical separation units: equalisation, gravity oil separator, clarifier, rapid sand filter.
 * Ref: knowledge/physical/sedimentation.md, knowledge/physical/filtration.md, knowledge/design/design_parameters.md
 */
import { POOLS, Pool, Stream, cloneStream, poolMass, splitPools } from '../core/stream';
import { hrtDays, surfaceOverflowRate_mh } from '../core/units';
import { Note, ProcessResult, result } from '../treatment/types';
import { hazenRemoval, stokesVelocity_mh, vesilind_mh } from './settling';

// ---------------------------------------------------------------- Equalisation
/**
 * Flow equalisation. GAME MODEL: peak factor decays first-order with retention time:
 *   PF_out = 1 + (PF_in − 1)·exp(−HRT_h / 6 h)
 * (6 h ≈ the storage needed to absorb a typical single-shift discharge pattern.)
 */
export function equalise(s: Stream, p: { volume_m3: number }): ProcessResult {
  const out = cloneStream(s);
  const hrt_h = hrtDays(p.volume_m3, s.Q) * 24;
  out.peakFactor = 1 + (s.peakFactor - 1) * Math.exp(-hrt_h / 6);
  const notes: Note[] = [];
  if (hrt_h < 4) notes.push({ level: 'warn', code: 'eq.small', text: `EQ retention ${hrt_h.toFixed(1)} h is small; peak flows still reach downstream units.` });
  return result(out, {
    notes,
    energy_kWhd: p.volume_m3 * 0.005 * 24, // mixing ≈ 5 W/m³
    calcs: {
      hrt: { label: 'Retention time', value: hrt_h, unit: 'h', digits: 1 },
      pfIn: { label: 'Peak factor in', value: s.peakFactor, unit: '×', digits: 2 },
      pfOut: { label: 'Peak factor out', value: out.peakFactor, unit: '×', digits: 2 },
    },
  });
}

// ---------------------------------------------------------------- Oil separator
/**
 * Gravity (API-type) oil separator: free-oil droplets rise at Stokes velocity; removal by Hazen theory with
 * rise velocity instead of settling velocity. Emulsified oil (d < ~20 µm) is not separable.
 * Free-oil droplet median diameter 100 µm, ρ_oil 900 kg/m³ (GAME MODEL defaults; API design droplet = 150 µm).
 */
export const FREE_OIL_D50_M = 100e-6;
export const OIL_DENSITY = 900;

export function separateOil(s: Stream, p: { area_m2: number }): ProcessResult {
  const SOR = surfaceOverflowRate_mh(s.Q * s.peakFactor, p.area_m2);
  const vRise = -stokesVelocity_mh(FREE_OIL_D50_M, OIL_DENSITY, s.T);
  const rOil = hazenRemoval(vRise, SOR, 1.0);
  const rGrit = hazenRemoval(s.v50.grit, SOR);
  const { out, removed } = splitPools(s, { grit: rGrit, inert: hazenRemoval(s.v50.inert, SOR) * 0.5 });
  removed.OGfree = s.OGfree * rOil;
  out.OGfree = s.OGfree * (1 - rOil);
  const notes: Note[] = [];
  if (s.OGemulsified > 0.3 * (s.OGfree + s.OGemulsified))
    notes.push({ level: 'info', code: 'ogs.emulsion', text: `${s.OGemulsified.toFixed(0)} mg/L of the oil is emulsified and cannot be separated by gravity — coagulation breaks emulsions.` });
  return result(out, {
    removed,
    notes,
    calcs: {
      sor: { label: 'Surface loading (peak)', value: SOR, unit: 'm/h', digits: 2 },
      vRise: { label: 'Oil droplet rise velocity (Stokes, 100 µm)', value: vRise, unit: 'm/h', digits: 2 },
      rOil: { label: 'Free-oil removal', value: rOil * 100, unit: '%', digits: 0 },
    },
  });
}

// ---------------------------------------------------------------- Clarifier
/** GAME MODEL: non-settleable fines fraction per pool (dispersed particles that escape any ideal basin). */
const POOL_LABEL: Record<Pool, string> = { grit: 'grit', inert: 'mineral solids', colloid: 'colloids', floc: 'floc', organic: 'organic particles', precipitate: 'metal hydroxide', alFloc: 'Al(OH)₃ floc', feFloc: 'Fe(OH)₃ floc', biomass: 'biomass' };

const FINES: Record<Pool, number> = { grit: 0, inert: 0.01, colloid: 0, floc: 0.01, organic: 0.05, precipitate: 0.02, alFloc: 0.01, feFloc: 0.01, biomass: 0.01 };

/**
 * Non-settleable fines of the precipitate pool: 2 % for pin floc, falling to 0.3 % once the hydroxide is enmeshed in
 * well-coagulated floc (v₅₀ ≥ 2 m/h) — the same curve as every other pool (process review 2026-11-21: the hydroxide
 * carries the metals, so it must not keep more fines than the floc it settles in). GAME MODEL.
 */
export function precipitateFines(v50: number): number {
  return flocFines(v50, 0.02);
}

/**
 * Lamella plates fill the settling zone: effective area = η·A_plates·cosθ (θ = 55°, η = 0.8; verify), never less than the
 * plan area (chemistry review: plates cover the plan area, so it must not be counted twice).
 */
export const LAMELLA = { angleDeg: 55, efficiency: 0.8 };
export function effectiveSettlingArea(plan_m2: number, plate_m2: number): number {
  return Math.max(plan_m2, LAMELLA.efficiency * Math.max(0, plate_m2) * Math.cos((LAMELLA.angleDeg * Math.PI) / 180));
}

/**
 * Non-settleable fines of a pool: the dispersed fraction (FINES) applies to poorly flocculated solids; solids enmeshed
 * in well-coagulated floc (v₅₀ ≥ 2 m/h) are captured with the floc and only 0.3 % escape (GAME MODEL, verify: a
 * well-run chemical clarifier gives ≈ 5–20 mg/L effluent TSS; practitioner input 2026-11-21).
 */
export function flocFines(v50: number, base: number): number {
  if (base <= 0.003) return base;
  const t = Math.min(1, Math.max(0, Math.log(Math.max(v50, 0.5) / 0.5) / Math.log(4)));
  return base + (0.003 - base) * t;
}

/** Sludge blanket compaction limit: a slower desludge pump lets the blanket thicken to ≈ 1.5× the typical underflow (GAME MODEL, verify). */
export const BLANKET_MAX_FACTOR = 1.5;
/** …but never beyond what a desludge pump can move (≈ 10 % solids). */
export const BLANKET_MAX_SOLIDS = 0.1;
/** Order in which solids leave over the weir when the blanket rises: lightest first, grit and mineral last. */
const BLANKET_LOSS_ORDER: Pool[] = ['colloid', 'biomass', 'alFloc', 'feFloc', 'floc', 'precipitate', 'organic', 'inert', 'grit'];

export function clarify(s: Stream, p: { area_m2: number; depth_m?: number; plateArea_m2?: number; desludge_m3d?: number }): ProcessResult {
  const depth = p.depth_m ?? 3.5;
  const Qpeak = s.Q * s.peakFactor;
  const plates = !s.ml ? Math.max(0, p.plateArea_m2 ?? 0) : 0; // lamella packs do not help zone-settling mixed liquor
  const SOR = surfaceOverflowRate_mh(Qpeak, effectiveSettlingArea(p.area_m2, plates));
  const removal: Partial<Record<Pool, number>> = {};
  for (const pool of POOLS) removal[pool] = (1 - flocFines(s.v50[pool], FINES[pool])) * hazenRemoval(s.v50[pool], SOR);
  const notes: Note[] = [];
  const calcs: ProcessResult['calcs'] = {
    sor: { label: plates > 0 ? 'Surface overflow rate (peak, on effective lamella area)' : 'Surface overflow rate (peak)', value: SOR, unit: 'm/h', digits: 2 },
    ...(plates > 0 ? { aeff: { label: 'Effective settling area', value: effectiveSettlingArea(p.area_m2, plates), unit: 'm²', digits: 0 } } : {}),
    sorD: { label: 'Surface overflow rate (avg)', value: (s.Q / p.area_m2), unit: 'm³/m²·d', digits: 1 },
    hrt: { label: 'Hydraulic retention (avg)', value: hrtDays(p.area_m2 * depth, s.Q) * 24, unit: 'h', digits: 1 },
  };

  // Secondary clarifier after activated sludge: zone settling of mixed liquor (Vesilind) controls carry-over.
  if (s.ml && s.biomass > 0) {
    const mlss = s.ml.mlss;
    const vs = vesilind_mh(mlss);
    const f = SOR / vs;
    // GAME MODEL: dispersed-growth fines rise at short SRT; blanket loss as SOR approaches zone-settling velocity
    const fines = 0.004 * (1 + 2 * Math.max(0, (4 - s.ml.srt) / 4));
    const carry = mlss * (fines + 0.2 * Math.pow(Math.max(0, f - 0.7), 2));
    // zone settling: the whole mixed-liquor floc settles together -> one carry-over fraction for every pool
    const totalTSS = POOLS.reduce((a, pl) => a + poolMass(s, pl), 0);
    const keep = Math.min(1, carry / Math.max(totalTSS, 1e-9));
    for (const pool of POOLS) removal[pool] = 1 - keep;
    const R = s.ml.ras ?? 0.75;
    const slr = ((Qpeak + R * s.Q) * mlss) / 1000 / 24 / p.area_m2; // kg/m²·h, RAS R·Q_avg
    calcs.vs = { label: 'Zone settling velocity (Vesilind)', value: vs, unit: 'm/h', digits: 2 };
    calcs.slr = { label: `Solids loading rate (peak, RAS ${R.toFixed(2)}Q)`, value: slr, unit: 'kg/m²·h', digits: 1 };
    if (f > 0.8) notes.push({ level: 'error', code: 'clar.blanket', text: `Peak SOR ${SOR.toFixed(2)} m/h is close to the sludge zone-settling velocity ${vs.toFixed(2)} m/h — sludge blanket washes over the weir.` });
    if (slr > 9) notes.push({ level: 'warn', code: 'clar.slr', text: `Peak solids loading ${slr.toFixed(1)} kg/m²·h exceeds ~9 kg/m²·h: thickening-limited.` });
  }
  if ((p.plateArea_m2 ?? 0) > 0 && s.ml) notes.push({ level: 'warn', code: 'clar.lamellaML', text: 'Lamella plates do not help a secondary clarifier: mixed liquor settles as a zone (hindered settling), and plates foul with biomass.' });
  // per-pool removal breakdown (shown in the Studio inspector)
  for (const pool of POOLS) {
    if (poolMass(s, pool) < 0.5) continue;
    calcs[`rm_${pool}`] = { label: `Removed: ${POOL_LABEL[pool]} (v₅₀ ${s.v50[pool].toFixed(2)} m/h)`, value: 100 * (removal[pool] ?? 0), unit: '%', digits: 0 };
  }
  const precMass = poolMass(s, 'precipitate');
  if (!s.ml && precMass > 1 && (removal.precipitate ?? 0) < 0.8)
    notes.push({ level: 'warn', code: 'clar.pinfloc', text: `Metal-hydroxide pin floc (v₅₀ ${s.v50.precipitate.toFixed(2)} m/h) settles far slower than the peak overflow rate ${SOR.toFixed(2)} m/h: only ${(100 * (removal.precipitate ?? 0)).toFixed(0)} % is captured. Add coagulant + polymer flocculant upstream, enlarge the clarifier, or add lamella plates.` });
  // scum skimming: free oil rises (Stokes) and is skimmed; emulsified oil enmeshed in floc settles with it
  const rOilC = hazenRemoval(-stokesVelocity_mh(FREE_OIL_D50_M, OIL_DENSITY, s.T), SOR, 1.0);
  calcs.rOil = { label: 'Free-oil skimming', value: rOilC * 100, unit: '%', digits: 0 };
  const separate = () => {
    const r = splitPools(s, removal);
    r.removed.OGfree = s.OGfree * rOilC;
    r.out.OGfree = s.OGfree * (1 - rOilC);
    return r;
  };
  let { out, removed } = separate();
  // desludge pump (primary / chemical clarifier): auto draws exactly what settles at the typical underflow concentration.
  // A set pump flow fixes the underflow: more water → thinner sludge; too little → the blanket rises and the excess
  // solids (lightest first) leave over the weir (steady state). Skimmed oil is pumped with the sludge.
  let wUnder: number | undefined;
  const qSet = Math.max(0, p.desludge_m3d ?? 0);
  if (qSet > 0 && s.ml) notes.push({ level: 'info', code: 'clar.desludgeML', text: 'Desludge pump setting ignored: after activated sludge the RAS/WAS system sets the underflow.' });
  let qp = !s.ml ? qSet : 0;
  if (qp > 0.95 * s.Q && s.Q > 0) {
    notes.push({ level: 'error', code: 'clar.desludgeDrain', text: `Desludge pump ${qp.toFixed(1)} m³/d is more than the clarifier receives (${s.Q.toFixed(1)} m³/d) — it would drain the tank. Limited to 95 % of the inflow.` });
    qp = 0.95 * s.Q;
  }
  if (qp > 0) {
    const dry = removedDryKgD(removed);
    const wNat = clarifierUnderflowFraction(removed);
    const wMax = Math.min(BLANKET_MAX_FACTOR * wNat, Math.max(wNat, BLANKET_MAX_SOLIDS));
    const canCarry = qp * wMax * 1000; // kg/d
    if (dry > canCarry && dry > 0) {
      // the blanket rises: shed the lightest solids first until the underflow carries only what the pump can move
      let excess = dry - canCarry; // kg/d
      for (const pool of BLANKET_LOSS_ORDER) {
        if (excess <= 0) break;
        const kg = (s.Q * poolMass(s, pool) * (removal[pool] ?? 0)) / 1000;
        if (kg <= 0) continue;
        const shed = Math.min(kg, excess);
        removal[pool] = (removal[pool] ?? 0) * (1 - shed / kg);
        excess -= shed;
      }
      ({ out, removed } = separate());
      wUnder = wMax;
      notes.push({ level: 'error', code: 'clar.desludge', text: `Desludge pump ${qp.toFixed(2)} m³/d can only carry ${canCarry.toFixed(1)} kg/d of sludge (blanket at ${(wMax * 100).toFixed(1)} %): the blanket rises and ${(dry - canCarry).toFixed(1)} kg/d of the lightest floc goes over the weir. Pump at least ${(dry / (wMax * 1000)).toFixed(2)} m³/d (${(dry / (wNat * 1000)).toFixed(2)} m³/d for a normal blanket).` });
    } else if (dry > 0) {
      wUnder = dry / (qp * 1000);
      if (wUnder < wNat / 3) notes.push({ level: 'info', code: 'clar.desludgeThin', text: `Desludge pump draws ${qp.toFixed(2)} m³/d for ${dry.toFixed(1)} kg/d — the sludge is only ${(wUnder * 100).toFixed(2)} % solids, so the thickener/press handles extra water. About ${(dry / (wNat * 1000)).toFixed(2)} m³/d is enough.` });
    }
  }
  out.ml = undefined;
  const carried = (['Ni', 'Cu', 'Zn', 'Cr'] as const).filter((m) => out.precipitated[m] > 0.05);
  if (carried.length) calcs.metalCarry = { label: `Particulate metal carried over (${carried.join(', ')})`, value: carried.reduce((a, m) => a + out.precipitated[m], 0), unit: 'mg/L', digits: 2 };
  if (SOR > 2.0) notes.push({ level: 'warn', code: 'clar.sor', text: `Peak SOR ${SOR.toFixed(2)} m/h is high for chemical floc (typical ≤ 1.5 m/h).` });
  const sludgeKg = (s.Q * POOLS.reduce((a, pl) => a + poolMass(removed, pl), 0)) / 1000;
  calcs.sludge = { label: 'Sludge produced (dry)', value: sludgeKg, unit: 'kg/d', digits: 1 };
  const w = s.ml?.xr ? s.ml.xr / 1e6 : wUnder ?? clarifierUnderflowFraction(removed);
  if (sludgeKg > 0) {
    calcs.uSolids = { label: s.ml?.xr ? 'Underflow solids (= RAS/WAS conc. Xr)' : qp > 0 ? 'Underflow solids (set by desludge pump)' : 'Underflow solids (auto desludge, by sludge make-up)', value: w * 100, unit: '%', digits: 2 };
    calcs.uFlow = { label: 'Underflow (sludge) flow = dry solids ÷ underflow solids', value: removedDryKgD(removed) / (w * 1000), unit: 'm³/d', digits: 2 };
  }
  // secondary clarifier: the sludge port carries WAS at the RAS/WAS underflow concentration Xr
  return result(out, { removed, notes, calcs, energy_kWhd: 0.5 * 24, ...(s.ml?.xr ? { sludgeSolidsFrac: s.ml.xr / 1e6 } : wUnder !== undefined ? { sludgeSolidsFrac: wUnder } : {}) });
}

// ---------------------------------------------------------------- Rapid sand filter
/**
 * Depth filtration, iwasaki: C/C0 = exp(−λ·L). GAME MODEL: λ scales with filtration rate as (5 / v)^0.7
 * following the decline of single-collector efficiency with approach velocity (Yao et al. 1971).
 * λ0 at 5 m/h (1/m) per pool; floc-like particles are captured best.
 */
const LAMBDA0: Record<Pool, number> = { grit: 6, inert: 3, colloid: 0.15, floc: 3.5, organic: 2, precipitate: 1.2, alFloc: 3.5, feFloc: 3.5, biomass: 2.5 };

export function filter(s: Stream, p: { area_m2: number; depth_m?: number }): ProcessResult {
  const L = p.depth_m ?? 1.0;
  const rate = surfaceOverflowRate_mh(s.Q * s.peakFactor, p.area_m2);
  const removal: Partial<Record<Pool, number>> = {};
  for (const pool of POOLS) {
    let l0 = LAMBDA0[pool];
    if (pool === 'precipitate') l0 = 1.2 + 2.3 * Math.min(1, s.v50.precipitate / 2.5); // flocculated precipitate filters like floc
    removal[pool] = 1 - Math.exp(-l0 * Math.pow(5 / Math.max(rate, 0.1), 0.7) * L);
  }
  const { out, removed } = splitPools(s, removal);
  // oil retained in the bed (GAME MODEL λ0: free 1.5 /m, emulsified 0.3 /m)
  const vf = Math.pow(5 / Math.max(rate, 0.1), 0.7) * L;
  const rFree = 1 - Math.exp(-1.5 * vf);
  const rEm = 1 - Math.exp(-0.3 * vf);
  removed.OGfree = s.OGfree * rFree;
  removed.OGemulsified = s.OGemulsified * rEm;
  out.OGfree = s.OGfree * (1 - rFree);
  out.OGemulsified = s.OGemulsified * (1 - rEm);
  const notes: Note[] = [];
  const tssIn = POOLS.reduce((a, pl) => a + poolMass(s, pl), 0);
  if (rate > 12) notes.push({ level: 'warn', code: 'filt.rate', text: `Filtration rate ${rate.toFixed(1)} m/h at peak exceeds 12 m/h — breakthrough risk.` });
  if (tssIn > 80) notes.push({ level: 'warn', code: 'filt.load', text: `Filter feed TSS ${tssIn.toFixed(0)} mg/L is high (> 80): very short runs between backwashes.` });
  return result(out, {
    removed,
    notes,
    energy_kWhd: 0.03 * s.Q, // feed + backwash pumping ≈ 0.03 kWh/m³
    calcs: {
      rate: { label: 'Filtration rate (peak)', value: rate, unit: 'm/h', digits: 1 },
      depth: { label: 'Bed depth', value: L, unit: 'm', digits: 1 },
    },
  });
}
