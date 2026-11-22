/**
 * Save slots in browser storage + save files.
 *
 * Layout in localStorage:
 *   effluent-empire-slots        → SlotMeta[] (index, newest first when listed)
 *   effluent-empire-slot:<id>    → full save JSON (same format as an exported file; migrate() reads both)
 * The pre-slot single autosave (SAVE_KEY) is imported once as a slot and then left untouched as a backup.
 */
import type { GameState } from './store';

export const LEGACY_KEY = 'effluent-empire-save-v1';
const INDEX_KEY = 'effluent-empire-slots';
const DATA_PREFIX = 'effluent-empire-slot:';
export const MAX_SLOTS = 8;

export interface SlotMeta {
  id: string;
  company: string;
  week: number;
  cash: number;
  reputation: number;
  plants: number;
  savedAt: number;
  /** developer mode was used on this save */
  dev?: boolean;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readIndex(): SlotMeta[] {
  const ls = storage();
  if (!ls) return [];
  try {
    const v = JSON.parse(ls.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeIndex(list: SlotMeta[]) {
  storage()?.setItem(INDEX_KEY, JSON.stringify(list));
}

/** Slots, most recently saved first. */
export function listSlots(): SlotMeta[] {
  return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

export function readSlot(id: string): string | null {
  return storage()?.getItem(DATA_PREFIX + id) ?? null;
}

export function summarize(id: string, s: Pick<GameState, 'companyName' | 'week' | 'cash' | 'reputation' | 'plants' | 'devUsed'>): SlotMeta {
  return { id, company: s.companyName, week: s.week, cash: s.cash, reputation: s.reputation, plants: s.plants.filter((p) => p.status === 'operating').length, savedAt: Date.now(), ...(s.devUsed ? { dev: true } : {}) };
}

/** Write a slot. Throws if browser storage is full or unavailable (caller shows the message). */
export function writeSlot(meta: SlotMeta, json: string) {
  const ls = storage();
  if (!ls) throw new Error('Browser storage is unavailable.');
  ls.setItem(DATA_PREFIX + meta.id, json);
  writeIndex([...readIndex().filter((m) => m.id !== meta.id), meta]);
}

export function deleteSlot(id: string) {
  const ls = storage();
  if (!ls) return;
  ls.removeItem(DATA_PREFIX + id);
  writeIndex(readIndex().filter((m) => m.id !== id));
}

export function newSlotId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** One-time import of the pre-slot autosave into the slot list (the legacy key is kept as a backup). */
export function importLegacy(parse: (json: string) => GameState | null): void {
  const ls = storage();
  if (!ls || ls.getItem(INDEX_KEY) !== null) return;
  const raw = ls.getItem(LEGACY_KEY);
  writeIndex([]);
  if (!raw) return;
  const s = parse(raw);
  if (!s) return;
  const id = newSlotId();
  try {
    writeSlot({ ...summarize(id, s), savedAt: Date.now() - 1 }, raw);
  } catch {
    /* storage full: leave the legacy save where it is */
  }
}

/** Offer a save as a downloadable .json file. */
export function downloadSave(json: string, company: string, week: number) {
  const safe = company.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'company';
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `EffluentEmpire_${safe}_week${week}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
