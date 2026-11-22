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
