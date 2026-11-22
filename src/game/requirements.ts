/**
 * Contract requirements beyond the discharge standard (tough clients, client tiers). Each is evaluated independently
 * like a regulated parameter, with a why-trace; a failed requirement fails commissioning.
 * Ref: knowledge/processes/technology_tree.md ("Contract requirements").
 */
import { SimResult } from '../simulation/treatment/graph';

export interface Requirements {
  /** maximum sludge / waste disposal cost, RM/d (disposal-cost cap clients) */
  sludgeCapRMd?: number;
}

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
  return out;
}
