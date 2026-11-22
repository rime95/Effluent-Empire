/**
 * Game state (Zustand) with localStorage autosave. Save format v2 (Phase 2): event-driven time, concurrent projects,
 * staff, operated plants and market prices. v1 saves are migrated.
 */
import { create } from 'zustand';
import { ProcessGraph } from '../simulation/treatment/graph';
import { Enquiry, PAYMENT, generateEnquiry } from './customers';
import { LAB_TESTS, LabTestId, applyTest } from './lab';
import { Market, initialMarket, stepMarket } from './market';
import { INCIDENT_LABEL, availableActions, clampSetpoint } from './incidents';
import { importLegacy, newSlotId, readSlot, summarize, writeSlot } from './saves';
import { OM, Plant, contractFor, omFeeQuote, operateWeek, plantPosts, recommendedMaintenance } from './operations';
import { simulate } from '../simulation/treatment/graph';
import { completeUpgrade, upgradeQuote } from './upgrade';
import { Project, ABANDON_PENALTY, commission, constructionWeeks, newProject } from './project';
import { createRng } from './rng';
import { Employee, founder, generateCandidates, labDiscount, labWeeks, operatorCapacity, payroll, projectSlots, salesBoost } from './staff';

export { LEGACY_KEY as SAVE_KEY } from './saves';
export const START_CASH = 500_000;
/** office rent, utilities, insurance — RM per week (staff salaries are separate) */
export const WEEKLY_OVERHEAD = 3_500;
/** bank overdraft facility (GAME MODEL) */
export const CREDIT_LINE = 250_000;
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
  /** chemistry convention of saved streams: 2 = ammonia speciated as a weak base (Cb excludes NH4+) */
  chem?: number;
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
  /** Engineering Studio shows this operating plant (PFD / P&ID, upgrades) instead of the active project */
  studioPlantId?: string | null;
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
  /** open an operating plant's PFD in the Studio (null = back to the active project) */
  openPlantStudio: (plantId: string | null) => void;
  /** start / edit / discard / submit an upgrade (variation order) of an operating plant */
  startUpgrade: (plantId: string) => void;
  setUpgradeGraph: (plantId: string, g: ProcessGraph) => void;
  discardUpgrade: (plantId: string) => void;
  submitUpgrade: (plantId: string) => { ok: boolean; text: string };
}

const LIVE: Project['status'][] = ['design', 'building', 'failed'];
export const isLive = (p: Project) => LIVE.includes(p.status);

/** Engineers tied up: one per live project and one per plant upgrade (drafted or under construction). */
export function engineersBusy(s: Pick<GameState, 'projects' | 'plants'>): number {
  return s.projects.filter(isLive).length + s.plants.filter((p) => p.status === 'operating' && p.upgrade).length;
}

/** Engineers with no project or upgrade: they supervise operating plants (CePIETSO, on-site diagnosis). */
export function freeEngineers(s: Pick<GameState, 'projects' | 'plants' | 'staff'>): number {
  return Math.max(0, projectSlots(s.staff) - engineersBusy(s));
}

/** Operating plants supervised by a free engineer, in portfolio order (OM.plantsPerEngineer each). */
export function supervisedPlantIds(s: Pick<GameState, 'projects' | 'plants' | 'staff'>): Set<string> {
  const n = freeEngineers(s) * OM.plantsPerEngineer;
  return new Set(s.plants.filter((p) => p.status === 'operating').slice(0, n).map((p) => p.id));
}

