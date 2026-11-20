/**
 * Game state (Zustand) with localStorage autosave. Save format v2 (Phase 2): event-driven time, concurrent projects,
 * staff, operated plants and market prices. v1 saves are migrated.
 */
import { create } from 'zustand';
import { ProcessGraph } from '../simulation/treatment/graph';
import { Enquiry, PAYMENT, generateEnquiry } from './customers';
import { LAB_TESTS, LabTestId, applyTest } from './lab';
import { Market, initialMarket, stepMarket } from './market';
import { ACTIONS, INCIDENT_LABEL, clampSetpoint } from './incidents';
import { importLegacy, newSlotId, readSlot, summarize, writeSlot } from './saves';
import { OM, Plant, omFeeOffer, operateWeek, recommendedMaintenance } from './operations';
import { Project, ABANDON_PENALTY, commission, constructionWeeks, newProject } from './project';
import { createRng } from './rng';
import { Employee, founder, generateCandidates, labDiscount, labWeeks, operatorCapacity, payroll, projectSlots, salesBoost } from './staff';

export { LEGACY_KEY as SAVE_KEY } from './saves';
export const START_CASH = 500_000;
/** office rent, utilities, insurance — RM per week (staff salaries are separate) */
export const WEEKLY_OVERHEAD = 3_500;
/** weeks of negative cash allowed (bank overdraft) before insolvency */
export const OVERDRAFT_WEEKS = 6;

export type LedgerCat = 'capital' | 'project' | 'om' | 'opex' | 'maintenance' | 'payroll' | 'overhead' | 'lab' | 'capex' | 'penalty' | 'hiring';

export interface HistoryEntry {
  week: number;
  company: string;
  industry: string;
  outcome: 'completed' | 'abandoned';
  revenue: number;
  cost: number;
  reputationDelta: number;
}

export interface LedgerEntry {
  week: number;
  label: string;
  amount: number;
  cat?: LedgerCat;
}

export interface GameState {
  version: 2;
  companyName: string;
  cash: number;
  reputation: number;
  week: number;
  seedCounter: number;
  enquiries: Enquiry[];
  projects: Project[];
  activeProjectId: string | null;
  staff: Employee[];
  candidates: Employee[];
  plants: Plant[];
  market: Market;
  news: { week: number; text: string }[];
  history: HistoryEntry[];
  ledger: LedgerEntry[];
  negativeWeeks: number;
  gameOver: boolean;
  toast: string | null;
}

interface Actions {
  newGame: (name?: string) => void;
  advanceWeek: (n?: number) => void;
  skipToEvent: () => void;
  accept: (id: string) => void;
  decline: (id: string) => void;
  setActiveProject: (id: string) => void;
  runTest: (t: LabTestId) => void;
  setGraph: (g: ProcessGraph) => void;
  startConstruction: () => boolean;
  abandon: () => void;
  closeProject: (id?: string) => void;
  acceptOM: (projectId: string) => void;
  declineOM: (projectId: string) => void;
  setMaintenance: (plantId: string, rmPerWeek: number) => void;
  /** SCADA: take an incident action (costs RM; clears the incident only if it addresses the cause) */
  resolveIncident: (plantId: string, actionId: string) => { ok: boolean; text: string };
  /** SCADA: change an operating set-point on an operated plant (persists into its as-built graph) */
  setSetpoint: (plantId: string, nodeId: string, key: string, value: number) => void;
  hire: (candidateId: string) => void;
  fire: (employeeId: string) => void;
  load: (json: string) => boolean;
  dismissToast: () => void;
}

const LIVE: Project['status'][] = ['design', 'building', 'failed'];
export const isLive = (p: Project) => LIVE.includes(p.status);

function initial(name = 'Effluent Engineering Sdn Bhd'): GameState {
  const seed = 1000 + Math.floor(Math.random() * 1e6);
  const base: GameState = {
    version: 2,
    companyName: name,
    cash: START_CASH,
    reputation: 0,
    week: 1,
    seedCounter: seed,
    enquiries: [],
    projects: [],
    activeProjectId: null,
    staff: [founder()],
    candidates: generateCandidates(seed, 1, 0),
    plants: [],
    market: initialMarket(),
    news: [],
    history: [],
    ledger: [{ week: 1, label: 'Starting capital', amount: START_CASH, cat: 'capital' }],
    negativeWeeks: 0,
    gameOver: false,
    toast: null,
  };
  return refill(base);
}

