import { describe, expect, it } from 'vitest';
import { halfExtents, rotatePort, unitDims } from '../../src/ui/plant3d/dims';
import { overlaps, siteLayout } from '../../src/ui/plant3d/siteLayout';
import { CATALOGUE, UnitType, defaultParams } from '../../src/simulation/treatment/catalogue';
import { generateEnquiry, tierDesign } from '../../src/game/customers';
import { TECH_ORDER } from '../../src/game/tech';

// Ref: knowledge/ui/plant3d.md
describe('3D unit dimensions follow the design', () => {
  it('clarifier diameter keeps the designed surface area; depth from the depth parameter', () => {
    const d = unitDims({ kind: 'clarifier', params: { area: 50, depth: 4 } }, 500);
    expect(Math.PI * d.r! * d.r!).toBeCloseTo(50, 6);
    expect(d.h).toBe(4);
  });

  it('basins and reactors keep their volume within 5 %', () => {
    const as = unitDims({ kind: 'activatedSludge', params: { volume: 900 } }, 500);
    expect((as.w * as.d * 4.5) / 900).toBeCloseTo(1, 2);
    const ph = unitDims({ kind: 'neutralisation', params: { volume: 8 } }, 500);
    expect((Math.PI * ph.r! * ph.r! * ph.h) / 8).toBeGreaterThan(0.95);
    expect((Math.PI * ph.r! * ph.r! * ph.h) / 8).toBeLessThan(1.05);
  });

  it('a bigger design is a bigger tank', () => {
    expect(unitDims({ kind: 'eq', params: { volume: 400 } }, 100).w).toBeGreaterThan(unitDims({ kind: 'eq', params: { volume: 100 } }, 100).w);
  });

  it('every unit type, terminal and disposal variant has a shape and the ports it can use', () => {
    const kinds = [...(Object.keys(CATALOGUE) as UnitType[])];
    for (const k of kinds) {
      const d = unitDims({ kind: k, params: defaultParams(k, 200) }, 200);
      expect(d.w * d.d * d.h, k).toBeGreaterThan(0);
      const ids = d.ports.map((p) => p.id);
      expect(ids, k).toContain('in');
      if (k === 'splitter') expect(ids).toEqual(expect.arrayContaining(['a', 'b']));
      else expect(ids, k).toContain('out');
      if (['clarifier', 'thickener', 'daf', 'oilSep', 'sandFilter', 'mbr', 'filterPress', 'dryer', 'ro', 'uf', 'ionExchange', 'evaporator', 'aop'].includes(k)) expect(ids, k).toContain('sludge');
    }
    expect(unitDims({ kind: 'clarifier', params: { area: 20 } }, 100).ports.map((p) => p.id)).toContain('ras');
    expect(unitDims({ kind: 'influent', params: {} }, 100).ports.map((p) => p.id)).toEqual(['out']);
    expect(unitDims({ kind: 'discharge', params: {} }, 100).ports.map((p) => p.id)).toEqual(['in']);
    expect(unitDims({ kind: 'disposal', params: { reuse: 'yes' } }, 100).shape).toBe('reclaimTank');
    expect(unitDims({ kind: 'disposal', params: { liquid: 'yes' } }, 100).shape).toBe('tankerPad');
  });

  it('rotation turns ports and swaps footprint extents', () => {
    const r = rotatePort({ x: 2, z: 0 }, 90);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.z).toBeCloseTo(-2, 9);
    const d = unitDims({ kind: 'eq', params: { volume: 200 } }, 100);
    expect(halfExtents(d, 90)).toEqual({ hx: d.d / 2, hz: d.w / 2 });
  });
});

describe('default site plan', () => {
  it('no footprints overlap, even on the megaproject reference design', () => {
    const e = generateEnquiry(4, 0, 90, { tech: TECH_ORDER, force: { tier: 'mega' } });
    const g = tierDesign('mega', 'plating', e.trueStream, TECH_ORDER, 4).graph;
    const placed = siteLayout(g, e.trueStream.Q);
    expect(placed).toHaveLength(g.nodes.length);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j]), `${placed[i].node.tag} / ${placed[j].node.tag}`).toBe(false);
  });

  it('a unit placed in 3D keeps its site position and rotation', () => {
    const e = generateEnquiry(4, 0, 90, { tech: TECH_ORDER, force: { tier: 'mega' } });
    const g = tierDesign('mega', 'plating', e.trueStream, TECH_ORDER, 4).graph;
    g.nodes[2] = { ...g.nodes[2], site: { x: 120, z: -40, rot: 90 } };
    const p = siteLayout(g, e.trueStream.Q).find((x) => x.node.id === g.nodes[2].id)!;
    expect([p.x, p.z, p.rot, p.placed]).toEqual([120, -40, 90, true]);
  });
});
