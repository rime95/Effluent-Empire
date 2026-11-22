/**
 * Segregated raw-wastewater streams: several inlets per plant, each treated on its own and then combined (or blended
 * raw — allowed, the chemistry decides). Ref: knowledge/processes/segregated_streams.md
 */
import { describe, it, expect } from 'vitest';
import { allInlets, cloneStream, emptyStream, mapInlets, totalInfluent } from '../../src/simulation/core/stream';
import { setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { ProcessGraph, linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { defaultParams } from '../../src/simulation/treatment/catalogue';
import { generateEnquiry } from '../../src/game/customers';
import { VARIANTS, referenceGraph } from '../../src/game/variants';
import { commissioningInfluent } from '../../src/game/project';
import { TECH_ORDER } from '../../src/game/tech';
import { useGame } from '../../src/game/store';
import { runDynamic } from '../../src/simulation/dynamic/plantDynamics';

const SEG = ['chromeSegregated', 'enSegregated', 'dragOut', 'foodHighStrength'];

function twoStreams() {
  const main = emptyStream(100);
  main.CT = 2e-3;
  main.dissolved.Ni = 10;
  const cr = emptyStream(10);
  cr.CT = 1e-3;
  cr.CrVI = 40;
  const s = setCbForPH(main, 6.5);
  s.side = [{ id: 'cr', label: 'Chrome rinse', stream: setCbForPH(cr, 3.5) }];
  return s;
}
const u = (k: Parameters<typeof defaultParams>[0], Q: number, over = {}) => ({ kind: k, params: { ...defaultParams(k, Q), ...over } });

describe('multi-inlet solver', () => {
  it('each inlet gets its own stream; influentQ and the plant mass balance use the total', () => {
    const s = twoStreams();
    const g: ProcessGraph = linearGraph([u('eq', 110), u('precipitation', 110, { targetPH: 9.5 })]);
    g.nodes.push({ id: 'in_cr', kind: 'influent', tag: 'RAW-CR', params: { source: 'cr' } }, { id: 'r', kind: 'crReduction', tag: 'CR-1', params: defaultParams('crReduction', 10) });
    g.edges.push({ id: 'a', from: 'in_cr', to: 'r' }, { id: 'b', from: 'r', to: 'u0' });
    const sim = simulate(g, s);
    expect(sim.ok).toBe(true);
    expect(sim.influentQ).toBeCloseTo(110, 6);
    expect(sim.effluent!.Q).toBeCloseTo(110, 3);
    expect(sim.balance?.ok).toBe(true);
    expect(sim.effluent!.CrVI).toBeLessThan(0.05);
    expect(sim.edges['a'].CrVI).toBeCloseTo(40, 6);
    expect(sim.edges['e0'].CrVI).toBe(0);
  });

  it('blending the raw streams is allowed and simply simulated', () => {
    const s = twoStreams();
    const g = linearGraph([u('eq', 110), u('crReduction', 110), u('precipitation', 110, { targetPH: 9.5 })]);
    g.nodes.push({ id: 'in_cr', kind: 'influent', tag: 'RAW-CR', params: { source: 'cr' } });
    g.edges.push({ id: 'a', from: 'in_cr', to: 'u0' });
    const sim = simulate(g, s);
    expect(sim.ok).toBe(true);
    expect(sim.errors.filter((e) => e.level === 'error')).toEqual([]);
    expect(sim.effluent!.CrVI).toBeLessThan(0.05);
  });

  it('a missing, unpiped or foreign side inlet is an error', () => {
    const s = twoStreams();
    const g = linearGraph([u('eq', 110)]);
    expect(simulate(g, s).errors.some((e) => e.code === 'graph.sideMissing')).toBe(true);
    g.nodes.push({ id: 'in_cr', kind: 'influent', tag: 'RAW-CR', params: { source: 'cr' } });
    expect(simulate(g, s).errors.some((e) => e.code === 'graph.noOutlet')).toBe(true);
    g.nodes.push({ id: 'in_x', kind: 'influent', tag: 'RAW-X', params: { source: 'x' } });
    g.edges.push({ id: 'a', from: 'in_cr', to: 'u0' }, { id: 'b', from: 'in_x', to: 'u0' });
    expect(simulate(g, s).errors.some((e) => e.code === 'graph.sideUnknown')).toBe(true);
  });

  it('a single-stream influent is unchanged by the inlet helpers', () => {
    const s = twoStreams();
    delete s.side;
    expect(allInlets(s)).toHaveLength(1);
    expect(totalInfluent(s).Q).toBe(100);
    expect(commissioningInfluent(s, 5)).toEqual(commissioningInfluent(cloneStream(s), 5));
  });

  it('commissioning variability and flow scaling reach every inlet', () => {
    const s = twoStreams();
    const c = commissioningInfluent(s, 7);
    expect(c.side?.[0].stream.CrVI).toBeCloseTo(40, 6); // CrVI is not varied, but the stream is carried and re-equilibrated
    expect(c.side?.[0].stream.pH).not.toBe(s.side![0].stream.pH);
    expect(mapInlets(s, (x) => ({ ...x, Q: x.Q * 2 })).side?.[0].stream.Q).toBe(20);
  });
});

describe('segregated-stream clients', () => {
  const find = (id: string, n: number) => {
    const out = [];
    for (let seed = 1; out.length < n && seed < 6000; seed++) {
      const e = generateEnquiry(seed, 1, 50, { tech: TECH_ORDER });
      if (e.variant?.id === id) out.push(e);
    }
    return out;
  };
  for (const id of SEG)
    it(`${id}: carries its side stream, and the treat-then-combine reference passes the standard`, () => {
      const v = VARIANTS.find((x) => x.id === id)!;
      const jobs = find(id, 5);
      expect(jobs.length).toBe(5);
      for (const e of jobs) {
        expect(e.trueStream.side?.length).toBe(1);
        const sim = simulate(referenceGraph(v, e.trueStream), e.trueStream);
        expect(sim.ok).toBe(true);
        expect(sim.balance?.ok).toBe(true);
        const rep = evaluate(sim.effluent!, e.standard, sim);
        expect(rep.checks.filter((c) => !c.pass).map((c) => `${c.label} ${c.value.toFixed(2)}`)).toEqual([]);
      }
    });

  it('SCADA replay: the EQ pumps out the total inflow (side streams included) — no overflow, compliant', () => {
    for (const id of SEG) {
      const v = VARIANTS.find((x) => x.id === id)!;
      const [e] = find(id, 1);
      const r = runDynamic(referenceGraph(v, e.trueStream), e.trueStream, e.standard, { hours: 48, disturbances: [] });
      expect(r.overflowM3).toBeLessThan(0.5);
      expect(r.compliantFraction).toBeGreaterThan(0.95);
    }
  });

  it('the base enquiry of a seed is unchanged by a segregated variant (main-stream draws)', () => {
    for (let seed = 1; seed < 150; seed++) {
      const a = generateEnquiry(seed, 1, 50);
      const b = generateEnquiry(seed, 1, 50, { tech: TECH_ORDER });
      if (!b.variant || !SEG.includes(b.variant.id)) continue;
      expect(b.industry).toBe(a.industry);
      expect(b.deadlineWeeks).toBe(a.deadlineWeeks);
    }
  });
});

describe('segregated project: lab sample points and the starter drawing', () => {
  it('a test on a side stream updates only that stream; the drawing starts with one inlet per stream', () => {
    const g = useGame.getState();
    g.newGame('Seg Test Co');
    useGame.getState().setDevMode(true);
    useGame.getState().dev({ kind: 'reputation', value: 20 });
    useGame.getState().dev({ kind: 'cash', amount: 1e6 });
    useGame.getState().dev({ kind: 'spawn', force: { variantId: 'chromeSegregated' } });
    const e = useGame.getState().enquiries[0];
    expect(e.declaredSide?.cr).toBeDefined();
    useGame.getState().accept(e.id);
    let p = useGame.getState().projects.find((x) => x.id === e.id)!;
    expect(p.graph.nodes.filter((n) => n.kind === 'influent').map((n) => n.params.source ?? 'main')).toEqual(['main', 'cr']);
    const mainBefore = structuredClone(p.datasheet);
    useGame.getState().runTest('metals', 'cr');
    useGame.getState().advanceWeek(3);
    p = useGame.getState().projects.find((x) => x.id === e.id)!;
    expect(p.sideTestsDone?.cr).toContain('metals');
    expect(p.testsDone).not.toContain('metals');
    expect(p.datasheet).toEqual(mainBefore);
    expect(p.sideDatasheets!.cr.CrVI!).toBeCloseTo(e.trueStream.side![0].stream.CrVI, -0.5);
  });
});
