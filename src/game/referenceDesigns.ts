/**
 * Reference ("competent engineer") designs per industry. Used to (1) price tenders — the market price of a
 * design-and-build contract is roughly what a competent design costs plus margin — and (2) prove in tests that
 * every industry is solvable. They are not shown to the player.
 * Ref: knowledge/chemistry/precipitation.md, knowledge/biological/activated_sludge.md (reference trains)
 */
import { CATALOGUE, Params, UnitType, defaultParams } from '../simulation/treatment/catalogue';
import { ProcessGraph, linearGraph } from '../simulation/treatment/graph';
import { IndustryId } from './industries';
import { Stream } from '../simulation/core/stream';
import { optimumMetalDose_mmol } from '../simulation/chemistry/coagulation';
import { MW } from '../simulation/core/units';

export type TrainSpec = { kind: UnitType; params: Params }[];

/**
 * A linear train with a sludge line: the sludge port of main unit `fromIdx` feeds the sludge units in series, the last
 * one to a disposal point; each sludge unit's filtrate / supernatant / condensate returns to the head of the works (u0).
 */
export function sludgeLineGraph(train: TrainSpec, fromIdx: number, sludge: TrainSpec): ProcessGraph {
  const g = linearGraph(train);
  sludge.forEach((s, i) => g.nodes.push({ id: `s${i}`, kind: s.kind, tag: `${CATALOGUE[s.kind].tagPrefix}-S${i + 1}`, params: s.params }));
  g.nodes.push({ id: 'sd', kind: 'disposal', tag: 'SD-01', params: {} });
  const ids = [`u${fromIdx}`, ...sludge.map((_, i) => `s${i}`), 'sd'];
  for (let i = 0; i < ids.length - 1; i++) g.edges.push({ id: `sl${i}`, from: ids[i], to: ids[i + 1], fromPort: 'sludge' });
  sludge.forEach((_, i) => g.edges.push({ id: `rt${i}`, from: `s${i}`, to: 'u0' }));
  return g;
}

const u = (kind: UnitType, Q: number, over: Params = {}) => ({ kind, params: { ...defaultParams(kind, Q), ...over } });

export const metalTrain = (Q: number, crVI = false): TrainSpec => [
  u('eq', Q),
  ...(crVI ? [u('crReduction', Q)] : []),
  u('precipitation', Q, { targetPH: 9.8 }),
  u('coagulation', Q, { coagulant: 'ferric', dose: 75, pHset: 9.8 }),
  u('clarifier', Q, { area: Math.ceil(Q / 24 / 0.7) }),
  u('sandFilter', Q),
  u('neutralisation', Q, { targetPH: 7.5 }),
];

/**
 * Emulsified-oil food plant (DAF variant): EQ → emulsion breaking (ferric at the jar-test optimum × 1.1, pH-trimmed,
 * polymer) → DAF → activated sludge.
 */
export const dafFoodTrain = (s: Stream): TrainSpec => {
  const Q = s.Q;
  const ferric = Math.ceil((optimumMetalDose_mmol(s, 'ferric') * MW.FeCl3 * 1.1) / 10) * 10;
  return [
  u('eq', Q),
  u('coagulation', Q, { coagulant: 'ferric', dose: ferric, pHset: 7, polymer: 1 }),
  // after EQ the peak factor is ~1.3: HLR (peak feed + 60 % recycle) ≈ 8 m/h
  u('daf', Q, { area: Math.max(1, Math.ceil(((Q * 1.3 + Q * 0.6) / 24 / 8) * 2) / 2), recycle: 60, pressure: 550 }),
  // ferric emulsion breaking consumes alkalinity: hold the aeration tank at pH 7 so nitrification is not lost
  u('activatedSludge', Q, { volume: Math.ceil(Q * 3.5), srt: 15, control: 'srt', alkPH: 7, alkReagent: 'NaOH' }),
  u('clarifier', Q, { area: Math.ceil(Q / 24 / 0.4) }),
  u('sandFilter', Q),
  ];
};

/**
 * Electroless-nickel plater (sulfide variant): hydroxide precipitation, then NaHS at 1.25× the sulfide demand of the
 * metal still in solution (complexed + residual free), ferric + polymer to catch the colloidal sulfide.
 */
export const sulfideMetalTrain = (s: Stream): TrainSpec => {
  const Q = s.Q;
  const cxMol = (['Ni', 'Cu', 'Zn'] as const).reduce((a, m) => a + (s.complexed?.[m] ?? 0) / MW[m] / 1000, 0);
  const nahs = Math.max(5, Math.ceil((cxMol + 0.02e-3) * 56.06 * 1000 * 1.3));
  return [
    u('eq', Q),
    ...(s.CrVI > 0.05 ? [u('crReduction', Q)] : []),
    u('precipitation', Q, { targetPH: 9.8 }),
    u('sulfide', Q, { dose: nahs, volume: Math.max(1, Math.ceil(Q / 48)) }),
    u('coagulation', Q, { coagulant: 'ferric', dose: 75, pHset: 9.8, polymer: 1 }),
    u('clarifier', Q, { area: Math.ceil(Q / 24 / 0.7) }),
    u('sandFilter', Q),
    u('neutralisation', Q, { targetPH: 7.5 }),
  ];
};

/**
 * Reuse plant: the treated effluent is split, the reuse share goes through UF + RO, permeate to the reclaim system;
 * RO brine and UF backwash blend with the rest at the discharge.
 */
