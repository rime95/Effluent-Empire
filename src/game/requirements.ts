/**
 * Contract requirements beyond the discharge standard (tough clients, client tiers). Each is evaluated independently
 * like a regulated parameter, with a why-trace; a failed requirement fails commissioning.
 * Ref: knowledge/processes/technology_tree.md ("Contract requirements").
 */
import { SimResult } from '../simulation/treatment/graph';
import { PRICES } from '../simulation/treatment/catalogue';
import { STANDARDS, combinedMetalsApply, limitsFor, measure, type ParamId } from '../simulation/treatment/compliance';
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
  /** better than Standard A: every limited parameter at or below this fraction of its Standard A limit (flagship ESG clients) */
  effluentFactor?: number;
  /** net specific energy cap, kWh per m³ treated (grid power minus biogas CHP power) */
  energyMax_kWhm3?: number;
  /** sludge production cap, kg dry solids per m³ treated */
  sludgeMax_kgm3?: number;
  /** minimum metal recovered as saleable cathode by electrowinning, kg/d (megaproject clients) */
  metalRecoveryMin_kgd?: number;
  /** maximum wet sludge cake hauled, kg/d (solid disposal points only; megaproject clients — dry the cake) */
  cakeWetMax_kgd?: number;
}

/** wet sludge cake leaving by truck, kg/d (liquid haulage of concentrate excluded) */
export function cakeWet_kgd(sim: SimResult): number {
  return sim.disposal.filter((d) => !d.liquid).reduce((a, d) => a + d.wetKgD, 0);
}

/** metal plated by every electrowinning cell of a design, kg/d */
export function metalRecovered_kgd(sim: SimResult): number {
  return Object.values(sim.nodes)
    .filter((n) => n.node.kind === 'electrowinning')
    .reduce((a, n) => a + (n.result.calcs?.cu?.value ?? 0) + (n.result.calcs?.ni?.value ?? 0), 0);
}

/** Green (ESG scorecard) terms: the ones a flagship client pays a bonus for beating. */
export const GREEN_TERMS: (keyof Requirements)[] = ['effluentFactor', 'energyMax_kWhm3', 'sludgeMax_kgm3', 'reuseMin', 'zld'];
/** margin by which a green term must be beaten to earn its share of the ESG bonus (GAME MODEL) */
export const ESG_MARGIN = 0.1;

/**
 * Worst ratio of the effluent to its Standard A limit over every parameter with a maximum (temperature and pH excluded:
 * they are a range, not a load). Reg. 11(2) combined-metal limits count where they apply. ZLD (no effluent) → 0.
 */
export function effluentRatioToA(sim: SimResult): { ratio: number; param: ParamId | null } {
  const eff = sim.effluent;
  if (!eff || eff.Q <= 1e-6) return { ratio: 0, param: null };
  const lim = { ...limitsFor('A'), ...(combinedMetalsApply(eff) ? STANDARDS.combinedMetals.A : {}) } as Partial<Record<ParamId, { max?: number }>>;
  const m = measure(eff);
  let worst = { ratio: 0, param: null as ParamId | null };
  for (const [p, l] of Object.entries(lim) as [ParamId, { max?: number }][]) {
    if (p === 'T' || p === 'pH' || l.max === undefined || l.max <= 0) continue;
    const r = m[p] / l.max;
    if (r > worst.ratio) worst = { ratio: r, param: p };
  }
  return worst;
}

/** net specific energy, kWh/m³: plant power minus biogas CHP power, over the total inflow */
export function netEnergy_kWhm3(sim: SimResult): number {
  const chp = (sim.credits ?? []).filter((c) => /biogas/i.test(c.name)).reduce((a, c) => a + c.RMd, 0) / PRICES.electricity_kWh;
  return (sim.energy_kWhd - chp) / Math.max(1e-9, sim.influentQ ?? 1);
}

