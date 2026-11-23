// Balance tests: every industry is solvable, and no single train is universally optimal.
// Ref: knowledge/chemistry/precipitation.md, knowledge/biological/activated_sludge.md (reference trains)
import { createRng } from '../../src/game/rng';
import { INDUSTRIES, generateWastewater } from '../../src/game/industries';
import { defaultParams, UnitType, Params } from '../../src/simulation/treatment/catalogue';
import { metalTrain, foodTrain, REFERENCE } from '../../src/game/referenceDesigns';
import { linearGraph, simulate } from '../../src/simulation/treatment/graph';
import { evaluate } from '../../src/simulation/treatment/compliance';
import { Stream } from '../../src/simulation/core/stream';

const u = (kind: UnitType, Q: number, over: Params = {}) => ({ kind, params: { ...defaultParams(kind, Q), ...over } });

function run(stream: Stream, train: ReturnType<typeof metalTrain>) {
  const sim = simulate(linearGraph(train), stream);
  if (!sim.effluent) throw new Error(sim.errors.map((e) => e.text).join('; '));
  return { sim, rep: evaluate(sim.effluent, 'B', sim) };
}

const fails = (rep: ReturnType<typeof evaluate>) => rep.checks.filter((c) => !c.pass).map((c) => `${c.param}=${c.value.toFixed(2)}: ${c.why}`);

describe('reference trains', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`plating seed ${seed}: metal train passes Standard B, every unit mass-balanced`, () => {
      const ww = generateWastewater(INDUSTRIES.plating, createRng(seed)).stream;
      const { sim, rep } = run(ww, metalTrain(ww.Q, ww.CrVI > 0.05, ww));
      expect(fails(rep)).toEqual([]);
      for (const n of Object.values(sim.nodes)) expect(n.balance.ok, `${n.node.kind} ${JSON.stringify(n.balance.errors)}`).toBe(true);
      expect(sim.balance?.ok).toBe(true);
    });
    it(`food seed ${seed}: biological train passes Standard B`, () => {
      const ww = generateWastewater(INDUSTRIES.food, createRng(seed)).stream;
      const { sim, rep } = run(ww, foodTrain(ww.Q));
      expect(fails(rep)).toEqual([]);
      for (const n of Object.values(sim.nodes)) expect(n.balance.ok, `${n.node.kind} ${JSON.stringify(n.balance.errors)}`).toBe(true);
    });
  }

  for (const seed of [1, 2, 3]) {
    it(`semiconductor seed ${seed}: reference train passes Standard B`, () => {
      const ww = generateWastewater(INDUSTRIES.semiconductor, createRng(seed)).stream;
      const { rep } = run(ww, REFERENCE.semiconductor(ww));
      expect(fails(rep)).toEqual([]);
    });
  }

  it('the food train fails plating wastewater on metals (biology does not remove dissolved metals)', () => {
    const ww = generateWastewater(INDUSTRIES.plating, createRng(7)).stream;
    const { rep } = run(ww, foodTrain(ww.Q));
    const failed = rep.checks.filter((c) => !c.pass).map((c) => c.param);
    expect(failed).toContain('Ni');
  });

  it('the metal train fails food wastewater on BOD/COD (no biological stage)', () => {
    const ww = generateWastewater(INDUSTRIES.food, createRng(7)).stream;
    const { rep } = run(ww, metalTrain(ww.Q));
    const failed = rep.checks.filter((c) => !c.pass).map((c) => c.param);
    expect(failed).toContain('BOD5');
    expect(failed).toContain('COD');
  });

  it('precipitation at pH 8 leaves dissolved nickel and the report says why', () => {
    const ww = generateWastewater(INDUSTRIES.plating, createRng(3)).stream;
    const train = metalTrain(ww.Q);
    train[1] = u('precipitation', ww.Q, { targetPH: 8.0 });
    train[2] = u('coagulation', ww.Q, { coagulant: 'ferric', dose: 75, pHset: 0 });
    const { rep } = run(ww, train);
    const ni = rep.checks.find((c) => c.param === 'Ni')!;
    expect(ni.pass).toBe(false);
    expect(ni.why).toMatch(/dissolved/);
  });

  it('activated sludge without a secondary clarifier fails on TSS', () => {
    const ww = generateWastewater(INDUSTRIES.food, createRng(2)).stream;
    const train = foodTrain(ww.Q).slice(0, 3); // oil separator, EQ, AS — no clarifier
    const { sim, rep } = run(ww, train);
    expect(rep.checks.find((c) => c.param === 'TSS')!.pass).toBe(false);
    expect(Object.values(sim.nodes).some((n) => n.result.notes.some((x) => x.code === 'as.noClarifier'))).toBe(true);
  });
});
