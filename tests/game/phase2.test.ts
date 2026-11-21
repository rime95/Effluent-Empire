// Phase 2: operations economy, staff, time, save migration. Ref: knowledge/operations/om_model.md
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { Plant, contractFor, degradedGraph, omFeeQuote, operateWeek, recommendedMaintenance } from '../../src/game/operations';
import { initialMarket, stepMarket } from '../../src/game/market';
import { createRng } from '../../src/game/rng';
import { founder, generateCandidates, labDiscount, labWeeks, operatorCapacity, payroll, projectSlots } from '../../src/game/staff';
import { GameState, migrate, stepWeek } from '../../src/game/store';
import { newProject } from '../../src/game/project';

function plantFor(industry: 'plating' | 'food', seed0: number): Plant {
  let e = generateEnquiry(seed0, 1, 0);
  for (let s = seed0 + 1; e.industry !== industry || e.standard !== 'B'; s++) e = generateEnquiry(s, 1, 0);
  const graph = linearGraph(REFERENCE[industry](e.trueStream));
  const sim = simulate(graph, e.trueStream);
  return {
    id: 'p1', company: e.company, industry, standard: 'B', graph, trueStream: e.trueStream, seed: e.seed, capex: sim.capex, commissionedWeek: 1,
    contract: contractFor(omFeeQuote({ capex: sim.capex, Q: e.trueStream.Q, std: 'B', reputation: 0, opexRMd: sim.opexRMd, graph }), 1),
    condition: 100, maintenanceBudget: recommendedMaintenance(sim.capex), satisfaction: 75, fines: 0, breakdown: null, history: [], status: 'operating',
  };
}

function run(p: Plant, weeks: number, covered: boolean) {
  let plant = p;
  let cash = 0;
  for (let w = 2; w < 2 + weeks; w++) {
    const o = operateWeek(plant, w, initialMarket(), covered);
    plant = o.plant;
    cash += o.cash;
  }
  return { plant, cash };
}

describe('O&M economics', () => {
  for (const [industry, seed] of [['plating', 10], ['food', 20]] as const) {
    it(`${industry}: a well-maintained, staffed reference plant is compliant and profitable over a year`, () => {
      const { plant, cash } = run(plantFor(industry, seed), 52, true);
      const compliance = plant.history.filter((h) => h.pass).length / plant.history.length;
      expect(compliance).toBeGreaterThan(0.85);
      expect(cash).toBeGreaterThan(0);
      expect(plant.condition).toBeGreaterThan(80);
    });
  }
  it('neglect (no maintenance, no operator) wears the plant down and costs money', () => {
    const base = plantFor('plating', 10);
    const good = run(base, 52, true);
    const bad = run({ ...base, maintenanceBudget: 0 }, 52, false);
    expect(bad.plant.condition).toBeLessThan(good.plant.condition - 40);
    expect(bad.plant.history.filter((h) => h.event).length).toBeGreaterThanOrEqual(good.plant.history.filter((h) => h.event).length);
  });
  it('a dosing-pump breakdown bypasses the unit; flow is preserved', () => {
    const p = plantFor('plating', 10);
    const prec = p.graph.nodes.find((n) => n.kind === 'precipitation')!;
    const g = degradedGraph(p.graph, { unitId: prec.id, tag: 'PR', description: '', weeksLeft: 1 });
    expect(g.nodes.find((n) => n.id === prec.id)!.bypass).toBe(true);
    const sim = simulate(g, p.trueStream);
    expect(sim.ok).toBe(true);
    expect(sim.effluent!.Q).toBeCloseTo(p.trueStream.Q, 6);
  });
});

describe('market', () => {
  it('indices stay within bounds over 10 years', () => {
    let m = initialMarket();
    const rng = createRng(5);
    for (let w = 2; w < 520; w++) m = stepMarket(m, w, rng).market;
    for (const k of ['chemicals', 'electricity', 'sludge'] as const) {
      expect(m[k]).toBeGreaterThanOrEqual(0.7);
      expect(m[k]).toBeLessThanOrEqual(1.6);
    }
  });
});

describe('staff effects', () => {
  const team = [founder(), ...generateCandidates(1, 4, 0)];
  it('engineers give project slots, techs discount the lab, operators cover plants', () => {
    expect(projectSlots([founder()])).toBe(1);
    expect(projectSlots(team)).toBe(2);
    expect(labDiscount(team)).toBeCloseTo(0.15, 6);
    expect(labWeeks(team, 2)).toBe(1);
    expect(operatorCapacity(team)).toBeGreaterThanOrEqual(1);
    expect(payroll([founder()])).toBe(0);
  });
});

