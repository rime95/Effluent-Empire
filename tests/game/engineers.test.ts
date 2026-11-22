// Engineers on O&M: upgrades take an engineer, free engineers supervise plants (CePIETSO), fix incidents on site and
// cut the cost of wrong SCADA guesses. Ref: knowledge/operations/om_model.md ("Engineers")
import { describe, expect, it } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { OM, Plant, WEEKS_PER_MONTH, contractFor, omFeeQuote, operateWeek, recommendedMaintenance, weeklyServiceCost } from '../../src/game/operations';
import { initialMarket } from '../../src/game/market';
import { founder } from '../../src/game/staff';
import { engineersBusy, freeEngineers, supervisedPlantIds, useGame } from '../../src/game/store';
import { newProject } from '../../src/game/project';
import type { Incident } from '../../src/game/incidents';

function refPlant(id = 'p1'): Plant {
  let e = generateEnquiry(10, 1, 0);
  for (let s = 11; e.industry !== 'plating' || e.standard !== 'B'; s++) e = generateEnquiry(s, 1, 0);
  const graph = linearGraph(REFERENCE.plating(e.trueStream));
  const sim = simulate(graph, e.trueStream);
  return {
    id, company: e.company, industry: 'plating', standard: 'B', graph, trueStream: e.trueStream, seed: e.seed, capex: sim.capex, commissionedWeek: 1,
    contract: contractFor(omFeeQuote({ capex: sim.capex, Q: e.trueStream.Q, std: 'B', reputation: 0, opexRMd: sim.opexRMd, graph }), 1),
    condition: 100, maintenanceBudget: recommendedMaintenance(sim.capex), satisfaction: 75, fines: 0, breakdown: null, history: [], status: 'operating',
  };
}
const eng = (id: string) => ({ id, name: id, role: 'engineer' as const, level: 1 as const, salaryMonthly: 5_500, hiredWeek: 1 });
const probeIncident = (p: Plant): Incident => {
  const n = p.graph.nodes.find((x) => x.kind === 'precipitation')!;
  return { kind: 'probeDrift', unitId: n.id, tag: n.tag!, startWeek: 1, symptoms: ['x'], tried: [], magnitude: 0.6 };
};

describe('upgrades use an engineer', () => {
  it('an upgrade needs a free engineer and holds it until hand-over or discard', () => {
    const e = generateEnquiry(3, 1, 0);
    useGame.setState({ plants: [refPlant()], staff: [founder()], projects: [newProject(e, 1)], gameOver: false, toast: null });
    useGame.getState().startUpgrade('p1');
    expect(useGame.getState().plants[0].upgrade).toBeFalsy(); // the founder is on the project
    useGame.setState({ projects: [] });
    useGame.getState().startUpgrade('p1');
    expect(useGame.getState().plants[0].upgrade?.phase).toBe('draft');
    expect(engineersBusy(useGame.getState())).toBe(1);
    // the engineer is now busy: a new enquiry cannot be accepted
    useGame.setState({ enquiries: [e] });
    useGame.getState().accept(e.id);
    expect(useGame.getState().projects.length).toBe(0);
    useGame.getState().discardUpgrade('p1');
    expect(engineersBusy(useGame.getState())).toBe(0);
  });
});

describe('free engineers supervise plants', () => {
  it('each free engineer supervises up to 4 plants, in portfolio order', () => {
    const plants = Array.from({ length: 6 }, (_, i) => refPlant(`p${i}`));
    const s = { plants, projects: [], staff: [founder()] };
    expect(freeEngineers(s)).toBe(1);
    expect(supervisedPlantIds(s).size).toBe(OM.plantsPerEngineer);
    expect(supervisedPlantIds({ ...s, staff: [founder(), eng('e2')] }).size).toBe(6);
    expect(supervisedPlantIds({ ...s, staff: [] }).size).toBe(0);
  });

  it('an in-house CePIETSO saves the external supervision cost', () => {
    const p = refPlant();
    const q = p.contract!.quote;
    expect(weeklyServiceCost(q, 1, false) - weeklyServiceCost(q, 1, true)).toBeCloseTo(q.supervision / WEEKS_PER_MONTH, 6);
    const ext = operateWeek(p, 2, initialMarket(), true, false);
    const own = operateWeek(p, 2, initialMarket(), true, true);
    expect(own.cash - ext.cash).toBeCloseTo(q.supervision / WEEKS_PER_MONTH, 6);
    expect(own.plant.history[0].supervised).toBe(true);
  });

  it('the supervising engineer fixes incidents on site (uncovered plant, no operator)', () => {
    const p: Plant = { ...refPlant(), incident: probeIncident(refPlant()) };
    let fixedBy = '';
    let pl = p;
    for (let w = 2; w < 20 && pl.incident; w++) {
      const o = operateWeek(pl, w, initialMarket(), false, true);
      if (!o.plant.incident) fixedBy = o.messages.find((m) => m.includes('supervising engineer')) ?? '';
      pl = o.plant;
    }
    expect(pl.incident).toBeNull();
    expect(fixedBy).toContain('supervising engineer');
    // without an engineer and without an operator the incident stays open
    let un = p;
    for (let w = 2; w < 20; w++) un = operateWeek(un, w, initialMarket(), false, false).plant;
    expect(un.incident).not.toBeNull();
  });

  it('a wrong SCADA guess costs half on an engineer-supervised plant', () => {
    const p: Plant = { ...refPlant(), incident: probeIncident(refPlant()) };
    useGame.setState({ plants: [p], staff: [founder()], projects: [], cash: 100_000, gameOver: false });
    const wrong = useGame.getState().resolveIncident('p1', 'divertEQ');
    expect(wrong.ok).toBe(false);
    expect(useGame.getState().cash).toBe(100_000 - 1_200 * OM.engineerWrongActionFactor);
    // the right action is charged in full
    const right = useGame.getState().resolveIncident('p1', 'recalibrate');
    expect(right.ok).toBe(true);
    expect(useGame.getState().cash).toBe(100_000 - 600 - 300);
  });
});
