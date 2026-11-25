/**
 * Per-device workspace layout (not part of a save): sidebar collapse, focus mode, Engineering Studio panel sizes and
 * collapsed states, SCADA maximise. Stored in localStorage; every read/write is guarded so blocked storage only means
 * the layout lasts for this session.
 */
import { create } from 'zustand';

const KEY = 'effluent-empire.layout';

export type PaletteMode = 'full' | 'rail' | 'hidden';
export type InspectorMode = 'docked' | 'floating';
export type StudioPreset = 'design' | 'drawing' | 'review';

export interface StudioLayout {
  palette: PaletteMode;
  paletteW: number;
  inspector: InspectorMode;
  inspectorW: number;
  /** floating inspector card: position from the canvas top-right corner, minimised flag */
  float: { right: number; top: number; min: boolean };
  drawerOpen: boolean;
  drawerH: number;
  titleBlock: boolean;
  preset: StudioPreset | 'custom';
}

export const STUDIO_DEFAULT: StudioLayout = {
  palette: 'full',
  paletteW: 200,
  inspector: 'docked',
  inspectorW: 330,
  float: { right: 12, top: 92, min: false },
  drawerOpen: true,
  drawerH: 260,
  titleBlock: true,
  preset: 'design',
};

/** limits for drag-resizing, px */
export const LIMITS = { paletteW: [150, 360], inspectorW: [260, 560], drawerH: [120, 640] } as const;

export const PRESETS: Record<StudioPreset, { label: string; hint: string; apply: Partial<StudioLayout> }> = {
  design: { label: 'Design', hint: 'Palette, canvas, inspector and results', apply: { palette: 'full', inspector: 'docked', drawerOpen: true, drawerH: 260, titleBlock: true } },
  drawing: { label: 'Drawing', hint: 'Maximum canvas: icon palette, floating inspector, results as a strip', apply: { palette: 'rail', inspector: 'floating', drawerOpen: false, titleBlock: false } },
  review: { label: 'Review', hint: 'Canvas and a tall results drawer for the compliance and stream tables', apply: { palette: 'hidden', inspector: 'docked', drawerOpen: true, drawerH: 440 } },
};

interface LayoutState {
  navCollapsed: boolean;
  focus: boolean;
  scadaMax: boolean;
  studio: StudioLayout;
  setNavCollapsed: (v: boolean) => void;
  setFocus: (v: boolean) => void;
  setScadaMax: (v: boolean) => void;
  /** change studio layout fields; marks the preset 'custom' unless a preset is being applied */
  setStudio: (patch: Partial<StudioLayout>) => void;
  applyPreset: (p: StudioPreset) => void;
}

type Saved = Pick<LayoutState, 'navCollapsed' | 'scadaMax' | 'studio'>;

const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

function load(): Partial<Saved> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function persist(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ navCollapsed: s.navCollapsed, scadaMax: s.scadaMax, studio: s.studio }));
  } catch {
    /* storage blocked: the layout lasts for this session */
  }
}

function sanitize(st: Partial<StudioLayout> | undefined): StudioLayout {
  const s = { ...STUDIO_DEFAULT, ...(st ?? {}), float: { ...STUDIO_DEFAULT.float, ...(st?.float ?? {}) } };
  return {
    ...s,
    palette: (['full', 'rail', 'hidden'] as const).includes(s.palette) ? s.palette : 'full',
    inspector: s.inspector === 'floating' ? 'floating' : 'docked',
    paletteW: clamp(s.paletteW, LIMITS.paletteW),
    inspectorW: clamp(s.inspectorW, LIMITS.inspectorW),
    drawerH: clamp(s.drawerH, LIMITS.drawerH),
    // the floating inspector stays below the sheet tabs and layout bar (top-right corner)
    float: { ...s.float, top: Math.max(90, Number(s.float.top) || 90), right: Math.max(0, Number(s.float.right) || 0) },
  };
}

const saved = load();

export const useLayout = create<LayoutState>((set, get) => {
  const commit = (patch: Partial<LayoutState>) => {
    set(patch);
    const s = get();
    persist({ navCollapsed: s.navCollapsed, scadaMax: s.scadaMax, studio: s.studio });
  };
  return {
    navCollapsed: Boolean(saved.navCollapsed),
    focus: false,
    scadaMax: Boolean(saved.scadaMax),
    studio: sanitize(saved.studio),
    setNavCollapsed: (v) => commit({ navCollapsed: v }),
    setFocus: (v) => set({ focus: v }),
    setScadaMax: (v) => commit({ scadaMax: v }),
    setStudio: (patch) => commit({ studio: sanitize({ ...get().studio, ...patch, preset: patch.preset ?? 'custom' }) }),
    applyPreset: (p) => commit({ studio: sanitize({ ...get().studio, ...PRESETS[p].apply, preset: p }) }),
  };
});
