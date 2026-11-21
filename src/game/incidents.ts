/**
 * Process incidents on operated plants (Phase 3, SCADA). Ref: knowledge/operations/scada.md.
 *
 * An incident is a disturbance the operator must DIAGNOSE from SCADA trends and alarms, then act on.
 * Each incident has:
 *   - a dynamic form (Disturbance[] for plantDynamics.runDynamic: the 48-h SCADA replay),
 *   - a weekly steady-state form (applied in operateWeek while unresolved, so ignoring it costs compliance),
 *   - one or more correct actions. Wrong actions cost money and time but do not clear the incident.
 * Probabilities and costs are GAME MODEL values; the physics of each effect lives in the simulation modules.
 */
import { Stream } from '../simulation/core/stream';
import { Disturbance } from '../simulation/dynamic/plantDynamics';
import { PNode, ProcessGraph } from '../simulation/treatment/graph';
import { hasInst } from '../simulation/treatment/instrumentation';
import { Rng } from './rng';

export type IncidentKind = 'blowerTrip' | 'pumpTrip' | 'probeDrift' | 'toxicSlug' | 'hydraulicSurge' | 'bulking';

export interface Incident {
  kind: IncidentKind;
  /** unit the fault sits on (empty for plant-wide incidents) */
  unitId: string;
  tag: string;
  startWeek: number;
  /** what the operator sees first — deliberately not the diagnosis */
  symptoms: string[];
  /** actions already tried (ids) */
  tried: string[];
  /** severity parameter (probe offset in pH, slug mg/L, surge factor …) */
  magnitude: number;
}

export interface IncidentAction {
  id: string;
  label: string;
  cost: number;
  fixes: IncidentKind[];
  /** unit kinds this action needs somewhere in the plant */
  requires?: PNode['kind'][];
  /** only offered when the faulty unit has (true) / lacks (false) a standby machine */
  needsStandby?: boolean;
  explain: string;
}

export const ACTIONS: IncidentAction[] = [
  { id: 'standbyBlower', label: 'Start standby blower & call blower service', cost: 2_000, fixes: ['blowerTrip'], requires: ['activatedSludge'], needsStandby: true, explain: 'Restores air supply; DO recovers within an hour.' },
  { id: 'hireBlower', label: 'Hire an emergency blower & repair the duty unit', cost: 9_000, fixes: ['blowerTrip'], requires: ['activatedSludge'], needsStandby: false, explain: 'No standby installed — a hired blower restores air until the duty blower is repaired.' },
  { id: 'standbyPump', label: 'Switch to standby dosing pump', cost: 800, fixes: ['pumpTrip'], needsStandby: true, explain: 'Dosing resumes; the loop pulls pH back to set-point.' },
  { id: 'hirePump', label: 'Emergency dosing-pump replacement', cost: 3_500, fixes: ['pumpTrip'], needsStandby: false, explain: 'No standby installed — a replacement pump is fitted the same day.' },
  { id: 'recalibrate', label: 'Two-point recalibrate pH probe (pH 4 / 7 buffers)', cost: 300, fixes: ['probeDrift'], explain: 'Removes the measurement offset — the loop was controlling to a wrong reading.' },
  { id: 'divertEQ', label: 'Divert to EQ / hold back feed, trace the source', cost: 1_200, fixes: ['toxicSlug', 'hydraulicSurge'], requires: ['eq'], explain: 'The EQ tank absorbs the slug or surge and feeds it forward at a controlled rate.' },
  { id: 'chlorinateRAS', label: 'Dose chlorine into return sludge (filament control)', cost: 1_500, fixes: ['bulking'], requires: ['activatedSludge'], explain: 'Kills exposed filaments; settleability (SVI) recovers over days.' },
  { id: 'customerCall', label: 'Call the customer about upstream discharges', cost: 0, fixes: ['toxicSlug'], explain: 'Production stops the spill at source.' },
];

const DOSING: PNode['kind'][] = ['neutralisation', 'precipitation', 'crReduction'];

