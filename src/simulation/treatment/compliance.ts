/**
 * Discharge compliance: every regulated parameter is evaluated independently against the versioned standards
 * (regulations/standards.json), with an explanation trace that tells the player *why* it passed or failed.
 * Ref: knowledge/regulations/malaysia_environmental_quality.md
 */
import standardsJson from '../regulations/standards.json';
import { METALS, Metal, Stream, bod5, codTotal, metalSoluble, metalTotal, oilGrease, poolMass, tss, POOLS, Pool } from '../core/stream';
import { minimumSolubilityPH, solubilityMgL } from '../chemistry/solubility';
import { SimResult } from './graph';

export type StandardId = 'A' | 'B';
export type ParamId = 'T' | 'pH' | 'BOD5' | 'COD' | 'TSS' | 'OG' | 'NH3N' | 'Ni' | 'Cu' | 'Zn' | 'Al' | 'Fe' | 'CrVI' | 'CrIII' | 'MetalsTotal' | 'MetalsSoluble' | 'Sulphide';

interface Limit {
  min?: number;
  max?: number;
}

export const STANDARDS = standardsJson as unknown as {
  version: string;
  source: string;
  parameters: Record<ParamId, { label: string; unit: string }>;
  standards: Record<StandardId, { label: string; description: string; limits: Partial<Record<ParamId, Limit>> }>;
  codByTrade: Record<string, Record<StandardId, number>>;
  combinedMetals: { metals: string[]; presenceThreshold_mgL: number } & Record<StandardId, Partial<Record<ParamId, Limit>>>;
};

export function limitsFor(std: StandardId, trade = 'default'): Partial<Record<ParamId, Limit>> {
  const cod = STANDARDS.codByTrade[trade] ?? STANDARDS.codByTrade.default;
  return { ...STANDARDS.standards[std].limits, COD: { max: cod[std] } };
}

export function measure(s: Stream): Record<ParamId, number> {
  return {
    T: s.T,
    pH: s.pH,
    BOD5: bod5(s),
    COD: codTotal(s),
    TSS: tss(s),
    OG: oilGrease(s),
    NH3N: s.NH4N,
    Ni: metalTotal(s, 'Ni'),
    Cu: metalTotal(s, 'Cu'),
    Zn: metalTotal(s, 'Zn'),
    Al: s.alSolid + s.alDissolved,
    Fe: s.feSolid + (s.feDissolved ?? 0),
    CrVI: s.CrVI,
    CrIII: metalTotal(s, 'Cr'),
    MetalsTotal: METALS.reduce((a, m) => a + metalTotal(s, m), 0),
    MetalsSoluble: METALS.reduce((a, m) => a + metalSoluble(s, m), 0),
    Sulphide: (s.sulfideS ?? 0) * 32060,
  };
}

/** Regulation 11(2): the combined limits apply when two or more of Cu, Mn, Ni, Sn, Zn are present. */
export function combinedMetalsApply(s: Stream): boolean {
  const th = STANDARDS.combinedMetals.presenceThreshold_mgL;
  return METALS.filter((m) => STANDARDS.combinedMetals.metals.includes(m) && metalTotal(s, m) > th).length >= 2;
}

export interface ParamCheck {
  param: ParamId;
  label: string;
  unit: string;
  value: number;
  limit: Limit;
  pass: boolean;
  why: string;
}

export interface ComplianceReport {
  standard: StandardId;
  version: string;
  pass: boolean;
  checks: ParamCheck[];
}

const POOL_LABEL: Record<Pool, string> = {
  grit: 'grit',
  inert: 'inert mineral solids',
  colloid: 'stable colloids',
  floc: 'coagulated floc',
  organic: 'particulate organics',
  precipitate: 'metal hydroxide precipitate',
  alFloc: 'aluminium hydroxide floc',
  feFloc: 'ferric hydroxide floc',
  biomass: 'biomass (activated sludge floc)',
};

