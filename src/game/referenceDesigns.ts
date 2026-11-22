/**
 * Reference ("competent engineer") designs per industry. Used to (1) price tenders — the market price of a
 * design-and-build contract is roughly what a competent design costs plus margin — and (2) prove in tests that
 * every industry is solvable. They are not shown to the player.
 * Ref: knowledge/chemistry/precipitation.md, knowledge/biological/activated_sludge.md (reference trains)
 */
import { Params, UnitType, defaultParams } from '../simulation/treatment/catalogue';
import { IndustryId } from './industries';
import { Stream } from '../simulation/core/stream';
import { optimumMetalDose_mmol } from '../simulation/chemistry/coagulation';
import { MW } from '../simulation/core/units';

export type TrainSpec = { kind: UnitType; params: Params }[];

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
  u('daf', Q, { area: Math.max(1, Math.ceil(((Q * 2.2 + Q * 0.6) / 24 / 8) * 2) / 2), recycle: 60, pressure: 550 }),
  // ferric emulsion breaking consumes alkalinity: hold the aeration tank at pH 7 so nitrification is not lost
  u('activatedSludge', Q, { volume: Math.ceil(Q * 3.5), srt: 15, control: 'srt', alkPH: 7, alkReagent: 'NaOH' }),
  u('clarifier', Q, { area: Math.ceil(Q / 24 / 0.4) }),
  u('sandFilter', Q),
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