/** Keep open enquiries (3–4, plus sales staff); drop expired ones. */
function refill(s: GameState): GameState {
  const open = s.enquiries.filter((e) => e.expiresWeek >= s.week);
  let seed = s.seedCounter;
  const rng = createRng(seed + s.week);
  const boost = salesBoost(s.staff);
  const target = 3 + (rng.chance(0.5) ? 1 : 0) + boost;
  while (open.length < target) {
    seed += 1;
    // sales staff win larger jobs: they act like extra reputation for project size and value
    open.push(generateEnquiry(seed, s.week, s.reputation + 15 * boost));
  }
  return { ...s, enquiries: open, seedCounter: seed };
}

/** Migrate a v1 save (single project, no staff) to v2. */
export function migrate(raw: unknown): GameState | null {
  const s = raw as Record<string, unknown>;
  if (!s || typeof s !== 'object') return null;
  if (s.version === 2) {
    const v = s as unknown as Partial<GameState>;
    if (typeof v.cash !== 'number' || typeof v.week !== 'number') return null;
    const d = initial(v.companyName);
    return {
      ...d,
      ...v,
      projects: Array.isArray(v.projects) ? v.projects : [],
      plants: Array.isArray(v.plants) ? v.plants : [],
      staff: Array.isArray(v.staff) && v.staff.length ? v.staff : d.staff,
      candidates: Array.isArray(v.candidates) ? v.candidates : d.candidates,
      enquiries: Array.isArray(v.enquiries) ? v.enquiries : d.enquiries,
      market: v.market && Array.isArray(v.market.history) ? v.market : d.market,
      news: Array.isArray(v.news) ? v.news : [],
      history: Array.isArray(v.history) ? v.history : [],
      ledger: Array.isArray(v.ledger) ? v.ledger : [],
      seedCounter: typeof v.seedCounter === 'number' ? v.seedCounter : d.seedCounter,
      negativeWeeks: v.negativeWeeks ?? 0,
      version: 2,
      toast: null,
    } as GameState;
  }
  if (s.version !== 1) return null;
  const old = s as unknown as GameState & { project: Project | null };
  const fixProject = (p: Project): Project => ({ ...p, id: p.id ?? p.enquiry.id, labQueue: p.labQueue ?? [], building: p.building ?? null, omOffer: p.omOffer ?? null });
  return {
    version: 2,
    companyName: old.companyName,
    cash: old.cash,
    reputation: old.reputation,
    week: old.week,
    seedCounter: old.seedCounter,
    enquiries: old.enquiries,
    projects: old.project ? [fixProject(old.project)] : [],
    activeProjectId: old.project ? old.project.enquiry.id : null,
    staff: [founder()],
    candidates: generateCandidates(old.seedCounter, old.week, old.reputation),
    plants: [],
    market: initialMarket(),
    news: [],
    history: old.history ?? [],
    ledger: (old.ledger ?? []).slice(-400),
    negativeWeeks: 0,
    gameOver: old.gameOver ?? false,
    toast: null,
  };
}


const book = (s: GameState, label: string, amount: number, cat: LedgerCat): GameState => ({
  ...s,
  cash: s.cash + amount,
  ledger: [...s.ledger, { week: s.week, label, amount, cat }].slice(-600),
});

const updateProject = (s: GameState, id: string, f: (p: Project) => Project): GameState => ({ ...s, projects: s.projects.map((p) => (p.id === id ? f(p) : p)) });

