import { describe, expect, it } from 'vitest';
import { AXIS_GROUPS, axisDomain, clockLabel, groupByUnit, niceTicks, tickLabel, timeTick } from '../../src/ui/components/trendScale';

const labels = (lo: number, hi: number) => {
  const a = niceTicks(lo, hi);
  return a.ticks.map((t) => tickLabel(t, a.decimals));
};

describe('SCADA trend axes (knowledge/operations/scada.md)', () => {
  it('a pH held at 9.5 ± 0.001 is drawn on at least a 1-pH-unit axis, not stretched to full height', () => {
    const vals = Array.from({ length: 192 }, (_, i) => 9.5 + 0.001 * Math.sin(i / 5));
    const ax = axisDomain(vals, AXIS_GROUPS.pH, [9.5]);
    expect(ax.domain[1] - ax.domain[0]).toBeGreaterThanOrEqual(1);
    expect(ax.domain[0]).toBeLessThan(9.5);
    expect(ax.domain[1]).toBeGreaterThan(9.5);
    // the noise is < 0.2 % of the axis: the line reads as flat
    expect(0.002 / (ax.domain[1] - ax.domain[0])).toBeLessThan(0.005);
  });

  it('tick labels never repeat (the old "9.5 9.5 9.5" bug)', () => {
    for (const [lo, hi] of [
      [9.4993, 9.5008],
      [9, 10],
      [0.0004, 0.0009],
      [48.12, 48.14],
      [0, 3200],
      [2.9, 3.05],
    ]) {
      const l = labels(lo, hi);
      expect(new Set(l).size).toBe(l.length);
    }
  });

  it('decimals follow the tick step', () => {
    expect(niceTicks(9, 10).decimals).toBe(1); // step 0.2
    expect(niceTicks(0, 3000).decimals).toBe(0);
    expect(niceTicks(0, 0.01).decimals).toBe(3);
  });

  it('set-point and discharge limit are always inside the axis', () => {
    const ax = axisDomain([9.5, 9.6], AXIS_GROUPS.pH, [6, 9]);
    expect(ax.domain[0]).toBeLessThanOrEqual(6);
    expect(ax.domain[1]).toBeGreaterThanOrEqual(9.6);
    const ni = axisDomain([0.05, 0.06], AXIS_GROUPS.conc, [1]);
    expect(ni.domain[1]).toBeGreaterThanOrEqual(1);
    expect(ni.domain[0]).toBeGreaterThanOrEqual(0);
  });

  it('axes stay inside physical bounds (pH 0–14, % 0–100, concentrations ≥ 0)', () => {
    const pct = axisDomain([99.5, 100], AXIS_GROUPS.pct);
    expect(pct.domain[1]).toBeLessThanOrEqual(100);
    expect(pct.domain[1] - pct.domain[0]).toBeGreaterThanOrEqual(20);
    expect(axisDomain([0, 0.0001], AXIS_GROUPS.conc).domain[0]).toBe(0);
  });

  it('pH (true) and pH (probe) share one axis; the pump goes on the second axis; a third quantity is reported, not hidden on a secret scale', () => {
    const g = groupByUnit(['pH', 'pHmeasured', 'pump', 'TSS']);
    expect(g.left?.tags).toEqual(['pH', 'pHmeasured']);
    expect(g.right?.tags).toEqual(['pump']);
    expect(g.dropped).toEqual(['TSS']);
    expect(groupByUnit(['DO', 'MLSS']).right?.group.id).toBe('MLSS'); // same unit, different magnitude → own axis
  });

  it('replay clock labels', () => {
    expect(clockLabel(0)).toBe('D1 00:00');
    expect(clockLabel(6.25)).toBe('D1 06:15');
    expect(clockLabel(30.25)).toBe('D2 06:15');
    expect(clockLabel(47.99)).toBe('D2 23:59');
    expect(clockLabel(48)).toBe('D2 24:00');
    expect(timeTick(0)).toBe('D1');
    expect(timeTick(24)).toBe('D2');
    expect(timeTick(30)).toBe('06');
    expect(timeTick(48)).toBe('24h');
  });
});
