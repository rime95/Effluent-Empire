// O&M contract: fixed monthly service fee + reimbursables. Ref: knowledge/operations/om_model.md
import { describe, expect, it } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { OM, Plant, WEEKS_PER_MONTH, contractFor, omFeeQuote, omMargin, operateWeek, plantPosts, recommendedMaintenance } from '../../src/game/operations';
import { founder, operatorCapacity } from '../../src/game/staff';
import { initialMarket } from '../../src/game/market';
import { migrate, repriceLegacyContract, useGame } from '../../src/game/store';

function refPlant(industry: 'plating' | 'food', seed0: number) {
  let e = generateEnquiry(seed0, 1, 0);
  for (let s = seed0 + 1; e.industry !== industry || e.standard !== 'B'; s++) e = generateEnquiry(s, 1, 0);
  const graph = linearGraph(REFERENCE[industry](e.trueStream));
  const sim = simulate(graph, e.trueStream);
  const quote = omFeeQuote({ capex: sim.capex, Q: e.trueStream.Q, std: 'B', reputation: 0, opexRMd: sim.opexRMd, graph });
  const plant: Plant = {
    id: 'p1', company: e.company, industry, standard: 'B', graph, trueStream: e.trueStream, seed: e.seed, capex: sim.capex, commissionedWeek: 1,
    contract: contractFor(quote, 1), condition: 100, maintenanceBudget: recommendedMaintenance(sim.capex), satisfaction: 75, fines: 0, breakdown: null, history: [], status: 'operating',
  };
  return { e, sim, quote, plant };
}

describe('O&M fee build-up', () => {
  it('margin on the cost base is 100–150 % (125 % at reputation 0)', () => {
    expect(omMargin(0)).toBeCloseTo(1.25, 6);
    expect(omMargin(50)).toBeCloseTo(1.5, 6);
    expect(omMargin(500)).toBe(1.5);
    expect(omMargin(-500)).toBe(1.0);
    const { quote } = refPlant('plating', 10);
    expect(quote.monthlyFee / quote.costBase - 1).toBeGreaterThanOrEqual(1.0 - 0.01);
    expect(quote.monthlyFee / quote.costBase - 1).toBeLessThanOrEqual(1.5 + 0.01);
  });

  it('components add up', () => {
    const { quote: q } = refPlant('food', 20);
    expect(q.costBase).toBeCloseTo(q.staffing + q.supervision + q.maintenance + q.lab + q.management, -1);
    expect(q.operatorFTE).toBeGreaterThanOrEqual(1.5); // activated-sludge plant: +0.5 post
  });

  it('a ~90–180 m³/d plating plant earns RM 15–30k/month fixed fee (was ≈ RM 13k/month all-in)', () => {
    const { quote, e } = refPlant('plating', 10);
    expect(e.trueStream.Q).toBeGreaterThan(50);
    expect(quote.monthlyFee).toBeGreaterThan(15_000);
    expect(quote.monthlyFee).toBeLessThan(30_000);
  });
});

