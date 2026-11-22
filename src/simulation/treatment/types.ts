import { Components } from '../core/massBalance';
import { Stream } from '../core/stream';

export type NoteLevel = 'info' | 'warn' | 'error';
export interface Note {
  level: NoteLevel;
  code: string;
  text: string;
}

export interface Calc {
  label: string;
  value: number;
  unit: string;
  digits?: number;
}

export interface ChemicalUse {
  name: string;
  kgPerDay: number;
  priceRMkg: number;
}

/** Result of a process model (before costing). */
export interface ProcessResult {
  out: Stream;
  /** removed solids/oil as a stream-like split at inlet flow (concentrations relative to inlet Q), or null */
  removed: Stream | null;
  produced: Partial<Components>;
  consumed: Partial<Components>;
  gas: Partial<Components>;
  calcs: Record<string, Calc>;
  notes: Note[];
  chemicals: ChemicalUse[];
  energy_kWhd: number;
  /** solids mass fraction of the sludge leaving the sludge port (thickener / press); default by unit kind otherwise */
  sludgeSolidsFrac?: number;
  /** the whole feed leaves through the sludge port (holding tank, no decant); main outlet = emergency overflow only */
  sludgeAll?: boolean;
  /**
   * a liquid side stream at its own flow and concentrations (RO brine, UF backwash, evaporator concentrate, IX regenerant)
   * leaving through the second (sludge/brine) port. out.Q + reject.Q = inlet Q (+ any regenerant water, listed in produced.Q).
   */
  reject?: Stream;
  /** revenue earned by the unit, RM/d (metal sold, biogas power) — offsets running cost */
  credits?: { name: string; RMd: number }[];
}

export function result(out: Stream, extra: Partial<ProcessResult> = {}): ProcessResult {
  return {
    out,
    removed: null,
    produced: {},
    consumed: {},
    gas: {},
    calcs: {},
    notes: [],
    chemicals: [],
    energy_kWhd: 0,
    ...extra,
  };
}