/** Pick an incident that can physically happen on this plant (GAME MODEL weights). */
export function rollIncident(g: ProcessGraph, week: number, rng: Rng): Incident | null {
  const as = g.nodes.find((n) => n.kind === 'activatedSludge');
  const dosing = g.nodes.filter((n) => DOSING.includes(n.kind));
  const fm = hasInst(g.nodes.find((n) => n.kind === 'influent'), 'flow');
  const opts: (() => Incident)[] = [() => mk('hydraulicSurge', null, 1.6 + 0.4 * rng.next(), [fm ? 'Influent flow alarm HIGH' : 'Operators report the inlet channel running unusually full', 'Customer reports a production wash-down after a shutdown'])];
  if (as) {
    opts.push(() => mk('blowerTrip', as, 0, [hasInst(as, 'doLoop') ? `DO LOW alarm at ${as.tag}; aeration header pressure LOW` : 'Aeration header pressure LOW', `Effluent clarity normal, odour reported around ${as.tag}`]));
    opts.push(() => mk('bulking', as, 0.35, ['Sludge blanket rising in secondary clarifier', 'Effluent turbid after the afternoon peak']));
    opts.push(() => mk('toxicSlug', as, 2 + 2 * rng.next(), ['Respiration (OUR) dropped sharply mid-shift', 'Blue-green tint seen in the inlet channel']));
  }
  for (const d of dosing) {
    // what the operator sees depends on what is instrumented (no pH loop → no alarm, only the weekly lab result)
    const ph = d.kind === 'crReduction' || hasInst(d, 'pHLoop'); // Cr reduction's pH/ORP control is integral
    opts.push(() => mk('pumpTrip', d, 0, [ph ? `pH deviation alarm at ${d.tag}` : 'Weekly lab sample: final effluent pH out of range', 'Reagent day-tank level unchanged since last shift']));
    if (ph) opts.push(() => mk('probeDrift', d, rng.chance(0.5) ? 2.0 : -2.0, [`Reagent consumption at ${d.tag} changed ~30 % with no change in production`, 'Lab bench pH disagrees with the online reading']));
  }
  const f = rng.pick(opts);
  return f ? f() : null;
  function mk(kind: IncidentKind, n: PNode | null, magnitude: number, symptoms: string[]): Incident {
    return { kind, unitId: n?.id ?? '', tag: n?.tag ?? 'Plant', startWeek: week, symptoms, tried: [], magnitude };
  }
}

/** Disturbances for the 48-h SCADA replay. */
export function incidentDisturbances(inc: Incident | null): Disturbance[] {
  if (!inc) return [];
  switch (inc.kind) {
    case 'blowerTrip':
      return [{ kind: 'blowerTrip', unitId: inc.unitId, capacity: inc.magnitude }];
    case 'pumpTrip':
      return [{ kind: 'pumpTrip', unitId: inc.unitId }];
    case 'probeDrift':
      return [{ kind: 'probeOffset', unitId: inc.unitId, offset: inc.magnitude }];
    case 'toxicSlug':
      return [{ kind: 'toxicSlug', metal: 'Cu', mgL: inc.magnitude, fromH: 6, toH: 14 }];
    case 'hydraulicSurge':
      return [{ kind: 'flowSurge', factor: inc.magnitude, fromH: 8, toH: 20 }];
    case 'bulking': {
      return [{ kind: 'bulking', unitId: inc.unitId, settleFactor: inc.magnitude }];
    }
  }
}

/**
 * Steady-state form of an unresolved incident for the weekly grab sample (operateWeek).
 * Weekly sample = a moment within the disturbed week, so transient incidents (slug, surge) are applied at a damped size.
 */
