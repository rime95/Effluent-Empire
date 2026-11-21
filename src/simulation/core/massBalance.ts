/**
 * Mass balance bookkeeping. Ref: knowledge/README.md §Mass balance, CLAUDE.md rule 5.
 *
 * For every unit:  in + produced = out + sludge + gas + consumed   (per component, kg/d)
 *   produced  — mass created by a documented transformation (e.g. coagulant Al dosed, biomass COD fixed from CO2 by nitrifiers)
 *   consumed  — mass destroyed by a documented transformation (e.g. COD oxidised by O2, NH4-N nitrified is NOT consumed: it becomes NO3-N)
 * Water (Q) is a component too: sludge underflow water is neglected in Phase 1 (documented).
 */
import { METALS, Stream, codTotal, nitrogenTotal, oilGrease } from './stream';
import { MW, kgPerDay } from './units';

export const COMPONENTS = ['Q', 'Ni', 'Cu', 'Zn', 'Cr', 'Al', 'Fe', 'SO4', 'COD', 'N', 'OG', 'mineral'] as const;
export type Component = (typeof COMPONENTS)[number];
export type Components = Record<Component, number>;

export function zeroComponents(): Components {
  return { Q: 0, Ni: 0, Cu: 0, Zn: 0, Cr: 0, Al: 0, SO4: 0, Fe: 0, COD: 0, N: 0, OG: 0, mineral: 0 };
}

/** Component mass flows of a stream, kg/d (Q in m³/d). includeWater=false for sludge streams. */
export function components(s: Stream, includeWater = true): Components {
  const k = (c: number) => kgPerDay(s.Q, c);
  const c = zeroComponents();
  c.Q = includeWater ? s.Q : 0;
  for (const m of METALS) c[m] = k(s.dissolved[m] + s.precipitated[m]);
  c.Cr += k(s.CrVI ?? 0);
  c.SO4 = k((s.SO4T ?? 0) * MW.SO4 * 1000);
  c.Al = k(s.alSolid + s.alDissolved);
  c.Fe = k(s.feSolid + (s.feDissolved ?? 0));
  c.COD = k(codTotal(s));
  c.N = k(nitrogenTotal(s));
  c.OG = k(oilGrease(s));
  c.mineral = k(s.grit + s.inert + s.colloid + s.floc);
  return c;
}

export function addComponents(...xs: Components[]): Components {
  const r = zeroComponents();
  for (const x of xs) for (const k of COMPONENTS) r[k] += x[k];
  return r;
}

export interface BalanceTerms {
  in: Components;
  out: Components;
  sludge: Components;
  gas: Components;
  consumed: Components;
  produced: Components;
}

export interface BalanceCheck {
  ok: boolean;
  /** relative error per component (|lhs − rhs| / max(lhs, ε)) */
  errors: Components;
}

export function checkMassBalance(t: BalanceTerms, tol = 1e-3): BalanceCheck {
  const errors = zeroComponents();
  let ok = true;
  for (const k of COMPONENTS) {
    const lhs = t.in[k] + t.produced[k];
    const rhs = t.out[k] + t.sludge[k] + t.gas[k] + t.consumed[k];
    const scale = Math.max(Math.abs(lhs), Math.abs(rhs), 1e-9);
    errors[k] = Math.abs(lhs - rhs) / scale;
    if (!Number.isFinite(lhs) || !Number.isFinite(rhs) || !Number.isFinite(errors[k])) {
      ok = false;
      continue;
    }
    // ignore trace components below 1 g/d
    if (errors[k] > tol && Math.abs(lhs - rhs) > 1e-3) ok = false;
  }
  return { ok, errors };
}
