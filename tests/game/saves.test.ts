/** Save slots, legacy-save import, save files. */
import { describe, it, expect, beforeAll } from 'vitest';

class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const mem = new MemStorage();
let store: typeof import('../../src/game/store');
let saves: typeof import('../../src/game/saves');

beforeAll(async () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = mem as unknown as Storage;
  // a pre-slot autosave from an older version of the game
  mem.setItem('effluent-empire-save-v1', JSON.stringify({ version: 2, companyName: 'Legacy Sdn Bhd', cash: 1_670_000, week: 23, reputation: 30 }));
  saves = await import('../../src/game/saves');
  store = await import('../../src/game/store'); // importing the store runs the one-time legacy import
});

describe('save slots', () => {
  it('imports the old single autosave as a slot and keeps the original as a backup', () => {
    const list = saves.listSlots();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ company: 'Legacy Sdn Bhd', week: 23, cash: 1_670_000 });
    expect(mem.getItem('effluent-empire-save-v1')).not.toBeNull();
  });
  it('legacy import runs only once', async () => {
    saves.importLegacy(store.migrateJson);
    expect(saves.listSlots()).toHaveLength(1);
  });
  it('new game creates its own slot; opening the legacy slot restores that company', () => {
    store.startNewGame('Test Water Sdn Bhd');
    expect(saves.listSlots()).toHaveLength(2);
    expect(store.useGame.getState().companyName).toBe('Test Water Sdn Bhd');
    const legacy = saves.listSlots().find((s) => s.company === 'Legacy Sdn Bhd')!;
    expect(store.openSlot(legacy.id)).toBe(true);
    expect(store.useGame.getState().week).toBe(23);
    expect(store.getCurrentSlot()).toBe(legacy.id);
  });
  it('saveNow updates the slot summary; save-as branches into a new slot', () => {
    store.useGame.setState({ cash: 123_456 });
    expect(store.saveNow().ok).toBe(true);
    const id = store.getCurrentSlot()!;
    expect(saves.listSlots().find((s) => s.id === id)!.cash).toBe(123_456);
    expect(store.saveAsNewSlot().ok).toBe(true);
    expect(store.getCurrentSlot()).not.toBe(id);
    expect(saves.listSlots()).toHaveLength(3);
  });
  it('a downloaded save file round-trips through import into a new slot', () => {
    const file = store.exportSave();
    const before = saves.listSlots().length;
    expect(store.importSaveFile(file)).toBe(true);
    expect(saves.listSlots()).toHaveLength(before + 1);
    expect(store.useGame.getState().cash).toBe(123_456);
    expect(file).not.toContain('"toast"');
  });
  it('rejects invalid files and deletes slots', () => {
    expect(store.importSaveFile('{"hello":1}')).toBe(false);
    expect(store.importSaveFile('not json')).toBe(false);
    const id = saves.listSlots()[0].id;
    saves.deleteSlot(id);
    expect(saves.listSlots().some((s) => s.id === id)).toBe(false);
    expect(saves.readSlot(id)).toBeNull();
  });
  it('closeGame stops autosaving to any slot', () => {
    store.closeGame();
    expect(store.getCurrentSlot()).toBeNull();
    expect(store.saveNow().ok).toBe(false);
  });
});
