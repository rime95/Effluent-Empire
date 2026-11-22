/**
 * Market price indices (1.0 = base prices in catalogue/PRICES and reagent tables). GAME MODEL:
 * bounded multiplicative random walk (±1.5 %/week) plus rare shocks (tariff revisions, supply disruptions).
 */
import { Rng } from './rng';

export interface Market {
  chemicals: number;
  electricity: number;
  sludge: number;
  history: { week: number; chemicals: number; electricity: number; sludge: number }[];
}

export function initialMarket(): Market {
  return { chemicals: 1, electricity: 1, sludge: 1, history: [{ week: 1, chemicals: 1, electricity: 1, sludge: 1 }] };
}

const clamp = (x: number) => Math.min(1.6, Math.max(0.7, x));

export function stepMarket(m: Market, week: number, rng: Rng): { market: Market; news: string | null } {
  let { chemicals, electricity, sludge } = m;
  chemicals = clamp(chemicals * (1 + rng.range(-0.015, 0.017)));
  electricity = clamp(electricity * (1 + rng.range(-0.006, 0.008)));
  sludge = clamp(sludge * (1 + rng.range(-0.01, 0.012)));
  let news: string | null = null;
  const shock = rng.next();
  if (shock < 0.012) {
    electricity = clamp(electricity * 1.2);
    news = 'Electricity tariff revised: +20 %. Aeration-heavy plants cost more to run.';
  } else if (shock < 0.022) {
    chemicals = clamp(chemicals * 1.15);
    news = 'Chemical supply disruption: treatment chemical prices +15 %.';
  } else if (shock < 0.03) {
    sludge = clamp(sludge * 1.25);
    news = 'Scheduled-waste disposal fees rise 25 %.';
  }
  const history = [...m.history, { week, chemicals, electricity, sludge }].slice(-156);
  return { market: { chemicals, electricity, sludge, history }, news };
}

/** Daily operating cost at current market prices, RM/d. */
export function marketOpex(split: { chemicals: number; energy: number; sludge: number; credit?: number }, m: Market): number {
  return split.chemicals * m.chemicals + split.energy * m.electricity + split.sludge * m.sludge - (split.credit ?? 0);
}
