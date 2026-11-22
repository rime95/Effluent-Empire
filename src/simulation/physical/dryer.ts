/**
 * Thermal sludge dryer (indirect / belt). Ref: knowledge/physical/sludge_drying.md
 * Mass balance on water; heat = W·(h_fg + c_p·ΔT)/η_th, supplied by LPG. Product (granules) to the sludge port at the
 * target dry solids; condensate to the main outlet.
 */
import { POOLS, Stream, poolMass, splitPools } from '../core/stream';
import { Note, ProcessResult, result } from '../treatment/types';

export const DRYER = {
  hfg_MJkg: 2.257,
  cp_kJkgK: 4.19,
  /** thermal efficiency of an indirect dryer (verify) */
  etaTh: 0.75,
  /** auxiliary electricity, kWh per kg water evaporated (verify) */
  auxKWhPerKg: 0.06,
  /** LPG lower heating value, kWh/kg */
  lpgKWhPerKg: 12.8,
  /** LPG price, RM/kg (GAME MODEL, verify industrial bulk price) */
  lpgRMkg: 3.0,
};

/** Dry solids of a stream (all particulate pools + oil), kg/d. */
export function drySolidsKgD(s: Stream): number {
  return (s.Q * (POOLS.reduce((a, p) => a + poolMass(s, p), 0) + s.OGfree + s.OGemulsified + (s.OGfloc ?? 0))) / 1000;
}

/** Heat per kg of water evaporated, kWh_th (sensible heat from the feed temperature to 100 °C + latent heat, ÷ η). */
export function heatPerKgWater_kWh(Tfeed: number): number {
  return (DRYER.hfg_MJkg + (DRYER.cp_kJkgK / 1000) * Math.max(0, 100 - Tfeed)) / 3.6 / DRYER.etaTh;
}

export function dry(s: Stream, p: { targetDS_pct: number }): ProcessResult {
  const target = Math.min(0.95, Math.max(0.3, p.targetDS_pct / 100));
  const D = drySolidsKgD(s);
  const feedKg = s.Q * 1000;
  const dsIn = D / Math.max(feedKg, 1e-9);
  const productKg = Math.min(feedKg, D / target);
  const W = Math.max(0, feedKg - productKg);
  const qTh = W * heatPerKgWater_kWh(s.T);
  const lpgKg = qTh / DRYER.lpgKWhPerKg;
  // every solid leaves with the product
  const all: Record<string, number> = {};
  for (const pool of POOLS) all[pool] = 1;
  const { out, removed } = splitPools(s, all);
  removed.OGfree = s.OGfree;
  removed.OGemulsified = s.OGemulsified;
  removed.OGfloc = s.OGfloc ?? 0;
  out.OGfloc = 0;
  out.OGfree = 0;
  out.OGemulsified = 0;
  const notes: Note[] = [];
  if (dsIn < 0.15 && D > 0) notes.push({ level: 'warn', code: 'dryer.thin', text: `Feed is only ${(dsIn * 100).toFixed(1)} % dry solids — dewater it in a filter press first; drying thin sludge costs several times more energy per tonne of solids.` });
  if (target > 0.9) notes.push({ level: 'warn', code: 'dryer.dust', text: `Drying above 90 % DS makes dusty granules that can self-heat — 80–85 % is the usual target.` });
  if (W === 0 && D > 0) notes.push({ level: 'info', code: 'dryer.idle', text: `The feed (${(dsIn * 100).toFixed(0)} % DS) is already at or above the target — nothing to evaporate.` });
  const evapKgH = W / 24;
  return result(out, {
    removed,
    notes,
    energy_kWhd: W * DRYER.auxKWhPerKg,
    sludgeSolidsFrac: Math.max(target, dsIn),
    chemicals: lpgKg > 0 ? [{ name: 'LPG fuel (dryer burner)', kgPerDay: lpgKg, priceRMkg: DRYER.lpgRMkg }] : [],
    calcs: {
      dsIn: { label: 'Feed dry solids', value: dsIn * 100, unit: '%', digits: 1 },
      dsOut: { label: 'Product dry solids', value: Math.max(target, dsIn) * 100, unit: '%', digits: 0 },
      dry: { label: 'Dry solids throughput', value: D, unit: 'kg/d', digits: 1 },
      evap: { label: 'Water evaporated', value: W, unit: 'kg/d', digits: 0 },
      evapH: { label: 'Evaporation capacity (24 h)', value: evapKgH, unit: 'kg/h', digits: 1 },
      heat: { label: 'Heat demand', value: qTh, unit: 'kWh/d', digits: 0 },
      spec: { label: 'Specific heat (incl. efficiency)', value: heatPerKgWater_kWh(s.T), unit: 'kWh/kg H₂O', digits: 2 },
      cut: { label: 'Wet tonnage reduction', value: feedKg > 0 ? (100 * (feedKg - productKg)) / feedKg : 0, unit: '%', digits: 0 },
    },
  });
}