function initial(name = 'Effluent Engineering Sdn Bhd'): GameState {
  const seed = 1000 + Math.floor(Math.random() * 1e6);
  const base: GameState = {
    version: 2,
    chem: 2,
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
    studioPlantId: null,
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
/**
 * Saves before chem 2 stored Cb with NH4+ counted as a strong cation. Ammonia is now a weak base speciated in the
 * charge balance, so every saved stream gets Cb −= NH4N/14 007 (same pH below ≈ 8.5, as before).
 */
function migrateAmmoniaCb(node: unknown, seen = new Set<unknown>()): void {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) migrateAmmoniaCb(x, seen);
    return;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.Cb === 'number' && typeof o.NH4N === 'number' && typeof o.CT === 'number') o.Cb = o.Cb - o.NH4N / 14007;
  for (const k of Object.keys(o)) migrateAmmoniaCb(o[k], seen);
}

/**
 * Contracts signed before 2026-11-22 were a fixed weekly lump sum out of which the player paid every running cost
 * (player feedback: far too low). They are re-priced to the fixed-fee + reimbursables model for the remaining term.
 */
export function repriceLegacyContract(p: Plant, reputation: number): Plant {
  if (!p.contract || p.contract.quote) return p;
  const sim = simulate(p.graph, p.trueStream);
  const quote = omFeeQuote({ capex: p.capex, Q: p.trueStream.Q, std: p.standard, reputation, opexRMd: sim.opexRMd, graph: p.graph });
  return { ...p, contract: { monthlyFee: quote.monthlyFee, quote, startWeek: p.contract.startWeek, endWeek: p.contract.endWeek, indexation: 1 } };
}

