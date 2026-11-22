// Upgrades of operating plants as variation orders. Ref: knowledge/operations/om_model.md ("Upgrades")
import { describe, expect, it } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { REFERENCE } from '../../src/game/referenceDesigns';
import { ProcessGraph, linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { OM, Plant, contractFor, omFeeQuote, operateWeek, operatorFTE, recommendedMaintenance } from '../../src/game/operations';
import { RETROFIT_PREMIUM, changedUnits, retrofitCharge, unitRetrofitCharge } from '../../src/game/project';
import { completeUpgrade, upgradeQuote, VO_MARKUP } from '../../src/game/upgrade';
import { INSTRUMENTS } from '../../src/simulation/treatment/instrumentation';
import { initialMarket } from '../../src/game/market';
import { useGame } from '../../src/game/store';

function refPlant(industry: 'plating' | 'food', seed0: number): Plant {
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

const withInst = (g: ProcessGraph, kind: string, key: string, on: boolean): ProcessGraph => ({ ...g, nodes: g.nodes.map((n) => (n.kind === kind ? { ...n, inst: { ...n.inst, [key]: on } } : n)) });
const standbyCost = INSTRUMENTS.find((d) => d.key === 'standby')!.capexRM;

describe('upgrade pricing', () => {
  it('adding a standby pump charges the standby only (× rework premium), not the whole tank', () => {
    const p = refPlant('plating', 10);
    const draft = withInst(p.graph, 'precipitation', 'standby', true);
    const q = upgradeQuote(p, draft, 2);
    expect(q.changed.length).toBe(1);
    expect(q.cost).toBeCloseTo(standbyCost * RETROFIT_PREMIUM, -1);
    expect(q.weeks).toBe(2);
    expect(q.ok).toBe(true);
  });

  it('an instrument ticked on a retrofit is no longer free (sameNode now compares instruments)', () => {
    const p = refPlant('plating', 10);
    const draft = withInst(p.graph, 'precipitation', 'standby', true);
    const sim = simulate(draft, p.trueStream);
    expect(retrofitCharge(p.graph, draft, sim)).toBeGreaterThan(0);
    expect(changedUnits(p.graph, draft).length).toBe(1);
    // removing an instrument costs nothing
    const n = p.graph.nodes.find((x) => x.kind === 'precipitation')!;
    expect(unitRetrofitCharge(n, { ...n, inst: { pHLoop: false } }, 100_000)).toBe(0);
    // a resized unit is rebuilt
    expect(unitRetrofitCharge(n, { ...n, params: { ...n.params, volume: Number(n.params.volume) * 2 } }, 100_000)).toBeCloseTo(100_000 * RETROFIT_PREMIUM, 6);
  });

  it('an unchanged draft cannot be ordered', () => {
    const p = refPlant('plating', 10);
    const q = upgradeQuote(p, p.graph, 2);
    expect(q.ok).toBe(false);
    expect(q.cost).toBe(0);
  });
});

describe('who pays', () => {
  it('a cosmetic upgrade on a compliant plant with no incidents is operator-funded', () => {
    const p = refPlant('plating', 10);
    const q = upgradeQuote(p, withInst(p.graph, 'precipitation', 'standby', true), 2);
    expect(q.currentPass).toBe(true);
    expect(q.clientFunded).toBe(false);
    expect(q.price).toBe(0);
  });

  it('redundancy on a unit with a recent incident is a client-funded variation order', () => {
    const p = refPlant('plating', 10);
    const prec = p.graph.nodes.find((n) => n.kind === 'precipitation')!;
    const q = upgradeQuote({ ...p, incidentLog: [{ week: 5, unitId: prec.id }] }, withInst(p.graph, 'precipitation', 'standby', true), 10);
    expect(q.clientFunded).toBe(true);
    expect(q.price).toBeCloseTo(q.cost * VO_MARKUP, -1);
    // older than the 12-week look-back → operator-funded
    expect(upgradeQuote({ ...p, incidentLog: [{ week: 1, unitId: prec.id }] }, withInst(p.graph, 'precipitation', 'standby', true), 30).clientFunded).toBe(false);
  });

  // as-built clarifier far too small (hardware deficiency) → fails today; the draft restores the design area
  const undersized = (p: Plant): Plant => ({ ...p, graph: { ...p.graph, nodes: p.graph.nodes.map((n) => (n.kind === 'clarifier' ? { ...n, params: { ...n.params, area: Number(n.params.area) * 0.08 } } : n)) } });
  const failed = (n: number) => Array.from({ length: n }, (_, i) => ({ week: i + 1, pass: false, failed: ['Ni'], revenue: 0, cost: 0, condition: 100, flowFactor: 1 }));

  it('an upgrade that restores compliance after failed samples is a client-funded VO', () => {
    const p = refPlant('plating', 10);
    const broken = { ...undersized(p), history: failed(3) };
    const q = upgradeQuote(broken, p.graph, 5);
    expect(q.currentPass).toBe(false);
    expect(q.draftPass).toBe(true);
    expect(q.clientFunded).toBe(true);
    expect(q.clientUnits.length).toBe(1);
    expect(q.price).toBeCloseTo(q.clientCost * VO_MARKUP, -1);
    // without failed samples the client does not order works
    expect(upgradeQuote(undersized(p), p.graph, 5).clientFunded).toBe(false);
  });

  it('loophole: a detuned set-point does not make the client pay (and a set-point change is not works)', () => {
    const p = refPlant('plating', 10);
    const detuned: Plant = { ...p, history: failed(3), graph: { ...p.graph, nodes: p.graph.nodes.map((n) => (n.kind === 'neutralisation' ? { ...n, params: { ...n.params, targetPH: 11.5 } } : n)) } };
    const draft = withInst(p.graph, 'precipitation', 'standby', true);
    const q = upgradeQuote(detuned, draft, 5);
    expect(q.currentPass).toBe(true); // judged on the as-built hardware with the draft's set-points
    expect(q.clientFunded).toBe(false);
    // set-point only → nothing to build
    const sp = upgradeQuote(detuned, p.graph, 5);
    expect(sp.cost).toBe(0);
    expect(sp.ok).toBe(false);
  });

  it('loophole: unrelated works do not ride on a VO — only the in-scope units are client-paid', () => {
    const p = refPlant('plating', 10);
    const prec = p.graph.nodes.find((n) => n.kind === 'precipitation')!;
    const withIncident: Plant = { ...p, incidentLog: [{ week: 4, unitId: prec.id, kind: 'pumpTrip' }] };
    // standby on the tripped pump + an oversized EQ tank
    const draft = withInst({ ...p.graph, nodes: p.graph.nodes.map((n) => (n.kind === 'eq' ? { ...n, params: { ...n.params, volume: Number(n.params.volume) * 2 } } : n)) }, 'precipitation', 'standby', true);
    const q = upgradeQuote(withIncident, draft, 6);
    expect(q.clientFunded).toBe(true);
    expect(q.clientCost).toBeCloseTo(9_000 * RETROFIT_PREMIUM, -1);
    expect(q.cost).toBeGreaterThan(q.clientCost * 3);
    // an instrument that does not remedy the incident kind is not in scope
    const probe: Plant = { ...p, incidentLog: [{ week: 4, unitId: prec.id, kind: 'probeDrift' }] };
    expect(upgradeQuote(probe, withInst(p.graph, 'precipitation', 'standby', true), 6).clientFunded).toBe(false);
  });

  it('a used incident cannot fund a second VO; a standby-absorbed incident is not logged', () => {
    const p = refPlant('plating', 10);
    const prec = p.graph.nodes.find((n) => n.kind === 'precipitation')!;
    const used: Plant = { ...p, incidentLog: [{ week: 4, unitId: prec.id, kind: 'pumpTrip', used: true }] };
    expect(upgradeQuote(used, withInst(p.graph, 'precipitation', 'standby', true), 6).clientFunded).toBe(false);
  });

  it('removing a unit is an upgrade (no charge, takes time)', () => {
    const p = refPlant('plating', 10);
    const sf = p.graph.nodes.find((n) => n.kind === 'sandFilter')!;
    const ins = p.graph.edges.filter((e) => e.to === sf.id);
    const outs = p.graph.edges.filter((e) => e.from === sf.id);
    const draft = { nodes: p.graph.nodes.filter((n) => n.id !== sf.id), edges: [...p.graph.edges.filter((e) => e.from !== sf.id && e.to !== sf.id), { ...ins[0], id: 'x', to: outs[0].to }] };
    const q = upgradeQuote(p, draft, 2);
    expect(q.removed).toEqual([sf.tag]);
    expect(q.cost).toBe(0);
    expect(q.weeks).toBeGreaterThan(0);
  });
});

describe('hand-over', () => {
  it('the plant runs the upgraded graph; CAPEX, maintenance and the fixed fee follow', () => {
    const p = refPlant('plating', 10);
    const draft = withInst(p.graph, 'precipitation', 'standby', true);
    const q = upgradeQuote(p, draft, 2);
    const done = completeUpgrade({ ...p, upgrade: { graph: draft, phase: 'building', cost: q.cost, doneWeek: 4 } });
    expect(done.upgrade).toBeNull();
    expect(done.graph.nodes.find((n) => n.kind === 'precipitation')!.inst?.standby).toBe(true);
    // asset value = upgraded plant CAPEX (the 20 % rework premium is a sunk project cost)
    expect(done.capex).toBeCloseTo(simulate(draft, p.trueStream).capex, 6);
    expect(done.capex).toBeLessThan(p.capex + q.cost);
    expect(done.maintenanceBudget).toBeGreaterThanOrEqual(p.maintenanceBudget);
    // operator-funded works do not change the client's fee
    expect(done.contract!.monthlyFee).toBe(p.contract!.monthlyFee);
    const vo = completeUpgrade({ ...p, upgrade: { graph: draft, phase: 'building', cost: q.cost, clientFunded: true, price: 1, doneWeek: 4 } });
    expect(vo.contract!.monthlyFee).toBeGreaterThanOrEqual(p.contract!.monthlyFee);
  });

  it('after hand-over a dosing-pump trip changes over to the new standby automatically', () => {
    const p = refPlant('plating', 10);
    const done = completeUpgrade({ ...p, upgrade: { graph: withInst(p.graph, 'precipitation', 'standby', true), phase: 'building', cost: 10_000, doneWeek: 2 } });
    // operate until an incident on the precipitation unit's pump occurs; with standby it never stays active as a pump trip
    let pl = done;
    let changeovers = 0;
    OM.randomFailures = true; // the failure machinery is kept for a future opt-in setting
    for (let w = 2; w < 300 && changeovers === 0; w++) {
      const o = operateWeek({ ...pl, incident: null }, w, initialMarket(), true);
      if (o.messages.some((m) => m.includes('standby took over'))) changeovers++;
      pl = { ...o.plant, incident: null };
    }
    OM.randomFailures = false;
    expect(changeovers).toBeGreaterThan(0);
  });

  it('store: order the works, pay now, client pays the VO at hand-over', () => {
    const p = refPlant('plating', 10);
    const prec = p.graph.nodes.find((n) => n.kind === 'precipitation')!;
    useGame.setState({ plants: [{ ...p, incidentLog: [{ week: 1, unitId: prec.id }] }], cash: 500_000, week: 2, gameOver: false, studioPlantId: null });
    useGame.getState().startUpgrade('p1');
    expect(useGame.getState().plants[0].upgrade?.phase).toBe('draft');
    useGame.getState().setUpgradeGraph('p1', withInst(useGame.getState().plants[0].upgrade!.graph, 'precipitation', 'standby', true));
    const r = useGame.getState().submitUpgrade('p1');
    expect(r.ok).toBe(true);
    const u = useGame.getState().plants[0].upgrade!;
    expect(u.phase).toBe('building');
    expect(u.clientFunded).toBe(true);
    expect(useGame.getState().cash).toBeCloseTo(500_000 - u.cost!, 6);
    for (let i = 0; i < 3; i++) useGame.getState().advanceWeek(1);
    const after = useGame.getState();
    expect(after.plants[0].upgrade).toBeNull();
    expect(after.plants[0].graph.nodes.find((n) => n.id === prec.id)!.inst?.standby).toBe(true);
    expect(after.ledger.some((l) => l.label.startsWith('Variation order paid') && Math.abs(l.amount - u.price!) < 1)).toBe(true);
  });
});

describe('upgrade lifecycle edge cases (QA review)', () => {
  it('works cannot be ordered if the contract ends before hand-over', () => {
    const p = refPlant('plating', 10);
    useGame.setState({ plants: [{ ...p, contract: { ...p.contract!, endWeek: 3 } }], cash: 500_000, week: 2, gameOver: false });
    useGame.getState().startUpgrade('p1');
    useGame.getState().setUpgradeGraph('p1', withInst(useGame.getState().plants[0].upgrade!.graph, 'precipitation', 'standby', true));
    expect(useGame.getState().submitUpgrade('p1').ok).toBe(false);
    expect(useGame.getState().cash).toBe(500_000);
  });

  it('a new game does not inherit the Studio plant selection', () => {
    useGame.getState().openPlantStudio('p1');
    useGame.getState().newGame('Fresh Co');
    expect(useGame.getState().studioPlantId).toBeNull();
  });

  it('an unconnected activated-sludge block does not add operator time to the fee', () => {
    const p = refPlant('plating', 10);
    const loose = { ...p.graph, nodes: [...p.graph.nodes, { id: 'as-loose', kind: 'activatedSludge' as const, params: {} }] };
    expect(operatorFTE(p.trueStream.Q, loose)).toBe(operatorFTE(p.trueStream.Q, p.graph));
  });
});