export function reuseGraph(train: TrainSpec, Q: number, splitPct: number): ProcessGraph {
  // activated carbon first: RO brine concentrates the residual COD ~4×, so it must be low before the split
  const g = linearGraph([...train, u('carbon', Q), u('splitter', Q, { split: splitPct }), u('uf', Q * splitPct / 100), u('ro', Q, { recovery: 75, antiscalant: 'yes' }), u('mixer', Q), u('neutralisation', Q, { targetPH: 7.5 })]);
  const id = (k: string) => g.nodes.find((x) => x.kind === k)!.id;
  const sp = id('splitter'), uf = id('uf'), ro = id('ro'), mx = id('mixer');
  g.edges = g.edges.filter((e) => e.from !== sp && e.from !== ro);
  g.nodes.push({ id: 'rw', kind: 'disposal', tag: 'RW-01', params: { reuse: 'yes' } });
  g.edges.push(
    { id: 'ra', from: sp, to: uf, fromPort: 'a' },
    { id: 'rb', from: sp, to: mx, fromPort: 'b' },
    { id: 'rp', from: ro, to: 'rw' },
    { id: 'rbr', from: ro, to: mx, fromPort: 'sludge' },
    { id: 'rbw', from: uf, to: mx, fromPort: 'sludge' },
  );
  return g;
}

/**
 * Zero-liquid-discharge plant: treated effluent → UF → RO → permeate to reclaim; brine → pH 6 → MVR evaporator →
 * distillate to reclaim, concentrate tankered as liquid waste; UF backwash back to the head of the works.
 */
export function zldGraph(train: TrainSpec, Q: number): ProcessGraph {
  const g = linearGraph([...train, u('uf', Q), u('ro', Q, { recovery: 75, antiscalant: 'yes' })]);
  const id = (k: string) => g.nodes.find((x) => x.kind === k)!.id;
  const uf = id('uf'), ro = id('ro');
  g.edges = g.edges.filter((e) => e.from !== ro);
  g.nodes.push(
    { id: 'zn', kind: 'neutralisation', tag: 'NT-Z1', params: { ...defaultParams('neutralisation', Q * 0.25), targetPH: 6.0 } },
    { id: 'ev', kind: 'evaporator', tag: 'EV-01', params: { ...defaultParams('evaporator', Q * 0.25), recovery: 97 } },
    { id: 'rw', kind: 'disposal', tag: 'RW-01', params: { reuse: 'yes' } },
    { id: 'lh', kind: 'disposal', tag: 'LH-01', params: { liquid: 'yes' } },
  );
  g.edges.push(
    { id: 'zp', from: ro, to: 'rw' },
    { id: 'zb', from: ro, to: 'zn', fromPort: 'sludge' },
    { id: 'zn1', from: 'zn', to: 'ev' },
    { id: 'zd', from: 'ev', to: 'rw' },
    { id: 'zc', from: 'ev', to: 'lh', fromPort: 'sludge' },
    { id: 'zbw', from: uf, to: 'u0', fromPort: 'sludge' },
  );
  return g;
}

/** A segregated stream's own pretreatment train and the main-train unit it joins once treated. */
export interface SideTrain {
  /** SideStream id (Stream.side[].id) */
  id: string;
  /** tag suffix, e.g. EN → inlet RAW-EN, units CR-EN1… */
  tag: string;
  train: TrainSpec;
  /** kind of the main-train unit the treated side stream joins (first of that kind) */
  join: UnitType;
}

/**
 * Segregated-stream plant: the main train, plus one inlet per side stream (params.source = id) → its own pretreatment
 * → joins the main train at `join`. Ref: knowledge/processes/segregated_streams.md
 */
export function segregatedGraph(train: TrainSpec, sides: SideTrain[]): ProcessGraph {
  const g = linearGraph(train);
  for (const sd of sides) {
    const inId = `in_${sd.id}`;
    g.nodes.push({ id: inId, kind: 'influent', tag: `RAW-${sd.tag}`, params: { source: sd.id } });
    let prev = inId;
    sd.train.forEach((x, i) => {
      const id = `${sd.id}${i}`;
      g.nodes.push({ id, kind: x.kind, tag: `${CATALOGUE[x.kind].tagPrefix}-${sd.tag}${i + 1}`, params: x.params });
      g.edges.push({ id: `e_${id}`, from: prev, to: id });
      prev = id;
    });
    const j = train.findIndex((t) => t.kind === sd.join);
    g.edges.push({ id: `j_${sd.id}`, from: prev, to: `u${Math.max(0, j)}` });
  }
  return g;
}

export const foodTrain = (Q: number): TrainSpec => [
  u('oilSep', Q, { area: Math.ceil((Q * 2.2) / 24 / 1.0) }),
  u('eq', Q),
  u('activatedSludge', Q, { volume: Math.ceil(Q * 3.0), srt: 10, control: 'srt' }),
  u('clarifier', Q, { area: Math.ceil(Q / 24 / 0.4) }),
  u('sandFilter', Q),
];

export const semiconductorTrain = (Q: number): TrainSpec => [
  u('eq', Q),
  u('precipitation', Q, { targetPH: 9.5 }),
  u('coagulation', Q, { coagulant: 'ferric', dose: 120, pHset: 9.5 }),
  u('clarifier', Q, { area: Math.ceil(Q / 24 / 0.7) }),
  u('sandFilter', Q),
  u('neutralisation', Q, { targetPH: 7.5 }),
];

/** Competent reference design for a given (true) wastewater. */
export const REFERENCE: Record<IndustryId, (s: Stream) => TrainSpec> = {
  plating: (s) => metalTrain(s.Q, s.CrVI > 0.05),
  food: (s) => foodTrain(s.Q),
  semiconductor: (s) => semiconductorTrain(s.Q),
};