/** Advance the company by exactly one week. Pure. */
export function stepWeek(state: GameState): GameState {
  let s: GameState = { ...state, week: state.week + 1 };
  const week = s.week;
  const notices: string[] = [];

  // 1. project milestones that fall due this week
  for (const p of s.projects) {
    // lab results
    const due = p.labQueue.filter((q) => q.doneWeek <= week);
    if (due.length) {
      let datasheet = p.datasheet;
      due.forEach((q, i) => (datasheet = applyTest(datasheet, q.test, p.enquiry.trueStream, createRng(p.enquiry.seed * 7 + p.testsDone.length + i * 101 + q.doneWeek))));
      s = updateProject(s, p.id, (x) => ({ ...x, datasheet, testsDone: [...x.testsDone, ...due.map((q) => q.test)], labQueue: x.labQueue.filter((q) => q.doneWeek > week) }));
      notices.push(`${p.enquiry.company}: lab results ready (${due.map((q) => LAB_TESTS[q.test].name).join(', ')}).`);
    }
    // construction complete → commissioning
    if (p.building && p.building.doneWeek <= week) {
      const rep = p.building.report;
      if (rep.milestone > 0) s = book(s, `Mechanical completion (60 %): ${p.enquiry.company}`, rep.milestone, 'project');
      if (rep.pass) s = book(s, `Retention released (10 %, net of LDs): ${p.enquiry.company}`, rep.payment, 'project');
      s = { ...s, reputation: s.reputation + rep.reputationDelta };
      const paid = p.paid + rep.milestone + (rep.pass ? rep.payment : 0);
      const omOffer = rep.pass ? { weeklyFee: omFeeOffer(rep.opexRMd, p.enquiry.trueStream.Q), weeks: OM.contractWeeks } : null;
      s = updateProject(s, p.id, (x) => ({ ...x, building: null, built: p.building!.graph ?? x.graph, paid, attempts: x.attempts + 1, status: rep.pass ? 'completed' : 'failed', reports: [...x.reports, rep], omOffer }));
      if (rep.pass) {
        const x = s.projects.find((q) => q.id === p.id)!;
        s.history = [...s.history, { week, company: p.enquiry.company, industry: p.enquiry.industry, outcome: 'completed', revenue: paid, cost: x.spent.capex + x.spent.lab, reputationDelta: x.reports.reduce((a, r) => a + r.reputationDelta, 0) }];
      }
      notices.push(`${p.enquiry.company}: commissioning ${rep.pass ? 'PASSED' : 'FAILED'}.`);
    }
  }

  // 2. operated plants
  let capacity = operatorCapacity(s.staff);
  const plants: Plant[] = [];
  for (const pl of s.plants) {
    if (pl.status !== 'operating') {
      plants.push(pl);
      continue;
    }
    const covered = capacity > 0;
    if (covered) capacity -= 1;
    const out = operateWeek(pl, week, s.market, covered);
    plants.push(out.plant);
    s = book(s, `O&M ${pl.company}: fee − costs`, out.cash, 'om');
    s.reputation += out.reputation;
    notices.push(...out.messages);
  }
  s.plants = plants;

  // 3. payroll and overheads
  s = book(s, `Payroll (${s.staff.length} staff)`, -payroll(s.staff), 'payroll');
  s = book(s, 'Office overheads', -WEEKLY_OVERHEAD, 'overhead');

  // 4. market, hiring pool, enquiries
  const m = stepMarket(s.market, week, createRng(s.seedCounter * 3 + week));
  s.market = m.market;
  if (m.news) notices.push(m.news);
  if (week % 4 === 0) s.candidates = generateCandidates(s.seedCounter, week, s.reputation);
  s = refill(s);

  // 5. solvency
  s.negativeWeeks = s.cash < 0 ? s.negativeWeeks + 1 : 0;
  if (s.negativeWeeks >= OVERDRAFT_WEEKS) s.gameOver = true;
  if (notices.length) s.news = [...s.news, ...notices.map((text) => ({ week, text }))].slice(-60);
  return s;
}

/** Is anything scheduled (lab result, construction) or worth waking for? */
function hasPendingEvent(s: GameState): boolean {
  return s.projects.some((p) => p.labQueue.length > 0 || p.building !== null);
}