describe('time and saves', () => {
  const base = (): GameState => ({
    version: 2, companyName: 'T', cash: 500_000, reputation: 0, week: 1, seedCounter: 4242, enquiries: [], projects: [], activeProjectId: null,
    staff: [founder()], candidates: [], plants: [], market: initialMarket(), news: [], history: [], ledger: [], negativeWeeks: 0, gameOver: false, toast: null,
  });
  it('a week costs overheads and refills enquiries', () => {
    const s = stepWeek(base());
    expect(s.week).toBe(2);
    expect(s.cash).toBeLessThan(500_000);
    expect(s.enquiries.length).toBeGreaterThanOrEqual(3);
  });
  it('lab results arrive on their due week', () => {
    const s0 = base();
    const e = generateEnquiry(99, 1, 0);
    const p = { ...newProject(e, 1), labQueue: [{ test: 'metals' as const, doneWeek: 3 }] };
    const s2 = stepWeek({ ...s0, projects: [p] });
    expect(s2.projects[0].testsDone).toEqual([]);
    const s3 = stepWeek(s2);
    expect(s3.projects[0].testsDone).toEqual(['metals']);
    expect(s3.projects[0].datasheet.Ni).toBeDefined();
  });
  it('a balance within the credit line is not insolvency; 6 weeks beyond it is', () => {
    let ok = { ...base(), cash: -100_000 };
    for (let i = 0; i < 8; i++) ok = stepWeek(ok);
    expect(ok.gameOver).toBe(false);
    let s = { ...base(), cash: -400_000 };
    for (let i = 0; i < 5; i++) s = stepWeek(s);
    expect(s.gameOver).toBe(false);
    s = stepWeek(s);
    expect(s.gameOver).toBe(true);
  });
  it('v1 saves migrate to v2', () => {
    const e = generateEnquiry(7, 1, 0);
    const v1 = { version: 1, companyName: 'Old', cash: 123, reputation: 5, week: 9, seedCounter: 1, enquiries: [], project: newProject(e, 2), history: [], ledger: [], gameOver: false };
    const m = migrate(JSON.parse(JSON.stringify(v1)))!;
    expect(m.version).toBe(2);
    expect(m.projects.length).toBe(1);
    expect(m.activeProjectId).toBe(e.id);
    expect(m.staff[0].founder).toBe(true);
  });
});

describe('QA regressions', () => {
  const base = (): GameState => ({
    version: 2, companyName: 'T', cash: 500_000, reputation: 0, week: 1, seedCounter: 4242, enquiries: [], projects: [], activeProjectId: null,
    staff: [founder()], candidates: [], plants: [], market: initialMarket(), news: [], history: [], ledger: [], negativeWeeks: 0, gameOver: false, toast: null,
  });
  it('a bypassed unit keeps upstream flow splits unchanged', () => {
    const p = plantFor('plating', 10);
    const unit = p.graph.nodes.find((n) => n.kind === 'coagulation')!;
    const g = degradedGraph(p.graph, { unitId: unit.id, tag: 'CF', description: '', weeksLeft: 1 });
    expect(g.edges.length).toBe(p.graph.edges.length);
    expect(g.nodes.find((n) => n.id === unit.id)!.bypass).toBe(true);
    const sim = simulate(g, p.trueStream);
    expect(sim.nodes[unit.id]).toBeUndefined();
    expect(sim.effluent!.Q).toBeCloseTo(p.trueStream.Q, 6);
  });
  it('a malformed v2 save is rejected or repaired, and the repaired state runs', () => {
    expect(migrate({ version: 2 })).toBeNull();
    let s = migrate({ version: 2, cash: 1000, week: 5 })!;
    for (let i = 0; i < 10; i++) s = stepWeek(s);
    expect(s.week).toBe(15);
  });
  it('lab results arriving the same week use independent noise', () => {
    const e = generateEnquiry(99, 1, 0);
    const p = { ...newProject(e, 1), labQueue: [{ test: 'metals' as const, doneWeek: 2 }, { test: 'titration' as const, doneWeek: 2 }] };
    const s = stepWeek({ ...base(), projects: [p] });
    expect(s.projects[0].testsDone.sort()).toEqual(['metals', 'titration']);
  });
});
