/**
 * Pure helpers for SCADA trend axes (no React, no chart library): which tags share an axis, axis ranges that never
 * blow instrument noise up to full scale, and tick labels that can never repeat. Ref: knowledge/operations/scada.md.
 */

/** Axis group per tag: tags in one group share a y-axis (same quantity, same engineering unit, comparable magnitude). */
export interface AxisGroup {
  id: string;
  /** axis label, e.g. "pH", "mg/L", "%" */
  label: string;
  /** smallest range the axis may show, so a steady signal reads as a flat line (instrument-scale noise is not magnified) */
  minSpan: (mean: number) => number;
  /** physically possible range (domain is clipped to it) */
  bounds?: [number, number];
}

const rel = (f: number, floor: number) => (m: number) => Math.max(f * Math.abs(m), floor);

export const AXIS_GROUPS: Record<string, AxisGroup> = {
  pH: { id: 'pH', label: 'pH', minSpan: () => 1, bounds: [0, 14] },
  pct: { id: 'pct', label: '%', minSpan: () => 20, bounds: [0, 100] },
  DO: { id: 'DO', label: 'DO mg/L', minSpan: () => 2, bounds: [0, 20] },
  MLSS: { id: 'MLSS', label: 'MLSS mg/L', minSpan: rel(0.2, 500), bounds: [0, Infinity] },
  N: { id: 'N', label: 'mg N/L', minSpan: rel(0.2, 2), bounds: [0, Infinity] },
  OUR: { id: 'OUR', label: 'mg O₂/L·h', minSpan: rel(0.2, 10), bounds: [0, Infinity] },
  flow: { id: 'flow', label: 'm³/d', minSpan: rel(0.2, 1), bounds: [0, Infinity] },
  TSS: { id: 'TSS', label: 'TSS mg/L', minSpan: rel(0.2, 5), bounds: [0, Infinity] },
  SOR: { id: 'SOR', label: 'SOR m/h', minSpan: rel(0.2, 0.5), bounds: [0, Infinity] },
  conc: { id: 'conc', label: 'mg/L', minSpan: rel(0.2, 0.01), bounds: [0, Infinity] },
};

/** Tag → axis group. Unknown tags fall back to a generic concentration axis. */
export const TAG_GROUP: Record<string, string> = {
  pH: 'pH',
  pHmeasured: 'pH',
  sp: 'pH',
  pump: 'pct',
  level: 'pct',
  blower: 'pct',
  carry: 'pct',
  DO: 'DO',
  MLSS: 'MLSS',
  NH4: 'N',
  NO3: 'N',
  OUR: 'OUR',
  outflow: 'flow',
  overflow: 'flow',
  TSS: 'TSS',
  SOR: 'SOR',
};

export function groupOf(tag: string): AxisGroup {
  return AXIS_GROUPS[TAG_GROUP[tag] ?? 'conc'];
}

/**
 * Assign selected tags to at most two axes, in selection order: tags of the first group go left, of the second group
 * right. A tag of a third group replaces nothing — it is returned in `dropped` so the UI can say why it is not shown.
 */
export function groupByUnit(tags: string[]): { left?: { group: AxisGroup; tags: string[] }; right?: { group: AxisGroup; tags: string[] }; dropped: string[] } {
  const out: ReturnType<typeof groupByUnit> = { dropped: [] };
  for (const t of tags) {
    const g = groupOf(t);
    if (!out.left || out.left.group.id === g.id) (out.left ??= { group: g, tags: [] }).tags.push(t);
    else if (!out.right || out.right.group.id === g.id) (out.right ??= { group: g, tags: [] }).tags.push(t);
    else out.dropped.push(t);
  }
  return out;
}

export interface Axis {
  domain: [number, number];
  ticks: number[];
  /** decimals for tick labels — from the tick step, so neighbouring ticks never print the same */
  decimals: number;
}

/** A "nice" tick step (1, 2, 2.5 or 5 × 10^k) giving about `target` intervals over `span`. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0) || !isFinite(span)) return 1;
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * p;
}

/** Decimals needed to print multiples of `step` exactly (2.5 → 1, 0.25 → 2, 0.2 → 1, 50 → 0). */
export function stepDecimals(step: number): number {
  for (let d = 0; d <= 8; d++) {
    const s = step * Math.pow(10, d);
    if (Math.abs(s - Math.round(s)) < 1e-6 * Math.max(1, s)) return d;
  }
  return 8;
}

export function niceTicks(lo: number, hi: number, target = 5): Axis {
  const step = niceStep(hi - lo, target);
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, decimals: stepDecimals(step) };
}

/**
 * Axis for a set of values plus reference lines (set-point, discharge limits) that must stay in view.
 * The range is at least the group's minimum span (centred on the data), padded 5 %, clipped to physical bounds,
 * then rounded out to nice ticks.
 */
export function axisDomain(values: number[], group: AxisGroup, refs: number[] = []): Axis {
  const v = values.filter((x) => Number.isFinite(x));
  const r = refs.filter((x) => Number.isFinite(x));
  const all = [...v, ...r];
  if (!all.length) return niceTicks(0, 1);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : (lo + hi) / 2;
  const span = Math.max(hi - lo, group.minSpan(mean));
  const mid = (lo + hi) / 2;
  lo = Math.min(lo, mid - span / 2);
  hi = Math.max(hi, mid + span / 2);
  const pad = 0.05 * (hi - lo);
  lo -= pad;
  hi += pad;
  if (group.bounds) {
    const [bl, bh] = group.bounds;
    // keep the span when clipping: shift instead of squashing
    if (lo < bl) {
      hi = Math.min(bh, hi + (bl - lo));
      lo = bl;
    }
    if (hi > bh) {
      lo = Math.max(bl, lo - (hi - bh));
      hi = bh;
    }
  }
  const ax = niceTicks(lo, hi);
  if (group.bounds) {
    // nice rounding can step past a physical bound (pH 0–15): clip ticks and domain back inside
    const [bl, bh] = group.bounds;
    ax.ticks = ax.ticks.filter((t) => t >= bl - 1e-9 && t <= bh + 1e-9);
    ax.domain = [Math.max(bl, ax.domain[0]), Math.min(bh, ax.domain[1])];
  }
  return ax;
}

export function tickLabel(v: number, decimals: number): string {
  // large values with thousands separators (exact, so neighbouring ticks never print the same)
  if (Math.abs(v) >= 10_000 && decimals === 0) return Math.round(v).toLocaleString('en-US');
  return v.toFixed(decimals);
}

/** Replay hour → "D1 06:15" (two-day replay starting at midnight). */
export function clockLabel(tH: number): string {
  const min = Math.round(tH * 60);
  let day = Math.floor(min / 1440) + 1;
  let m = min % 1440;
  if (m === 0 && day > 1 && tH >= 48 - 1e-9) {
    day -= 1;
    m = 1440; // the end of the replay is shown as 24:00 of the last day
  }
  return `D${day} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Compact time-axis ticks every 6 h (fit a narrow chart): "D1", "06", "12", "18", "D2", … "24h". */
export function timeTick(tH: number): string {
  if (tH >= 48 - 1e-9) return '24h';
  if (tH % 24 === 0) return `D${tH / 24 + 1}`;
  return String(Math.round(tH % 24)).padStart(2, '0');
}
