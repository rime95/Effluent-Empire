/**
 * Per-device display preferences (not part of a save). "Fictional names" swaps every real company name shown in the
 * UI for its fixed fictional alias (src/game/realClients.ts); saves keep the real name, so the toggle is reversible.
 */
import { create } from 'zustand';
import { brandText } from '../game/realClients';

const KEY = 'effluent-empire.prefs';

interface Prefs {
  fictionalNames: boolean;
  setFictionalNames: (v: boolean) => void;
}

function load(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const usePrefs = create<Prefs>((set) => ({
  fictionalNames: Boolean(load().fictionalNames),
  setFictionalNames: (v) => {
    set({ fictionalNames: v });
    try {
      localStorage.setItem(KEY, JSON.stringify({ fictionalNames: v }));
    } catch {
      /* storage blocked: the setting lasts for this session */
    }
  },
}));

/** Company names (and texts containing them) as the player has chosen to see them. */
export function brand(text: string): string {
  return brandText(text, usePrefs.getState().fictionalNames);
}