describe('O&M contract cash flow', () => {
  it('reimbursables track market-price running costs at cost + handling', () => {
    const { plant } = refPlant('plating', 10);
    const m = { ...initialMarket(), chemicals: 1.6, electricity: 1.6, sludge: 1.6 };
    const h = operateWeek(plant, 2, m, true).plant.history[0];
    expect(h.reimbursed).toBeCloseTo(h.costs!.opex * (1 + OM.handling), 6);
    expect(h.costs!.opex).toBeGreaterThan(0);
  });

  it('stays profitable at market index 1.6 and flow ×1.3 (the client carries price and flow risk)', () => {
    const { plant } = refPlant('plating', 10);
    const m = { ...initialMarket(), chemicals: 1.6, electricity: 1.6, sludge: 1.6 };
    // week 201 → flow factor capped at 1.3
    const o = operateWeek({ ...plant, commissionedWeek: 1, contract: contractFor(plant.contract!.quote, 150) }, 201, m, true);
    const h = o.plant.history[0];
    expect(h.flowFactor).toBeCloseTo(1.3, 6);
    expect(h.pass).toBe(true);
    // fee − (service costs + maintenance + chemicals at index 1.6) stays well positive; the client carries price and flow
    expect(o.cash).toBeGreaterThan(0.8 * (plant.contract!.monthlyFee - plant.contract!.quote.costBase) / WEEKS_PER_MONTH - h.costs!.repairs);
  });

  it('a staffed reference plant nets about the margin on the cost base over a year (before payroll)', () => {
    const { plant } = refPlant('plating', 10);
    let p = plant;
    let cash = 0;
    for (let w = 2; w < 54; w++) {
      const o = operateWeek(p, w, initialMarket(), true);
      p = o.plant;
      cash += o.cash;
    }
    const q = plant.contract!.quote;
    // fixed fee − (maintenance + CePIETSO + sampling; operators are payroll, management is overhead recovery) + handling
    const expected = 12 * (q.monthlyFee - (q.maintenance + q.supervision + q.lab) + (q.reimbursables - q.reimbursables / (1 + OM.handling)));
    expect(cash).toBeGreaterThan(0.75 * expected);
    expect(cash).toBeLessThan(1.15 * expected);
  });

  it('the fixed fee escalates on each contract anniversary', () => {
    const { plant } = refPlant('plating', 10);
    const f0 = plant.contract!.monthlyFee;
    const o = operateWeek(plant, 53, initialMarket(), true);
    expect(o.plant.contract!.monthlyFee).toBeCloseTo(f0 * (1 + OM.escalation), -1);
    expect(operateWeek(plant, 52, initialMarket(), true).plant.contract!.monthlyFee).toBe(f0);
  });

  it('no escalation in the contract\'s final week; plant service costs escalate with the fee', () => {
    const { plant } = refPlant('plating', 10);
    const c = contractFor(plant.contract!.quote, 1, 156);
    const last = operateWeek({ ...plant, contract: c }, 157, initialMarket(), true);
    expect(last.plant.history[0].fee).toBeCloseTo(c.monthlyFee / WEEKS_PER_MONTH, 6);
    const y2 = operateWeek({ ...plant, contract: c }, 53, initialMarket(), true).plant.history[0];
    const y1 = operateWeek({ ...plant, contract: c }, 52, initialMarket(), true).plant.history[0];
    expect(y2.costs!.service / y1.costs!.service).toBeCloseTo(1 + OM.escalation, 6);
  });

  it('a failed sample deducts 5 % of the monthly fee', () => {
    const { plant } = refPlant('plating', 10);
    // remove every treatment unit → the effluent fails
    const bare = { ...plant, graph: { ...plant.graph, nodes: plant.graph.nodes.map((n) => (n.kind === 'influent' || n.kind === 'discharge' ? n : { ...n, bypass: true })) } };
    const h = operateWeek(bare, 2, initialMarket(), true).plant.history[0];
    expect(h.pass).toBe(false);
    expect(h.deduction).toBeCloseTo(plant.contract!.monthlyFee * OM.deduction, 6);
  });

  it('SCADA field-action costs show in the plant week but are not charged twice', () => {
    const { plant } = refPlant('plating', 10);
    const a = operateWeek(plant, 2, initialMarket(), true);
    const b = operateWeek({ ...plant, actionCost: 1_200 }, 2, initialMarket(), true);
    expect(b.cash).toBeCloseTo(a.cash, 6);
    expect(b.plant.history[0].cost - a.plant.history[0].cost).toBeCloseTo(1_200, 6);
    expect(b.plant.actionCost).toBe(0);
  });
});

describe('operator staffing matches the fee', () => {
  const op = (id: string, level: 1 | 2 | 3) => ({ id, name: id, role: 'operator' as const, level, salaryMonthly: 3_000, hiredWeek: 1 });
  it('a plant is covered only when all the operator posts it is billed for are staffed', () => {
    const { plant } = refPlant('food', 20); // activated sludge → 1.5 posts
    expect(plantPosts(plant)).toBeGreaterThanOrEqual(1.5);
    const conditionAfter = (staff: ReturnType<typeof op>[]) => {
      useGame.setState({ plants: [{ ...plant, condition: 80 }], staff: [founder(), ...staff], cash: 1e6, week: 2, gameOver: false });
      useGame.getState().advanceWeek(1);
      return useGame.getState().plants[0].condition;
    };
    const one = conditionAfter([op('a', 1)]);
    const two = conditionAfter([op('a', 1), op('b', 1)]);
    expect(two - one).toBeCloseTo(OM.uncoveredWear, 6); // one operator is not enough for 1.5 posts
    expect(operatorCapacity([op('s', 3)])).toBe(1.5);
  });
});

describe('legacy lump-sum contracts', () => {
  it('are re-priced to fixed fee + reimbursables on load, keeping the term', () => {
    const { plant } = refPlant('plating', 10);
    const legacy = { ...plant, contract: { weeklyFee: 2_990, startWeek: 5, endWeek: 161 } } as unknown as Plant;
    const r = repriceLegacyContract(legacy, 0);
    expect(r.contract!.quote).toBeDefined();
    expect(r.contract!.monthlyFee).toBeGreaterThan(2_990 * WEEKS_PER_MONTH);
    expect(r.contract!.startWeek).toBe(5);
    expect(r.contract!.endWeek).toBe(161);
    const s = migrate({ version: 2, chem: 2, companyName: 'X', cash: 1, week: 10, reputation: 0, plants: [legacy] });
    expect(s!.plants[0].contract!.quote).toBeDefined();
  });
});