export function migrate(raw: unknown): GameState | null {
  const s = raw as Record<string, unknown>;
  if (!s || typeof s !== 'object') return null;
  if (Number(s.chem ?? 1) < 2) {
    migrateAmmoniaCb(s);
    s.chem = 2;
  }
  if (s.version === 2) {
    const v = s as unknown as Partial<GameState>;
    if (typeof v.cash !== 'number' || typeof v.week !== 'number') return null;
    const d = initial(v.companyName);
    return {
      ...d,
      ...v,
      projects: Array.isArray(v.projects) ? v.projects : [],
      plants: Array.isArray(v.plants) ? v.plants.map((p) => repriceLegacyContract(p, v.reputation ?? 0)) : [],
      staff: Array.isArray(v.staff) && v.staff.length ? v.staff : d.staff,
      candidates: Array.isArray(v.candidates) ? v.candidates : d.candidates,
      enquiries: Array.isArray(v.enquiries) ? v.enquiries : d.enquiries,
      market: v.market && Array.isArray(v.market.history) ? v.market : d.market,
      news: [
        ...(Array.isArray(v.news) ? v.news : []),
        ...(Array.isArray(v.plants) && v.plants.some((p) => p.contract && !p.contract.quote)
          ? [{ week: v.week, text: 'O&M contracts re-priced: a fixed monthly service fee plus chemicals, power and sludge re-billed at cost + 10 % (see Plants & O&M).' }]
          : []),
      ].slice(-60),
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
    chem: 2,
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
    // construction progress: weekly contractor payment and the client's progress claim
    const prog = p.building?.progress;
    if (prog && prog.weeksLeft > 0) {
      s = book(s, `Construction progress: ${p.enquiry.company}`, -prog.capexPerWeek, 'capex');
      if (prog.claimPerWeek > 0) s = book(s, `Progress claim (60 % over the build): ${p.enquiry.company}`, prog.claimPerWeek, 'project');
      s = updateProject(s, p.id, (x) => (x.building?.progress ? { ...x, building: { ...x.building, progress: { ...x.building.progress, weeksLeft: x.building.progress.weeksLeft - 1 } } } : x));
    }
    // construction complete → commissioning
    if (p.building && p.building.doneWeek <= week) {
      const rep = p.building.report;
      // legacy builds (paid up front) receive the 60 % here; new builds were paid progressively
      if (rep.milestone > 0 && !p.building.progress) s = book(s, `Mechanical completion (60 %): ${p.enquiry.company}`, rep.milestone, 'project');
      if (rep.pass) s = book(s, `Retention released (10 %, net of LDs): ${p.enquiry.company}`, rep.payment, 'project');
      s = { ...s, reputation: s.reputation + rep.reputationDelta };
      const paid = p.paid + rep.milestone + (rep.pass ? rep.payment : 0);
      const builtGraph = p.building.graph ?? p.graph;
      const omOffer = rep.pass
        ? { quote: omFeeQuote({ capex: p.spent.capex, Q: p.enquiry.trueStream.Q, std: p.enquiry.standard, reputation: s.reputation, opexRMd: rep.opexRMd, graph: builtGraph }), weeks: OM.contractWeeks }
        : null;
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
  const supervised = supervisedPlantIds(s);
  const plants: Plant[] = [];
  for (const pl of s.plants) {
    if (pl.status !== 'operating') {
      // contract ended while upgrade works were under way: works delivered to the client's plant are settled as a VO;
      // operator-funded works are lost with the contract
      if (pl.upgrade?.phase === 'building') {
        if (pl.upgrade.clientFunded && pl.upgrade.price) s = book(s, `Variation order settled on contract end: ${pl.company}`, pl.upgrade.price, 'project');
        plants.push({ ...pl, upgrade: null });
      } else plants.push(pl.upgrade ? { ...pl, upgrade: null } : pl);
      continue;
    }
    // staffing matches the fee: a plant is covered only when all the operator posts its contract bills are staffed
    const need = plantPosts(pl);
    const covered = capacity >= need - 1e-9;
    if (covered) capacity -= need;
    let cur = pl;
    // upgrade works complete → the plant runs the new design from this week; a variation order is paid by the client
    if (cur.upgrade?.phase === 'building' && (cur.upgrade.doneWeek ?? 0) <= week) {
      const u = cur.upgrade;
      cur = completeUpgrade(cur);
      if (u.clientFunded && u.price) s = book(s, `Variation order paid: ${pl.company}`, u.price, 'project');
      notices.push(`${pl.company}: upgrade works handed over${u.clientFunded ? ` — client paid the variation order (RM ${(u.price ?? 0).toLocaleString()})` : ''}. Service fee now RM ${cur.contract?.monthlyFee.toLocaleString() ?? '—'}/month.`);
    }
    const out = operateWeek(cur, week, s.market, covered, supervised.has(pl.id));
    plants.push(out.plant);
    const rec = out.plant.history[out.plant.history.length - 1];
    if (rec?.fee !== undefined && (rec.fee || rec.deduction || rec.reimbursed)) {
      s = book(s, `O&M service fee: ${pl.company}${rec.deduction ? ' (less performance deduction)' : ''}`, rec.fee - (rec.deduction ?? 0), 'om');
      if (rec.reimbursed) s = book(s, `Reimbursables billed (chemicals, power, sludge + ${Math.round(OM.handling * 100)} %): ${pl.company}`, rec.reimbursed, 'om');
      s = book(s, `Plant running costs: ${pl.company}`, out.cash - (rec.fee - (rec.deduction ?? 0)) - (rec.reimbursed ?? 0), 'opex');
    } else s = book(s, `O&M ${pl.company}: fee − costs`, out.cash, 'om');
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
  // overdraft: interest on a negative balance (GAME MODEL 0.15 %/week ≈ 8 %/yr); insolvency only beyond the credit line
  if (s.cash < 0) s = book(s, "Overdraft interest", Math.round(s.cash * 0.0015), "overhead");
  s.negativeWeeks = s.cash < -CREDIT_LINE ? s.negativeWeeks + 1 : 0;
  if (s.negativeWeeks >= OVERDRAFT_WEEKS) s.gameOver = true;
  if (notices.length) s.news = [...s.news, ...notices.map((text) => ({ week, text }))].slice(-60);
  return s;
}

/** Is anything scheduled (lab result, construction) or worth waking for? */
function hasPendingEvent(s: GameState): boolean {
  return s.projects.some((p) => p.labQueue.length > 0 || p.building !== null) || s.plants.some((p) => p.status === 'operating' && p.upgrade?.phase === 'building');
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
        if (engineersBusy(s) >= projectSlots(s.staff)) return { toast: `All ${projectSlots(s.staff)} engineer(s) are busy on projects or plant upgrades — hire another engineer or finish one first.` };
        const e = s.enquiries.find((x) => x.id === id);
        if (!e) return {};
        const advance = Math.round(e.contractValue * PAYMENT.advance);
        const next = book({ ...s, projects: [...s.projects, newProject(e, s.week)], activeProjectId: e.id, enquiries: s.enquiries.filter((x) => x.id !== id) }, `Advance payment (30 %): ${e.company}`, advance, 'project');
        return { ...next, projects: next.projects.map((p) => (p.id === e.id ? { ...p, paid: advance } : p)), toast: `Contract signed with ${e.company} — 30 % advance received.` };
      }),
    decline: (id) => set((s) => ({ enquiries: s.enquiries.filter((x) => x.id !== id) })),
    setActiveProject: (id) => set({ activeProjectId: id, studioPlantId: null }),
    openPlantStudio: (plantId) => set({ studioPlantId: plantId }),
    startUpgrade: (plantId) =>
      set((s) => {
        // an upgrade is engineering work: it needs a free engineer until hand-over (or the draft is discarded)
        if (engineersBusy(s) >= projectSlots(s.staff)) return { toast: `All ${projectSlots(s.staff)} engineer(s) are busy — an upgrade needs a free engineer. Hire one or finish a project first.` };
        return { plants: s.plants.map((p) => (p.id === plantId && p.status === 'operating' && !p.upgrade ? { ...p, upgrade: { graph: structuredClone(p.graph), phase: 'draft' } } : p)) };
      }),
    setUpgradeGraph: (plantId, g) => set((s) => ({ plants: s.plants.map((p) => (p.id === plantId && p.upgrade?.phase === 'draft' ? { ...p, upgrade: { ...p.upgrade, graph: g } } : p)) })),
    discardUpgrade: (plantId) => set((s) => ({ plants: s.plants.map((p) => (p.id === plantId && p.upgrade?.phase === 'draft' ? { ...p, upgrade: null } : p)) })),
    submitUpgrade: (plantId) => {
      const s = get();
      const p = s.plants.find((x) => x.id === plantId);
      if (s.gameOver || !p || p.status !== 'operating' || p.upgrade?.phase !== 'draft') return { ok: false, text: 'No upgrade draft.' };
      const q = upgradeQuote(p, p.upgrade.graph, s.week);
      if (!q.ok) return { ok: false, text: q.errors.join(' ') };
      if (!p.contract || s.week + q.weeks >= p.contract.endWeek) return { ok: false, text: 'The O&M contract ends before the works would be handed over.' };
      if (s.cash - q.cost < -CREDIT_LINE) return { ok: false, text: `Not enough cash or credit for RM ${q.cost.toLocaleString()} of works.` };
      const doneWeek = s.week + q.weeks;
      const next = book(s, `Upgrade works (${q.changed.join(', ')}): ${p.company}`, -q.cost, 'capex');
      set({
        ...next,
        plants: next.plants.map((x) =>
          x.id === plantId
            ? {
                ...x,
                upgrade: { ...p.upgrade!, phase: 'building', cost: q.cost, price: q.price, clientFunded: q.clientFunded, reason: q.reason, doneWeek },
                // an incident that justified a reliability VO cannot fund another one
                incidentLog: (x.incidentLog ?? []).map((e) => (q.usedIncidents.includes(e.unitId) ? { ...e, used: true } : e)),
              }
            : x,
        ),
        news: [...next.news, { week: s.week, text: `${p.company}: upgrade works ordered (${q.changed.join(', ')}), RM ${q.cost.toLocaleString()}, hand-over week ${doneWeek}. ${q.reason}` }].slice(-60),
        toast: `Upgrade ordered — works complete in week ${doneWeek}.`,
      });
      return { ok: true, text: q.reason };
    },
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
      // construction is paid weekly as it progresses and the client pays 60 % in weekly progress claims (industry
      // practice: monthly valuations); only the net shortfall needs the overdraft
      const capexPerWeek = rep.capexCharged / weeks;
      const claimPerWeek = rep.milestone / weeks;
      const shortfall = Math.max(0, capexPerWeek - claimPerWeek) * weeks + WEEKLY_OVERHEAD * weeks;
      if (s.cash - shortfall < -CREDIT_LINE) {
        set({ toast: `Construction needs about RM ${Math.round(shortfall).toLocaleString()} more than progress claims cover — beyond your RM ${CREDIT_LINE.toLocaleString()} credit line. Reduce CAPEX or finish a project first.` });
        return false;
      }
      const next = updateProject(s, p.id, (x) => ({ ...x, status: 'building', building: { doneWeek: s.week + weeks, report: rep, graph: p.graph, progress: { capexPerWeek, claimPerWeek, weeksLeft: weeks } }, spent: { ...x.spent, capex: x.spent.capex + rep.capexCharged } }));
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
        // offers made before the 2026-11-22 contract model are re-priced when signed
        const offer = p.omOffer.quote ? p.omOffer : { ...p.omOffer, quote: omFeeQuote({ capex, Q: p.enquiry.trueStream.Q, std: p.enquiry.standard, reputation: s.reputation, opexRMd: simulate(p.built, p.enquiry.trueStream).opexRMd, graph: p.built }) };
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
          contract: contractFor(offer.quote, s.week, offer.weeks),
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
        return { plants: [...s.plants, plant], projects, activeProjectId, toast: `O&M contract signed: RM ${offer.quote.monthlyFee.toLocaleString()}/month service fee + reimbursables for 3 years.` };
      }),
    declineOM: (projectId) => set((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? { ...p, omOffer: null } : p)) })),
    resolveIncident: (plantId, actionId) => {
      const s = get();
      if (s.gameOver) return { ok: false, text: 'Company insolvent.' };
      const pl = s.plants.find((p) => p.id === plantId);
      const a = pl?.incident ? availableActions(pl.graph, pl.incident).find((x) => x.id === actionId) : undefined;
      if (!pl || !pl.incident) return { ok: false, text: 'Nothing to resolve.' };
      if (!a) return { ok: false, text: 'That action is not available for this incident on this plant.' };
      const ok = a.fixes.includes(pl.incident.kind);
      const label = INCIDENT_LABEL[pl.incident.kind];
      // a supervising engineer narrows the diagnosis: a wrong guess is called off early and costs less
      const assisted = !ok && supervisedPlantIds(s).has(pl.id);
      const cost = Math.round(a.cost * (assisted ? OM.engineerWrongActionFactor : 1));
      const text = ok ? `${a.label}: ${a.explain} Incident closed (${label}).` : `${a.label}: no improvement — the cause lies elsewhere.${assisted ? ` Your engineer stopped it early (RM ${cost.toLocaleString()} instead of RM ${a.cost.toLocaleString()}).` : ''}`;
      let next: GameState = cost ? book(s, `SCADA action at ${pl.company}: ${a.label}`, -cost, 'maintenance') : { ...s };
      next = {
        ...next,
        plants: next.plants.map((p) => (p.id !== plantId || !p.incident ? p : { ...p, actionCost: (p.actionCost ?? 0) + cost, incident: ok ? null : { ...p.incident, tried: [...p.incident.tried, a.id] }, satisfaction: ok ? Math.min(100, p.satisfaction + 2) : p.satisfaction })),
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
        if (e.role === 'engineer' && engineersBusy(s) > projectSlots(staff)) return { toast: 'That engineer is running a project or an upgrade — finish it first.' };
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
