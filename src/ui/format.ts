export const rm = (x: number) => `RM ${Math.round(x).toLocaleString('en-MY')}`;
export const rmk = (x: number) => (Math.abs(x) >= 1e6 ? `RM ${(x / 1e6).toFixed(2)}m` : `RM ${(x / 1000).toFixed(0)}k`);
export function fmt(x: number | undefined, digits = 1): string {
  if (x === undefined || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return '∞';
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString('en-MY');
  if (Math.abs(x) < 0.1 && x !== 0) return x.toPrecision(2);
  return x.toFixed(digits);
}
export const INDUSTRY_LABEL: Record<string, string> = { plating: 'Metal Finishing', food: 'Food Processing', semiconductor: 'Semiconductor' };
