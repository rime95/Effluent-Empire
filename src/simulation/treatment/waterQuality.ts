/**
 * Water-quality DISPLAY index for the SCADA live view (GAME MODEL, visual only — not a regulated quantity).
 * Ref: knowledge/operations/scada.md ("Live plant view").
 *
 * 0 = the stream meets every discharge limit of the plant's standard (clean blue), 1 = raw industrial strength
 * (≥ 30 × the worst limit, brown). In between it follows the log of the worst value ÷ limit ratio, so the colour shifts
 * step by step as each unit removes its share: wq = clamp(log10(ratio) / log10(30), 0, 1).
 */
import type { Stream } from '../core/stream';
import { limitsFor, measure, type ParamId, type StandardId } from './compliance';

/** ratio to the limit at which a stream is drawn fully "raw" */
export const WQ_RAW_RATIO = 30;

/** parameters that colour the water (temperature and the combined-metal sums are left out) */
const PARAMS: ParamId[] = ['COD', 'BOD5', 'TSS', 'OG', 'NH3N', 'Ni', 'Cu', 'Zn', 'CrVI', 'CrIII', 'Al', 'Fe'];

export function waterQualityIndex(s: Stream, standard: StandardId = 'B'): number {
  if (!(s.Q > 1e-9)) return 0;
  const lim = limitsFor(standard) as Partial<Record<ParamId, { min?: number; max?: number }>>;
  const m = measure(s);
  let worst = 0;
  for (const p of PARAMS) {
    const max = lim[p]?.max;
    if (max === undefined || max <= 0) continue;
    worst = Math.max(worst, m[p] / max);
  }
  // pH outside the range: each pH unit beyond the limit counts like a 10× exceedance
  const pl = lim.pH;
  if (pl) {
    const d = m.pH < (pl.min ?? -Infinity) ? (pl.min ?? 0) - m.pH : m.pH > (pl.max ?? Infinity) ? m.pH - (pl.max ?? 14) : 0;
    if (d > 0) worst = Math.max(worst, Math.pow(10, d));
  }
  if (worst <= 1) return 0;
  return Math.min(1, Math.log10(worst) / Math.log10(WQ_RAW_RATIO));
}
