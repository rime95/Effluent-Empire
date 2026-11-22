/** Liquid scheduled-waste haulage (disposal point in liquid mode). Ref: knowledge/physical/sludge_thickening_dewatering.md */
import { describe, it, expect } from 'vitest';
import { generateEnquiry } from '../../src/game/customers';
import { PEdge, PNode, ProcessGraph, simulate } from '../../src/simulation/treatment/graph';
import { PRICES, defaultParams, UnitType } from '../../src/simulation/treatment/catalogue';

function plating() {
  let e = generateEnquiry(11, 1, 0);
  for (let s = 12; e.industry !== 'plating'; s++) e = generateEnquiry(s, 1, 0);
  return e.trueStream;
}
const inf = plating();
const unit = (id: string, kind: UnitType, over: Record<string, number | string> = {}): PNode => ({ id, kind, tag: id.toUpperCase(), params: { ...defaultParams(kind, inf.Q), ...over } });
const pipe = (from: string, to: string, fromPort?: PEdge['fromPort']): PEdge => ({ id: `${from}-${to}-${fromPort ?? 'out'}`, from, to, fromPort });

/** raw → splitter: a small share straight to tanker haulage, the rest discharged untreated (a pure routing test). */
function haulPlant(sharePct: number, liquid = true): ProcessGraph {
  return {
    nodes: [
      { id: 'in', kind: 'influent', params: {} },
      unit('sp', 'splitter', { split: sharePct }),
      { id: 'lh', kind: 'disposal', tag: 'LH-01', params: liquid ? { liquid: 'yes' } : {} },
      { id: 'out', kind: 'discharge', params: {} },
    ],
    edges: [pipe('in', 'sp'), pipe('sp', 'lh', 'a'), pipe('sp', 'out', 'b')],
  };
}

describe('liquid waste haulage', () => {
  it('accepts a process line, charges per m³ (metal-bearing rate) and conserves mass', () => {
    const sim = simulate(haulPlant(5), inf);
    expect(sim.ok).toBe(true);
    const d = sim.disposal.find((x) => x.id === 'lh')!;
    expect(d.liquid).toBe(true);
    expect(d.m3d).toBeCloseTo(inf.Q * 0.05, 6);
    expect(d.metal).toBe(true); // plating rinse: Ni + Cu + Zn ≫ 5 mg/L
    expect(d.costRMd).toBeCloseTo(d.m3d! * PRICES.liquidHaul_m3.metal, 6);
    expect(sim.effluent!.Q).toBeCloseTo(inf.Q * 0.95, 6);
    expect(sim.balance?.ok).toBe(true);
  });

  it('warns when the volume is more than a tanker load a day', () => {
    const big = simulate(haulPlant(50), inf);
    expect(big.errors.some((e) => e.code === 'haul.volume')).toBe(true);
    const small = simulate(haulPlant(5), inf);
    expect(small.errors.some((e) => e.code === 'haul.volume')).toBe(inf.Q * 0.05 > PRICES.tanker_m3);
  });

  it('a normal sludge disposal point still refuses process water', () => {
    const sim = simulate(haulPlant(5, false), inf);
    expect(sim.ok).toBe(false);
    expect(sim.errors.some((e) => e.code === 'graph.disposalWater')).toBe(true);
  });
});