function maxProcessPH(sim: SimResult | null): number | null {
  if (!sim) return null;
  let best: number | null = null;
  for (const id of sim.order) {
    const n = sim.nodes[id];
    if (!n) continue;
    if (n.node.kind === 'precipitation' || n.node.kind === 'neutralisation') best = Math.max(best ?? -Infinity, n.result.out.pH);
  }
  return best;
}

function has(sim: SimResult | null, kind: string): boolean {
  return !!sim && Object.values(sim.nodes).some((n) => n.node.kind === kind);
}

function explainMetal(m: Metal, s: Stream, sim: SimResult | null, pass: boolean): string {
  const diss = s.dissolved[m];
  const part = s.precipitated[m];
  const opt = minimumSolubilityPH(m, s.T);
  const cx = s.complexed?.[m] ?? 0;
  const sf = s.sulfide?.[m] ?? 0;
  if (pass) return `Dissolved ${diss.toFixed(3)} + particulate ${part.toFixed(3)} mg/L${cx > 0.001 ? ` + complexed ${cx.toFixed(3)}` : ''}${sf > 0.001 ? ` + sulfide floc ${sf.toFixed(3)}` : ''}.`;
  if (cx >= Math.max(diss, part, sf)) return `${cx.toFixed(2)} mg/L of the ${m} is held in solution by complexing agents (citrate/lactate/ammonia from electroless baths) — raising the pH cannot precipitate it as hydroxide. Sulfide precipitation (NaHS) breaks the complex; follow it with coagulation + polymer to catch the fine sulfide.`;
  if (sf >= Math.max(diss, part)) return `${sf.toFixed(2)} mg/L of the ${m} leaves as fine metal-sulfide particles — sulfide precipitate is colloidal: coagulate and flocculate it (with polymer) before the clarifier, then filter.`;
  if (diss >= part) {
    // which unit re-dissolved it? (largest rise in dissolved metal across a unit, after precipitation had happened)
    let culprit: { tag: string; from: number; to: number; pHin: number; pHout: number } | null = null;
    if (sim) {
      for (const id of sim.order) {
        const n = sim.nodes[id];
        if (!n) continue;
        const rise = n.result.out.dissolved[m] - n.inlet.dissolved[m];
        if (rise > 0.2 && n.inlet.precipitated[m] > 0.2 && (!culprit || rise > culprit.to - culprit.from))
          culprit = { tag: n.node.tag ?? n.node.kind, from: n.inlet.dissolved[m], to: n.result.out.dissolved[m], pHin: n.inlet.pH, pHout: n.result.out.pH };
      }
    }
    if (culprit)
      return `${m} was precipitated, then RE-DISSOLVED at ${culprit.tag}: pH fell ${culprit.pHin.toFixed(1)} → ${culprit.pHout.toFixed(1)} and dissolved ${m} rose ${culprit.from.toFixed(2)} → ${culprit.to.toFixed(2)} mg/L. Hold the pH there (pH control set-point) or remove the solids before any step that lowers the pH.`;
    const pH = maxProcessPH(sim);
    if (pH !== null && solubilityMgL(m, pH, s.T) < diss * 0.5)
      return `${m} was precipitated at pH ${pH.toFixed(1)} (solubility ${solubilityMgL(m, pH, s.T).toPrecision(2)} mg/L) but fine particles were carried over and re-dissolved when the pH was lowered afterwards (now pH ${s.pH.toFixed(1)}). Total ${m} counts against the limit: improve solids separation before final pH correction.`;
    if (pH === null) return `${diss.toFixed(2)} mg/L is still dissolved: nothing raised the pH to precipitate ${m}(OH)₂ (minimum solubility ≈ ${opt.mgL.toPrecision(2)} mg/L at pH ${opt.pH.toFixed(1)}).`;
    return `${diss.toFixed(2)} mg/L is still dissolved. Highest treatment pH was ${pH.toFixed(1)}, where ${m}(OH)₂ solubility is ${solubilityMgL(m, pH, s.T).toPrecision(2)} mg/L; its minimum is ≈ ${opt.mgL.toPrecision(2)} mg/L at pH ${opt.pH.toFixed(1)}. Check also that a later step did not lower the pH and re-dissolve it.`;
  }
  return `${part.toFixed(2)} mg/L leaves as fine ${m}(OH)₂ particles — precipitation worked, solids separation did not. Improve coagulation, clarifier overflow rate or add filtration.`;
}