export const useGame = create<GameState & Actions>((set, get) => {
  const active = (s: GameState) => s.projects.find((p) => p.id === s.activeProjectId) ?? null;

  return {
    // nothing is loaded until the player picks New / Continue / Load on the main menu
    ...initial(),
    newGame: (name) => set(() => initial(name)),
    advanceWeek: (n = 1) =>
      set((s) => {
        let x: GameState = s;
        for (let i = 0; i < n && !x.gameOver; i++) x = stepWeek(x);
        return x;
      }),
    skipToEvent: () =>
      set((s) => {
        let x: GameState = s;
        for (let i = 0; i < 12 && !x.gameOver; i++) {
          x = stepWeek(x);
          const week = x.week;
          if (!hasPendingEvent(x) || x.news.some((n) => n.week === week)) break;
        }
        return x;
      }),
    accept: (id) =>
      set((s) => {
        if (s.gameOver) return {};
        const live = s.projects.filter(isLive).length;
        if (live >= projectSlots(s.staff)) return { toast: `All ${projectSlots(s.staff)} engineer(s) are busy — hire another engineer or finish a project first.` };
        const e = s.enquiries.find((x) => x.id === id);
        if (!e) return {};
        const advance = Math.round(e.contractValue * PAYMENT.advance);
        const next = book({ ...s, projects: [...s.projects, newProject(e, s.week)], activeProjectId: e.id, enquiries: s.enquiries.filter((x) => x.id !== id) }, `Advance payment (30 %): ${e.company}`, advance, 'project');
        return { ...next, projects: next.projects.map((p) => (p.id === e.id ? { ...p, paid: advance } : p)), toast: `Contract signed with ${e.company} — 30 % advance received.` };
      }),
    decline: (id) => set((s) => ({ enquiries: s.enquiries.filter((x) => x.id !== id) })),
    setActiveProject: (id) => set({ activeProjectId: id }),
    runTest: (t) =>
      set((s) => {
        const p = active(s);
        if (s.gameOver || !p || !isLive(p) || p.status === 'building' || p.testsDone.includes(t) || p.labQueue.some((q) => q.test === t)) return {};
        const spec = LAB_TESTS[t];
        const cost = Math.round(spec.cost * (1 - labDiscount(s.staff)));
        if (s.cash < cost) return { toast: 'Not enough cash for this test.' };
        const doneWeek = s.week + labWeeks(s.staff, spec.weeks);
        const next = book(s, `Lab: ${spec.name} (${p.enquiry.company})`, -cost, 'lab');
        return { ...updateProject(next, p.id, (x) => ({ ...x, labQueue: [...x.labQueue, { test: t, doneWeek }], spent: { ...x.spent, lab: x.spent.lab + cost } })), toast: `${spec.name} sent to the lab — results in week ${doneWeek}.` };
      }),
    setGraph: (g) => set((s) => (s.activeProjectId ? updateProject(s, s.activeProjectId, (p) => (p.status === 'design' || p.status === 'failed' ? { ...p, graph: g } : p)) : {})),
    startConstruction: () => {
      const s = get();
      const p = active(s);
      if (s.gameOver || !p || (p.status !== 'design' && p.status !== 'failed')) return false;
      const weeks = constructionWeeks(p);
      const rep = commission(p, s.week + weeks);
      if (rep.errors.length) {
        set({ toast: rep.errors[0].text });
        return false;
      }
      // construction is paid up-front; the 60 % milestone arrives at completion (a short overdraft is allowed)
      if (s.cash + rep.milestone - rep.capexCharged < -100_000) {
        set({ toast: `Construction needs RM ${Math.round(rep.capexCharged).toLocaleString()} — beyond your credit line.` });
        return false;
      }
      let next = book(s, `${p.built ? 'Retrofit' : 'Construction'}: ${p.enquiry.company}`, -rep.capexCharged, 'capex');
      next = updateProject(next, p.id, (x) => ({ ...x, status: 'building', building: { doneWeek: s.week + weeks, report: rep, graph: p.graph }, spent: { ...x.spent, capex: x.spent.capex + rep.capexCharged } }));
      set({ ...next, toast: `Construction started — commissioning in week ${s.week + weeks}.` });
      return true;
    },
    abandon: () =>
      set((s) => {
        const p = active(s);
        if (!p || !isLive(p) || p.status === 'building') return {};
        const penalty = Math.round(p.enquiry.contractValue * ABANDON_PENALTY);
        let next = book(s, `Abandonment: repay ${Math.round(p.paid).toLocaleString()} + 15 % penalty: ${p.enquiry.company}`, -(penalty + p.paid), 'penalty');
        next = updateProject(next, p.id, (x) => ({ ...x, status: 'abandoned' }));
        return {
          ...next,
          reputation: next.reputation - 20,
          history: [...next.history, { week: s.week, company: p.enquiry.company, industry: p.enquiry.industry, outcome: 'abandoned', revenue: 0, cost: p.spent.capex + p.spent.lab + penalty, reputationDelta: -20 }],
          toast: 'Project abandoned (−20 reputation).',
        };
      }),
    closeProject: (id) =>
      set((s) => {
        const pid = id ?? s.activeProjectId;
        const target = s.projects.find((p) => p.id === pid);
        if (!target || isLive(target)) return {};
        const projects = s.projects.filter((p) => p.id !== pid);
        return { projects, activeProjectId: s.activeProjectId === pid ? (projects.find(isLive)?.id ?? null) : s.activeProjectId };
      }),
    acceptOM: (projectId) =>
      set((s) => {
        const p = s.projects.find((x) => x.id === projectId);
        if (!p || !p.omOffer || !p.built) return {};
        const capex = p.spent.capex;
        const plant: Plant = {
          id: `plant-${p.id}`,
          company: p.enquiry.company,
          industry: p.enquiry.industry,
          standard: p.enquiry.standard,
          graph: p.built,
          trueStream: p.enquiry.trueStream,
          seed: p.enquiry.seed,
          capex,
          commissionedWeek: s.week,
          contract: { weeklyFee: p.omOffer.weeklyFee, startWeek: s.week, endWeek: s.week + p.omOffer.weeks },
          condition: 100,
          maintenanceBudget: recommendedMaintenance(capex),
          satisfaction: 75,
          fines: 0,
          breakdown: null,
          history: [],
          status: 'operating',
        };
        const projects = s.projects.filter((x) => x.id !== projectId);
        const activeProjectId = s.activeProjectId === projectId ? (projects.find(isLive)?.id ?? null) : s.activeProjectId;
        return { plants: [...s.plants, plant], projects, activeProjectId, toast: `O&M contract signed: RM ${p.omOffer.weeklyFee.toLocaleString()}/week for 3 years.` };
      }),
    declineOM: (projectId) => set((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? { ...p, omOffer: null } : p)) })),
    resolveIncident: (plantId, actionId) => {
      const s = get();
      if (s.gameOver) return { ok: false, text: 'Company insolvent.' };
      const pl = s.plants.find((p) => p.id === plantId);
      const a = ACTIONS.find((x) => x.id === actionId);
      if (!pl || !a || !pl.incident) return { ok: false, text: 'Nothing to resolve.' };
      const ok = a.fixes.includes(pl.incident.kind);
      const label = INCIDENT_LABEL[pl.incident.kind];
      const text = ok ? `${a.label}: ${a.explain} Incident closed (${label}).` : `${a.label}: no improvement — the cause lies elsewhere.`;
      let next: GameState = a.cost ? book(s, `SCADA action at ${pl.company}: ${a.label}`, -a.cost, 'maintenance') : { ...s };
      next = {
        ...next,
        plants: next.plants.map((p) => (p.id !== plantId || !p.incident ? p : { ...p, incident: ok ? null : { ...p.incident, tried: [...p.incident.tried, a.id] }, satisfaction: ok ? Math.min(100, p.satisfaction + 2) : p.satisfaction })),
        news: [...next.news, { week: s.week, text: `${pl.company} — ${text}` }].slice(-60),
      };
      set(next);
      return { ok, text };
    },
    setSetpoint: (plantId, nodeId, key, value) =>
      set((s) => {
        if (s.gameOver) return {};
        return {
          plants: s.plants.map((p) => {
            if (p.id !== plantId || p.status !== 'operating') return p;
            return {
              ...p,
              graph: {
                ...p.graph,
                nodes: p.graph.nodes.map((n) => {
                  const v = n.id === nodeId ? clampSetpoint(n.kind, key, value) : null;
                  return v === null ? n : { ...n, params: { ...n.params, [key]: v } };
                }),
              },
            };
          }),
        };
      }),
    setMaintenance: (plantId, rm) => set((s) => ({ plants: s.plants.map((p) => (p.id === plantId ? { ...p, maintenanceBudget: Math.max(0, Math.round(rm)) } : p)) })),
    hire: (cid) =>
      set((s) => {
        const c = s.candidates.find((x) => x.id === cid);
        if (s.gameOver || !c) return {};
        const fee = Math.round(c.salaryMonthly * 0.5);
        const next = book(s, `Recruitment fee: ${c.name}`, -fee, 'hiring');
        return { ...next, staff: [...s.staff, { ...c, id: `e-${cid}`, hiredWeek: s.week }], candidates: s.candidates.filter((x) => x.id !== cid), toast: `${c.name} joined as ${c.role}.` };
      }),
    fire: (eid) =>
      set((s) => {
        const e = s.staff.find((x) => x.id === eid);
        if (!e || e.founder) return {};
        const staff = s.staff.filter((x) => x.id !== eid);
        if (e.role === 'engineer' && s.projects.filter(isLive).length > projectSlots(staff)) return { toast: 'That engineer is running a project — finish it first.' };
        const severance = Math.round(e.salaryMonthly);
        return { ...book({ ...s, staff }, `Severance: ${e.name}`, -severance, 'payroll'), toast: `${e.name} has left (one month severance).` };
      }),
    load: (json) => {
      try {
        const s = migrate(JSON.parse(json));
        if (!s) return false;
        set({ ...s, toast: 'Save loaded.' });
        return true;
      } catch {
        return false;
      }
    },
    dismissToast: () => set({ toast: null }),
  };
});