/** sludge production, kg dry solids per m³ treated */
export function sludge_kgm3(sim: SimResult): number {
  return sim.sludgeKgD / Math.max(1e-9, sim.influentQ ?? 1);
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
  if (req.effluentFactor !== undefined) {
    const { ratio, param } = effluentRatioToA(sim);
    const pass = ratio <= req.effluentFactor + 1e-9;
    out.push({
      id: 'effluentFactor',
      label: 'Effluent better than Standard A',
      value: ratio * 100,
      limit: req.effluentFactor * 100,
      unit: '% of the Std A limit (worst parameter)',
      pass,
      why: pass
        ? `Every parameter is at or below ${Math.round(req.effluentFactor * 100)} % of its Standard A limit.`
        : `${param ? STANDARDS.parameters[param].label : 'A parameter'} is at ${Math.round(ratio * 100)} % of its Standard A limit — the client's own target is ${Math.round(req.effluentFactor * 100)} %. Polish further (sand filter, activated carbon, a second precipitation stage or RO).`,
    });
  }
  if (req.energyMax_kWhm3 !== undefined) {
    const v = netEnergy_kWhm3(sim);
    const pass = v <= req.energyMax_kWhm3 + 1e-9;
    out.push({
      id: 'energyMax_kWhm3',
      label: 'Net energy intensity',
      value: v,
      limit: req.energyMax_kWhm3,
      unit: 'kWh/m³',
      pass,
      why: pass
        ? 'Energy intensity within the client\'s ESG target.'
        : `The plant uses ${v.toFixed(2)} kWh per m³ against a target of ${req.energyMax_kWhm3.toFixed(2)} — trim aeration (DO control), oversized pumping, or recover biogas power.`,
    });
  }
  if (req.sludgeMax_kgm3 !== undefined) {
    const v = sludge_kgm3(sim);
    const pass = v <= req.sludgeMax_kgm3 + 1e-9;
    out.push({
      id: 'sludgeMax_kgm3',
      label: 'Sludge production',
      value: v,
      limit: req.sludgeMax_kgm3,
      unit: 'kg DS/m³',
      pass,
      why: pass
        ? 'Sludge production within the client\'s ESG target.'
        : `${v.toFixed(3)} kg dry solids per m³ against a target of ${req.sludgeMax_kgm3.toFixed(3)} — avoid chemical overdosing (jar-test the coagulant, NaOH instead of lime), run a longer sludge age, or recover metal instead of precipitating it.`,
    });
  }
  if (req.cakeWetMax_kgd !== undefined) {
    const v = cakeWet_kgd(sim);
    const pass = v <= req.cakeWetMax_kgd + 1e-6;
    out.push({
      id: 'cakeWetMax_kgd',
      label: 'Sludge cake hauled (wet)',
      value: v,
      limit: req.cakeWetMax_kgd,
      unit: 'kg/d',
      pass,
      why: pass
        ? 'Cake tonnage within the scheduled-waste limit of the contract.'
        : `${v.toFixed(0)} kg/d of wet sludge leaves by truck against the client's ${req.cakeWetMax_kgd.toFixed(0)} kg/d — thicken, press and dry the cake (dryer to ~80 % DS) to cut the water you haul.`,
    });
  }
  if (req.metalRecoveryMin_kgd !== undefined) {
    const v = metalRecovered_kgd(sim);
    const pass = v >= req.metalRecoveryMin_kgd - 1e-9;
    out.push({
      id: 'metalRecoveryMin_kgd',
      label: 'Metal recovered by electrowinning',
      value: v,
      limit: req.metalRecoveryMin_kgd,
      unit: 'kg/d',
      pass,
      why: pass
        ? 'Metal recovery target met: the nickel leaves as saleable cathode, not as hazardous sludge.'
        : `Only ${v.toFixed(1)} kg/d of metal is plated out against the client's ${req.metalRecoveryMin_kgd.toFixed(1)} kg/d — electrowin the segregated nickel rinse before it is blended (large cathode area, current density near the limiting current).`,
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

/**
 * ESG bonus at commissioning (flagship clients, GAME MODEL): the bonus is split equally over the contract's green terms;
 * each term earns its share when beaten by ESG_MARGIN (a cap at ≤ 90 % of the limit, a reuse target by +10 %, ZLD when met).
 */
export function esgBonus(checks: ReqCheck[], bonusRM: number): { paid: number; earned: string[]; total: number } {
  const green = checks.filter((c) => GREEN_TERMS.includes(c.id));
  if (!green.length || bonusRM <= 0) return { paid: 0, earned: [], total: green.length };
  const beaten = green.filter((c) => (c.id === 'zld' ? c.pass : c.id === 'reuseMin' ? c.value >= c.limit * (1 + ESG_MARGIN) : c.value <= c.limit * (1 - ESG_MARGIN)));
  return { paid: Math.round((bonusRM * beaten.length) / green.length), earned: beaten.map((c) => c.label), total: green.length };
}