function explainTSS(s: Stream, pass: boolean): string {
  const masses = POOLS.map((p) => [p, poolMass(s, p)] as const).sort((a, b) => b[1] - a[1]);
  const [top, mass] = masses[0];
  const head = `Largest fraction: ${POOL_LABEL[top]} (${mass.toFixed(1)} mg/L).`;
  if (pass) return head;
  const tips: Record<Pool, string> = {
    colloid: 'Colloids do not settle — destabilise them with a coagulant at the optimum dose.',
    precipitate: 'Pin-floc precipitate settles slowly — longer reaction time and coagulation/flocculation grow larger particles.',
    biomass: 'Biomass carry-over — the secondary clarifier overflow rate is too high for the mixed-liquor settling velocity, or SRT is too short.',
    floc: 'Floc carry-over — reduce clarifier overflow rate or add a sand filter.',
    alFloc: 'Coagulant floc carry-over — reduce dose or improve settling/filtration.',
    feFloc: 'Coagulant floc carry-over — reduce dose or improve settling/filtration.',
    organic: 'Particulate organics — primary settling or biological treatment needed.',
    inert: 'Mineral solids — clarification needed.',
    grit: 'Grit — a settling step is needed.',
  };
  return `${head} ${tips[top]}`;
}

function explainCOD(s: Stream, sim: SimResult | null, pass: boolean, isBOD: boolean): string {
  const soluble_b = s.SS;
  const inert = s.SI;
  const part = s.XS + s.XI + 1.42 * s.biomass;
  const head = `Soluble biodegradable ${soluble_b.toFixed(0)}, soluble inert ${inert.toFixed(0)}, particulate ${part.toFixed(0)} mg COD/L.`;
  if (pass) return head;
  if (!isBOD && inert > Math.max(soluble_b, part)) return `${head} Most of the remaining COD is non-biodegradable soluble organics — biology cannot remove it (advanced oxidation or adsorption required).`;
  if (soluble_b > part) {
    if (!has(sim, 'activatedSludge')) return `${head} Dissolved biodegradable organics need biological treatment.`;
    return `${head} The biological stage is not completing removal — check for washout, inhibition (pH, metals) or nutrient limitation.`;
  }
  return `${head} Organic solids are escaping — improve solids separation.`;
}