export function useActiveProject(): Project | null {
  return useGame((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
}

// ---- save slots (see saves.ts) ----
let currentSlot: string | null = null;
export const getCurrentSlot = () => currentSlot;

/** Write the running game to its slot now. */
export function saveNow(): { ok: boolean; error?: string } {
  if (!currentSlot) return { ok: false, error: 'No save slot is active.' };
  try {
    writeSlot(summarize(currentSlot, useGame.getState()), exportSave());
    return { ok: true };
  } catch {
    return { ok: false, error: 'Browser storage is full — export this save to a file or delete an old slot.' };
  }
}

/** Start a new company in a new slot. */
export function startNewGame(name: string) {
  currentSlot = newSlotId();
  useGame.setState({ ...initial(name.trim() || 'Effluent Engineering Sdn Bhd'), toast: null });
  saveNow();
}

/** Open a stored slot; false if its data is missing or invalid. */
export function openSlot(id: string): boolean {
  const raw = readSlot(id);
  const s = raw ? migrateJson(raw) : null;
  if (!s) return false;
  currentSlot = id;
  useGame.setState({ ...s, toast: null });
  return true;
}

/** Import a save file into a NEW slot and open it. */
export function importSaveFile(json: string): boolean {
  const s = migrateJson(json);
  if (!s) return false;
  currentSlot = newSlotId();
  useGame.setState({ ...s, toast: 'Save file imported into a new slot.' });
  saveNow();
  return true;
}

/** Copy the running game into a new slot and continue there ("Save as"). */
export function saveAsNewSlot(): { ok: boolean; error?: string } {
  currentSlot = newSlotId();
  return saveNow();
}

/** Leave the game (autosave first); the UI returns to the main menu. */
export function closeGame() {
  saveNow();
  currentSlot = null;
}

export function migrateJson(json: string): GameState | null {
  try {
    return migrate(JSON.parse(json));
  } catch {
    return null;
  }
}

importLegacy(migrateJson);

// autosave to the active slot (debounced: canvas drags fire many updates)
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let warnedFull = false;
useGame.subscribe(() => {
  if (!currentSlot) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const r = saveNow();
    if (!r.ok && r.error && !warnedFull) {
      warnedFull = true;
      useGame.setState({ toast: r.error });
    }
    if (r.ok) warnedFull = false;
  }, 400);
});

export function exportSave(): string {
  const s = useGame.getState();
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v !== 'function' && k !== 'toast') data[k] = v;
  return JSON.stringify(data);
}