export function applyIncidentSteady(g: ProcessGraph, inf: Stream, inc: Incident | null): { graph: ProcessGraph; influent: Stream } {
  if (!inc) return { graph: g, influent: inf };
  const nodes = g.nodes.map((n) => ({ ...n, params: { ...n.params } }));
  const node = nodes.find((n) => n.id === inc.unitId);
  const influent = { ...inf, dissolved: { ...inf.dissolved } };
  switch (inc.kind) {
    case 'blowerTrip':
      if (node) node.params.do = 0.05; // standby capacity only: DO near zero, heterotroph growth O2-limited (K_OH 0.2)
      break;
    case 'pumpTrip':
      if (node) node.bypass = true;
      break;
    case 'probeDrift':
      // the loop holds the *reading* at set-point, so the true pH is set-point − offset
      if (node) node.params.targetPH = Number(node.params.targetPH) - inc.magnitude;
      break;
    case 'toxicSlug':
      influent.dissolved.Cu += inc.magnitude * 0.5;
      break;
    case 'hydraulicSurge':
      influent.Q *= 1 + (inc.magnitude - 1) * 0.6;
      break;
    case 'bulking': {
      const clar = g.edges.find((e) => e.from === inc.unitId);
      const c = clar && nodes.find((n) => n.id === clar.to && n.kind === 'clarifier');
      if (c) c.params.area = Number(c.params.area) * inc.magnitude;
      break;
    }
  }
  return { graph: { ...g, nodes }, influent };
}

export function availableActions(g: ProcessGraph, inc?: Incident | null): IncidentAction[] {
  const unit = inc ? g.nodes.find((n) => n.id === inc.unitId) : undefined;
  return ACTIONS.filter((a) => {
    if (a.requires && !a.requires.every((k) => g.nodes.some((n) => n.kind === k))) return false;
    if (a.needsStandby === undefined) return true;
    // no incident given → list every possible action; a plant-wide incident → pump/blower actions are not offered
    if (!unit) return inc === undefined;
    return hasInst(unit, 'standby') === a.needsStandby;
  });
}

/** A trip on a machine that has an installed standby changes over automatically (no incident, just a repair). */
export function autoChangeover(g: ProcessGraph, inc: Incident): boolean {
  if (inc.kind !== 'pumpTrip' && inc.kind !== 'blowerTrip') return false;
  return hasInst(g.nodes.find((n) => n.id === inc.unitId), 'standby');
}

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  blowerTrip: 'Aeration blower trip',
  pumpTrip: 'Dosing pump failure',
  probeDrift: 'pH probe drift',
  toxicSlug: 'Toxic metal slug',
  hydraulicSurge: 'Hydraulic surge',
  bulking: 'Filamentous bulking',
};

/** Operator set-points adjustable from SCADA, per unit kind (whitelist + bounds; everything else is a design change). */
export const SETPOINTS: Partial<Record<PNode['kind'], { key: string; label: string; min: number; max: number; step: number }[]>> = {
  neutralisation: [{ key: 'targetPH', label: 'pH set-point', min: 2, max: 12, step: 0.1 }],
  precipitation: [{ key: 'targetPH', label: 'pH set-point', min: 6, max: 12, step: 0.1 }],
  crReduction: [{ key: 'targetPH', label: 'pH set-point', min: 1.5, max: 4, step: 0.1 }],
  activatedSludge: [
    { key: 'do', label: 'DO set-point (mg/L)', min: 0.5, max: 4, step: 0.1 },
    { key: 'mlss', label: 'MLSS set-point (mg/L) — MLSS control', min: 500, max: 8000, step: 100 },
    { key: 'ras', label: 'RAS ratio (Qr/Q)', min: 0.1, max: 2, step: 0.05 },
    { key: 'srt', label: 'SRT (d) — via wasting', min: 3, max: 30, step: 0.5 },
  ],
  coagulation: [{ key: 'dose', label: 'Coagulant dose (mg/L)', min: 0, max: 400, step: 5 }],
};

/** Validated set-point value, or null if the key is not an operator set-point for this unit kind. */
export function clampSetpoint(kind: PNode['kind'], key: string, value: number): number | null {
  const d = SETPOINTS[kind]?.find((x) => x.key === key);
  if (!d || !Number.isFinite(value)) return null;
  return Math.min(d.max, Math.max(d.min, value));
}