export function evaluate(effluent: Stream, std: StandardId, sim: SimResult | null = null, trade = 'default'): ComplianceReport {
  const lim = { ...limitsFor(std, trade), ...(combinedMetalsApply(effluent) ? STANDARDS.combinedMetals[std] : {}) };
  const vals = measure(effluent);
  const checks: ParamCheck[] = [];
  for (const [param, limit] of Object.entries(lim) as [ParamId, Limit][]) {
    const value = vals[param];
    const pass = (limit.min === undefined || value >= limit.min) && (limit.max === undefined || value <= limit.max);
    let why = '';
    switch (param) {
      case 'pH':
        why = pass ? 'Within range.' : value < (limit.min ?? 0) ? 'Effluent is too acidic — add a final pH correction (alkali).' : 'Effluent is too alkaline — a high-pH precipitation step needs final neutralisation with acid.';
        break;
      case 'TSS':
        why = explainTSS(effluent, pass);
        break;
      case 'COD':
        why = explainCOD(effluent, sim, pass, false);
        break;
      case 'BOD5':
        why = explainCOD(effluent, sim, pass, true);
        break;
      case 'OG':
        {
          const fl = effluent.OGfloc ?? 0;
          const top = Math.max(effluent.OGfree, effluent.OGemulsified, fl);
          why = pass
            ? `Free ${effluent.OGfree.toFixed(1)}, emulsified ${effluent.OGemulsified.toFixed(1)}, floc-bound ${fl.toFixed(1)} mg/L.`
            : top === effluent.OGfree
              ? 'Free oil remains — an oil separator or DAF with lower surface loading removes it.'
              : top === fl
                ? 'Coagulated, floc-bound oil remains — it is nearly neutrally buoyant, so gravity units barely catch it; a DAF floats it.'
                : 'Emulsified oil remains — gravity cannot separate it: break the emulsion with coagulation, then float it in a DAF; activated sludge adsorbs the rest.';
        }
        break;
      case 'NH3N':
        why = pass ? 'Within limit.' : has(sim, 'activatedSludge') ? 'Nitrification incomplete — nitrifiers grow slowly: increase SRT, keep DO ≥ 2 mg/L and keep pH ≥ 6.8 (nitrification consumes 7.1 mg alkalinity per mg N).' : 'Ammonia passes through physical–chemical treatment; biological nitrification is required.';
        break;
      case 'Al':
      case 'Fe':
        why = pass
          ? 'Within limit.'
          : param === 'Al' && effluent.alDissolved > effluent.alSolid
            ? `${effluent.alDissolved.toFixed(1)} mg/L aluminium is dissolved: alum/PAC were used outside their pH window (aluminate forms above pH ≈ 8.5). Use ferric, or coagulate before raising pH.`
            : param === 'Fe' && (effluent.feDissolved ?? 0) > effluent.feSolid
              ? `${(effluent.feDissolved ?? 0).toFixed(1)} mg/L iron is dissolved: ferric hydroxide only dissolves below pH ≈ 3, so the ferric dose overwhelmed the alkalinity. Reduce the dose or add pH control at the coagulation tank.`
              : `Coagulant ${param === 'Al' ? 'aluminium' : 'iron'} hydroxide floc is carried into the effluent — reduce dose or improve settling/filtration.`;
        break;
      case 'MetalsTotal':
      case 'MetalsSoluble': {
        const parts = METALS.map((m) => `${m} ${(param === 'MetalsTotal' ? metalTotal(effluent, m) : effluent.dissolved[m]).toFixed(2)}`).join(' + ');
        why = pass
          ? `Two or more regulated metals present, so Regulation 11(2) applies: ${parts} mg/L.`
          : `Regulation 11(2) caps the SUM of Cu, Mn, Ni, Sn and Zn when two or more are present (${parts} mg/L) — each metal can pass its own limit and the plant still fails. Remove ${param === 'MetalsSoluble' ? 'dissolved metal (precipitation pH, avoid re-dissolution by final pH correction)' : 'metal more completely (precipitation pH and solids separation)'}.`;
        break;
      }
      case 'Sulphide':
        why = pass
          ? 'Within limit.'
          : 'Residual sulfide from NaHS overdosing — dose closer to stoichiometric (1.1–1.3×), let ferric coagulant scavenge it (FeS + S⁰) or oxidise it in aeration. Below pH 8 much of it is toxic H₂S.';
        break;
      case 'CrVI':
        why = pass
          ? 'Within limit.'
          : has(sim, 'crReduction')
            ? `${effluent.CrVI.toFixed(3)} mg/L Cr(VI) remains: reduction is incomplete — lower the reduction pH (2–2.5), raise the metabisulfite dose or the retention time.`
            : `${effluent.CrVI.toFixed(2)} mg/L hexavalent chromium passes straight through: chromate is an anion and does NOT precipitate as hydroxide. Reduce it to Cr(III) first (metabisulfite at pH 2–2.5).`;
        break;
      case 'CrIII':
        why = explainMetal('Cr', effluent, sim, pass);
        break;
      case 'T':
        why = pass ? 'Within limit.' : 'Effluent too warm — cooling required.';
        break;
      default:
        if ((METALS as readonly string[]).includes(param)) why = explainMetal(param as Metal, effluent, sim, pass);
    }
    checks.push({ param, label: STANDARDS.parameters[param].label, unit: STANDARDS.parameters[param].unit, value, limit, pass, why });
  }
  return { standard: std, version: STANDARDS.version, pass: checks.every((c) => c.pass), checks };
}
