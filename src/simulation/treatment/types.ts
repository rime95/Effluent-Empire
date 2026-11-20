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
