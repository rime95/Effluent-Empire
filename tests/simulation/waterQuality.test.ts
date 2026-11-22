/**
 * SCADA live view: display water-quality index and the replay's per-pipe data. Ref: knowledge/operations/scada.md
 */
import { describe, it, expect } from 'vitest';
import { emptyStream } from '../../src/simulation/core/stream';
import { setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { WQ_RAW_RATIO, waterQualityIndex } from '../../src/simulation/treatment/waterQuality';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { runDynamic } from '../../src/simulation/dynamic/plantDynamics';
import { metalTrain } from '../../src/game/referenceDesigns';
import { generateEnquiry } from '../../src/game/customers';

/** a plating job (the metal train treats it) */
const plating = () => {
  for (let seed = 1; ; seed++) {
    const e = generateEnquiry(seed, 1, 30);
    if (e.industry === 'plating') return e;
  }
};

describe('water-quality display index', () => {
  it('0 when every limit is met, 1 at raw strength, log scale in between', () => {
    const clean = setCbForPH(Object.assign(emptyStream(100), { CT: 2e-3, SS: 10, XS: 5 }), 7.5);
    expect(waterQualityIndex(clean, 'B')).toBe(0);
    const s = setCbForPH(Object.assign(emptyStream(100), { CT: 2e-3 }), 7.5);
    s.dissolved.Ni = 1 * WQ_RAW_RATIO; // 30 × the Std B limit (1 mg/L)
    expect(waterQualityIndex(s, 'B')).toBeCloseTo(1, 2);
    s.dissolved.Ni = Math.sqrt(WQ_RAW_RATIO); // √30 × limit → halfway
    expect(waterQualityIndex(s, 'B')).toBeCloseTo(0.5, 2);
    const acid = setCbForPH(Object.assign(emptyStream(100), { CT: 1e-3 }), 3);
    expect(waterQualityIndex(acid, 'B')).toBeGreaterThan(0.6);
    expect(waterQualityIndex(emptyStream(0), 'B')).toBe(0);
  });

  it('falls along a working metal train: raw > after precipitation > clarified > final', () => {
    const e = plating();
    const g = linearGraph(metalTrain(e.trueStream.Q, e.trueStream.CrVI > 0.05));
    const sim = simulate(g, e.trueStream);
    const wq = (from: string) => waterQualityIndex(sim.edges[g.edges.find((x) => x.from === from)!.id], e.standard);
    const kinds = (k: string) => g.nodes.find((n) => n.kind === k)!.id;
    const raw = wq('in');
    const prec = wq(kinds('precipitation'));
    const clar = wq(kinds('clarifier'));
    const fin = wq(kinds('neutralisation'));
    expect(raw).toBeGreaterThan(0.5);
    expect(prec).toBeGreaterThanOrEqual(clar);
    expect(raw).toBeGreaterThan(clar);
    expect(clar).toBeGreaterThanOrEqual(fin);
  });

  it('the 48 h replay reports flow and quality for every pipe at every step; the discharge pipe carries the effluent', () => {
    const e = plating();
    const g = linearGraph(metalTrain(e.trueStream.Q, e.trueStream.CrVI > 0.05));
    const r = runDynamic(g, e.trueStream, e.standard, { hours: 6, disturbances: [] });
    const toOut = g.edges.find((x) => x.to === 'out')!.id;
    for (const p of r.points) {
      expect(Object.keys(p.edges).sort()).toEqual(g.edges.map((x) => x.id).sort());
      expect(p.edges[toOut].Q).toBeCloseTo(p.effluent.Q, 6);
      for (const d of Object.values(p.edges)) expect(d.wq).toBeGreaterThanOrEqual(0);
    }
  });
});
