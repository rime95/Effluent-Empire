import { describe, expect, it } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { OM, Plant, contractFor, counterCeiling, graphKey, omFeeQuote, operateWeek, recommendedMaintenance } from '../../src/game/operations';
import { initialMarket } from '../../src/game/market';
import { useGame } from '../../src/game/store';

// Ref: knowledge/operations/om_model.md ("Renewal", "Stable plants")
function refPlant(seed0 = 10, endWeek?: number): Plant {
  let e = generateEnquiry(seed0, 1, 0);
  for (let s = seed0 + 1; e.industry !== 'plating' || e.standard !== 'B'; s++) e = generateEnquiry(s, 1, 0);
  const graph = linearGraph(REFERENCE.plating(e.trueStream));
  const sim = simulate(graph, e.trueStream);
  const quote = omFeeQuote({ capex: sim.capex, Q: e.trueStream.Q, std: 'B', reputation: 0, opexRMd: sim.opexRMd, graph });
  const contract = contractFor(quote, 1);
  if (endWeek) contract.endWeek = endWeek;
  return {
    id: 'p1', company: e.company, industry: 'plating', standard: 'B', graph, trueStream: e.trueStream, seed: e.seed, capex: sim.capex, commissionedWeek: 1,
    contract, condition: 100, maintenanceBudget: recommendedMaintenance(sim.capex), satisfaction: 75, fines: 0, breakdown: null, history: [], status: 'operating',
  };
}

describe('O&M contract renewal', () => {
  it('a satisfied client offers to renew in the last 13 weeks, at the fee escalated one more year', () => {
    const p = refPlant(10, 30);
    expect(operateWeek(p, 30 - OM.renewalNoticeWeeks - 1, initialMarket(), true).plant.renewal ?? null).toBeNull();
    const o = operateWeek(p, 30 - OM.renewalNoticeWeeks, initialMarket(), true);
    expect(o.plant.renewal?.status).toBe('offered');
    expect(o.plant.renewal!.monthlyFee).toBe(Math.round((p.contract!.quote.monthlyFee * (1 + OM.escalation)) / 10) * 10);
    expect(o.messages.some((m) => /offers to renew/.test(m))).toBe(true);
  });

  it('an unsatisfied client does not offer (and says so once)', () => {
    const p = { ...refPlant(10, 30), satisfaction: OM.renewMinSatisfaction - 10 };
    const o = operateWeek(p, 20, initialMarket(), true);
    expect(o.plant.renewal ?? null).toBeNull();
    expect(o.plant.renewalRefusedWeek).toBe(20);
    expect(operateWeek(o.plant, 21, initialMarket(), true).messages.some((m) => /does not plan to renew/.test(m))).toBe(false);
  });

  it('accepted → a new contract period on the agreed fee; not answered → the contract expires', () => {
    const p = refPlant(10, 30);
    const offered = operateWeek(p, 20, initialMarket(), true).plant;
    const agreed: Plant = { ...offered, renewal: { ...offered.renewal!, status: 'accepted', agreedFee: offered.renewal!.monthlyFee } };
    const renewed = operateWeek(agreed, 30, initialMarket(), true).plant;
    expect(renewed.status).toBe('operating');
    expect(renewed.contract!.startWeek).toBe(30);
    expect(renewed.contract!.endWeek).toBe(30 + OM.contractWeeks);
    expect(renewed.contract!.monthlyFee).toBe(offered.renewal!.monthlyFee);
    expect(renewed.renewal ?? null).toBeNull();
    const lapsed = operateWeek(offered, 30, initialMarket(), true).plant;
    expect(lapsed.status).toBe('expired');
    expect(lapsed.contract).toBeNull();
  });

  it('counter-offer: accepted up to the ceiling (higher for a more satisfied client), one try only', () => {
    const base = operateWeek(refPlant(10, 30), 20, initialMarket(), true).plant;
    const happy = { ...base, satisfaction: 100 };
    const meh = { ...base, satisfaction: OM.renewMinSatisfaction };
    expect(counterCeiling(happy, base.renewal!)).toBeCloseTo(base.renewal!.monthlyFee * (1 + OM.counterMaxPremium), -1);
    expect(counterCeiling(meh, base.renewal!)).toBe(base.renewal!.monthlyFee);
    useGame.setState({ plants: [happy] });
    const fee = base.renewal!.monthlyFee;
    expect(useGame.getState().respondRenewal('p1', 'counter', Math.round(fee * 1.3)).text).toMatch(/rejected/);
    expect(useGame.getState().plants[0].renewal!.status).toBe('offered');
    expect(useGame.getState().respondRenewal('p1', 'counter', Math.round(fee * 1.1)).ok).toBe(false); // one counter only
    expect(useGame.getState().respondRenewal('p1', 'accept').ok).toBe(true);
    expect(useGame.getState().plants[0].renewal!.agreedFee).toBe(fee);
    useGame.setState({ plants: [happy] });
    useGame.getState().respondRenewal('p1', 'counter', Math.round(fee * 1.15));
    expect(useGame.getState().plants[0].renewal!.status).toBe('accepted');
    expect(useGame.getState().plants[0].renewal!.agreedFee).toBe(Math.round((fee * 1.15) / 10) * 10);
  });
});

describe('stable plants reuse their last full simulation', () => {
  it(`after ${OM.stableWeeks} compliant weeks on the same design, weeks are not re-simulated; costs stay consistent`, () => {
    let p = refPlant(10);
    const recs = [];
    for (let w = 2; w < 2 + OM.stableWeeks + 6; w++) {
      p = operateWeek(p, w, initialMarket(), true).plant;
      recs.push(p.history[p.history.length - 1]);
    }
    expect(recs.slice(0, OM.stableWeeks).every((h) => !h.stable)).toBe(true);
    expect(recs.slice(-4).every((h) => h.stable && h.pass)).toBe(true);
    // reused running cost matches the last full run within the flow growth (≤ 5 %)
    const full = recs[OM.stableWeeks - 1].costs!.opex;
    for (const h of recs.slice(-4)) expect(Math.abs(h.costs!.opex / full - 1)).toBeLessThan(OM.stableFlowStep + 0.01);
  });

  it('a design change, a failed sample or 5 % more production forces a full simulation again', () => {
    let p = refPlant(10);
    for (let w = 2; w < 2 + OM.stableWeeks + 2; w++) p = operateWeek(p, w, initialMarket(), true).plant;
    expect(p.history[p.history.length - 1].stable).toBe(true);
    // design change (e.g. an upgrade handed over)
    const changed = { ...p, graph: { ...p.graph, nodes: p.graph.nodes.map((n, i) => (i === 1 ? { ...n, params: { ...n.params, volume: Number(n.params.volume ?? 10) + 5 } } : n)) } };
    expect(graphKey(changed.graph)).not.toBe(graphKey(p.graph));
    expect(operateWeek(changed, 30, initialMarket(), true).plant.history.at(-1)!.stable).toBeFalsy();
    // production grown past the step (week far later → flow factor +5 % or more)
    expect(operateWeek(p, p.steady!.week + 40, initialMarket(), true).plant.history.at(-1)!.stable).toBeFalsy();
  });
});
