/**
 * Instrumentation and redundancy per unit (Phase 4, P&ID). Ref: knowledge/operations/instrumentation.md.
 * Tags follow ISA-5.1: AIT/AIC analyser transmitter/controller (pH, DO), LIT/LSH level, FIT flow, P-xxA/B pumps, B-xxA/B blowers.
 * A missing `inst` entry means the standard set: control loops and level/flow instruments ARE installed (older designs and
 * saves keep full control), standby machines are NOT (they are an explicit redundancy choice; QA review).
 * Costs are GAME MODEL (verify) installed prices in RM.
 */
import type { PNode } from './graph';

export type InstKey = 'pHLoop' | 'doLoop' | 'level' | 'flow' | 'standby';

export interface InstDef {
  key: InstKey;
  label: string;
  /** ISA tag letters shown on the P&ID */
  isa: string;
  capexRM: number;
  kinds: PNode['kind'][];
  why: string;
}

// Cr(VI) reduction's pH/ORP control is integral to the unit (not optional). Coagulation needs a loop only with a pH trim.
const DOSING: PNode['kind'][] = ['neutralisation', 'precipitation', 'coagulation'];

export const INSTRUMENTS: InstDef[] = [
  { key: 'pHLoop', label: 'pH control loop (probe, controller, metering-pump VFD)', isa: 'AIC', capexRM: 18_000, kinds: DOSING, why: 'Without it the dose is set by hand at the design average: pH swings with load and nobody is alarmed.' },
  { key: 'doLoop', label: 'DO control loop (probe, controller, blower VFD)', isa: 'AIC', capexRM: 22_000, kinds: ['activatedSludge'], why: 'Without it the blower runs at fixed output: NH₃ suffers at peak load and power is wasted at night.' },
  { key: 'level', label: 'Level transmitter + high-level switch', isa: 'LIT', capexRM: 6_000, kinds: ['eq'], why: 'Without it an overflow is only noticed when someone walks past.' },
  { key: 'flow', label: 'Inlet flow meter', isa: 'FIT', capexRM: 12_000, kinds: ['influent'], why: 'Without it surges are not seen in SCADA.' },
  { key: 'standby', label: 'Standby (duty/standby) pump or blower with auto-changeover', isa: 'B', capexRM: 9_000, kinds: [...DOSING, 'crReduction', 'activatedSludge'], why: 'With it a pump or blower trip changes over automatically; without it you need emergency hire or repair.' },
];

/** Extra cost of a standby blower vs a standby dosing pump (blowers are bigger). */
export const STANDBY_BLOWER_EXTRA_RM = 26_000;

/** Instruments that apply to this unit (a coagulation pH loop only exists when the unit has a pH trim set-point). */
export function applicableInstruments(kind: PNode['kind'], params?: PNode['params']): InstDef[] {
  return INSTRUMENTS.filter((d) => d.kinds.includes(kind) && !(d.key === 'pHLoop' && kind === 'coagulation' && !(Number(params?.pHset) > 0)));
}

/** Is this instrument installed on the node? (applicable and not switched off; default = installed) */
export function hasInst(n: (Pick<PNode, 'kind' | 'inst'> & { params?: PNode['params'] }) | undefined, key: InstKey): boolean {
  if (!n) return false;
  if (!applicableInstruments(n.kind, n.params).some((d) => d.key === key)) return false;
  return n.inst?.[key] ?? key !== 'standby';
}

export function instCapex(n: Pick<PNode, 'kind' | 'inst'> & { params?: PNode['params'] }): number {
  return applicableInstruments(n.kind, n.params).reduce((a, d) => a + (hasInst(n, d.key) ? d.capexRM + (d.key === 'standby' && n.kind === 'activatedSludge' ? STANDBY_BLOWER_EXTRA_RM : 0) : 0), 0);
}

/**
 * Unit parameters as the plant can actually run them: a coagulation pH trim needs its pH loop (without the probe and
 * controller there is nothing to hold the set-point, so the trim is off).
 */
export function effectiveParams(n: Pick<PNode, 'kind' | 'inst' | 'params'>): PNode['params'] {
  if (n.kind === 'coagulation' && Number(n.params.pHset) > 0 && !hasInst(n, 'pHLoop')) return { ...n.params, pHset: 0 };
  return n.params;
}
