/**
 * Contract requirements beyond the discharge standard (tough clients, client tiers). Each is evaluated independently
 * like a regulated parameter, with a why-trace; a failed requirement fails commissioning.
 * Ref: knowledge/processes/technology_tree.md ("Contract requirements").
 */
import { SimResult } from '../simulation/treatment/graph';
import { applicableInstruments, hasInst } from '../simulation/treatment/instrumentation';

export interface Requirements {
  /** maximum sludge / waste disposal cost, RM/d (disposal-cost cap clients) */
  sludgeCapRMd?: number;
  /** minimum share of the influent returned to the client's process on the reuse spec (0–1) */
  reuseMin?: number;
  /** zero liquid discharge: no water to the river (≤ 0.5 % of the influent, e.g. a seal-water bleed) */
  zld?: boolean;
  /** every pump / blower that can have one has a duty/standby machine (medium and MNC clients) */
  standby?: boolean;
}

/** units that can carry a standby machine but do not */
export function missingStandby(sim: SimResult): string[] {
  return Object.values(sim.nodes)
    .map((n) => n.node)
    .filter((n) => applicableInstruments(n.kind, n.params).some((d) => d.key === 'standby') && !hasInst(n, 'standby'))
    .map((n) => n.tag ?? n.id);
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
  if (req.standby) {
    const miss = missingStandby(sim);
    const pass = miss.length === 0;
    out.push({
      id: 'standby',
      label: 'Duty/standby on all pumps and blowers',
      value: miss.length,
      limit: 0,
      unit: 'units without standby',
      pass,
      why: pass
        ? 'Every dosing pump and blower has an installed standby with auto-changeover.'
        : `No standby on ${miss.join(', ')} — the client's engineering standard asks for N+1 machines. Tick "Standby" in the P&ID inspector.`,
    });
  }
  return out;
}

/** influent flow of a simulated design */
function influentQ(sim: SimResult): number | undefined {
  return sim.influentQ;
}
