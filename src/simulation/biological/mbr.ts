/**
 * Membrane bioreactor (MBR): activated sludge at high MLSS with submerged UF membranes instead of a clarifier.
 * Ref: knowledge/biological/mbr.md
 *
 * The biology is the activated-sludge model (MLSS control, wasting at the set-point). The membrane retains every solid,
 * so the permeate carries only dissolved species and the waste sludge leaves at the MLSS concentration.
 * GAME MODEL:
 *  - aeration α-factor falls with MLSS: α = exp(−0.0879·MLSS[g/L]) (Krampe & Krauth 2003), so blower energy is scaled by
 *    α(3 g/L)/α(MLSS) relative to the conventional basis of the activated-sludge model;
 *  - membrane scour air SAD_m = 0.3 Nm³/m²·h at 0.025 kWh/Nm³; permeate pumping 0.05 kWh/m³ (verify);
 *  - design flux 15–25 L/m²·h; membrane replacement every ~8 years (CAPEX, not modelled as OPEX).
 */
import { POOLS, Stream } from '../core/stream';
import { splitPools } from '../core/stream';
import { activatedSludgeControlled } from './activatedSludge';
import { AlkReagent } from './aeration';
import { Note, ProcessResult } from '../treatment/types';

export const MBR = { sadM: 0.3, scourKWhNm3: 0.025, permKWh_m3: 0.05, alphaK: 0.0879, designFlux: 20 };

export function membraneBioreactor(s: Stream, p: { volume_m3: number; mlss_mgL: number; area_m2: number; do_mgL: number; alkPH?: number; alkReagent?: AlkReagent }): ProcessResult {
  const as = activatedSludgeControlled(s, { volume_m3: p.volume_m3, srt_d: 20, do_mgL: p.do_mgL, alkPH: p.alkPH, alkReagent: p.alkReagent, control: 'mlss', mlssTarget_mgL: p.mlss_mgL, ras: 4 }, { clarifierFollows: true });
  // clarifier-specific advice does not apply to a membrane tank
  const notes: Note[] = as.notes.filter((n) => !/clar|settl|svi|bulking|ras/i.test(n.code));
  const all: Record<string, number> = {};
  for (const pool of POOLS) all[pool] = 1;
  const { out, removed } = splitPools(as.out, all);
  // oil the biology adsorbed onto the floc (AS model's own removed stream) leaves with the waste sludge too
  removed.OGfree = as.out.OGfree + (as.removed?.OGfree ?? 0);
  removed.OGemulsified = as.out.OGemulsified + (as.removed?.OGemulsified ?? 0);
  removed.OGfloc = as.out.OGfloc ?? 0;
  out.OGfree = out.OGemulsified = out.OGfloc = 0;
  out.ml = undefined;
  const mlssGL = p.mlss_mgL / 1000;
  const alphaRatio = Math.exp(-MBR.alphaK * 3) / Math.exp(-MBR.alphaK * mlssGL);
  const flux = (s.Q * 1000) / 24 / Math.max(p.area_m2, 1e-6);
  const scour = p.area_m2 * MBR.sadM * 24 * MBR.scourKWhNm3;
  if (flux > 30) notes.push({ level: 'warn', code: 'mbr.flux', text: `Membrane flux ${flux.toFixed(0)} L/m²·h is above the 15–25 LMH an MBR sustains — the membranes foul; add cassettes.` });
  if (p.mlss_mgL > 14000) notes.push({ level: 'warn', code: 'mbr.mlss', text: `MLSS ${p.mlss_mgL.toFixed(0)} mg/L: viscous mixed liquor — oxygen transfer collapses and the membranes clog. Hold 8,000–12,000 mg/L.` });
  if (s.OGfree + s.OGemulsified > 50) notes.push({ level: 'warn', code: 'mbr.oil', text: 'Oil above ~50 mg/L fouls the membranes irreversibly — remove it upstream.' });
  return {
    ...as,
    out,
    removed,
    notes,
    sludgeSolidsFrac: p.mlss_mgL / 1e6,
    energy_kWhd: as.energy_kWhd * alphaRatio + scour + MBR.permKWh_m3 * s.Q,
    calcs: {
      ...as.calcs,
      flux: { label: 'Membrane flux', value: flux, unit: 'L/m²·h', digits: 0 },
      alpha: { label: 'α-factor (oxygen transfer)', value: Math.exp(-MBR.alphaK * mlssGL), unit: '', digits: 2 },
      scour: { label: 'Membrane scour air energy', value: scour, unit: 'kWh/d', digits: 0 },
    },
  };
}
