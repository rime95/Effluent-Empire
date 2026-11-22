/**
 * Contract requirements beyond the discharge standard (tough clients, client tiers). Each is evaluated independently
 * like a regulated parameter, with a why-trace; a failed requirement fails commissioning.
 * Ref: knowledge/processes/technology_tree.md ("Contract requirements").
 */
import { SimResult } from '../simulation/treatment/graph';

export interface Requirements {
  /** maximum sludge / waste disposal cost, RM/d (disposal-cost cap clients) */
  sludgeCapRMd?: number;
  /** minimum share of the influent returned to the client's process on the reuse spec (0–1) */
  reuseMin?: number;
  /** zero liquid discharge: no water to the river (≤ 0.5 % of the influent, e.g. a seal-water bleed) */
  zld?: boolean;
}

/** ZLD tolerance: discharge flow allowed as a fraction of the influent */
export const ZLD_TOLERANCE = 0.005;

export interface ReqCheck {
  id: keyof Requirements;
  label: string;
  value: number;
  limit: number;
  unit: string;
  pass: boolean;
  why: string;
}

export function evaluateRequirements(sim: SimResult, req?: Requirements): ReqCheck[] {
  const out: ReqCheck[] = [];
  if (!req) return out;
  if (req.sludgeCapRMd !== undefined) {
    const v = sim.opexSplit.sludge;
    const pass = v <= req.sludgeCapRMd + 1e-6;
    out.push({
      id: 'sludgeCapRMd',
      label: 'Sludge disposal cost cap',
      value: v,
      limit: req.sludgeCapRMd,
      unit: 'RM/d',
      pass,
      why: pass
        ? 'Disposal cost within the contract cap.'
        : `Disposal costs RM ${v.toFixed(0)}/d against a cap of RM ${req.sludgeCapRMd.toFixed(0)}/d — haulage is charged per wet tonne: dewater (filter press) and dry the cake to cut the tonnage.`,
    });
  }
  if (req.reuseMin !== undefined) {
    const inQ = Math.max(1e-9, influentQ(sim) ?? 1);
    const v = (sim.reuse?.onSpecM3d ?? 0) / inQ;
    const pass = v >= req.reuseMin - 1e-6;
    out.push({
      id: 'reuseMin',
      label: 'Water reuse (on spec)',
      value: v * 100,
      limit: req.reuseMin * 100,
      unit: '% of influent',
      pass,
      why: pass
        ? 'Reuse target met.'
        : (sim.reuse?.offSpec.length ?? 0) > 0
          ? `Reclaimed water is off the reuse spec (${sim.reuse!.offSpec.join(', ')}) and does not count — polish it with RO.`
          : `Only ${(v * 100).toFixed(0)} % of the water goes back to the process — the contract asks for ${(req.reuseMin * 100).toFixed(0)} %. Route more flow through UF + RO to the reclaim system.`,
    });
  }
  if (req.zld) {
    const inQ = Math.max(1e-9, influentQ(sim) ?? 1);
    const v = (sim.effluent?.Q ?? 0) / inQ;
    const pass = v <= ZLD_TOLERANCE + 1e-9;
    out.push({
      id: 'zld',
      label: 'Zero liquid discharge',
      value: v * 100,
      limit: ZLD_TOLERANCE * 100,
      unit: '% of influent discharged',
      pass,
      why: pass
        ? 'No liquid leaves to the river: water is reused, concentrate is hauled or dried.'
        : `${(sim.effluent?.Q ?? 0).toFixed(1)} m³/d still reaches the discharge. Recover the water (RO permeate, evaporator distillate → reclaim) and haul the last concentrate as liquid waste.`,
    });
  }
  return out;
}

/** influent flow of a simulated design */
function influentQ(sim: SimResult): number | undefined {
  return sim.influentQ;
}
