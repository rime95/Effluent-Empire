/**
 * pH after coagulant dosing — reference: knowledge/chemistry/coagulation_flocculation.md "pH after dosing — reference check".
 * Hand calculation: closed carbonate system, C_T constant, alkalinity reduced by the stoichiometric equivalents.
 */
import { describe, expect, it } from 'vitest';
import { emptyStream } from '../../src/simulation/core/stream';
import { MW } from '../../src/simulation/core/units';
import { adjustPH, alkalinityFiltered as alkalinity, equilibrate, setCbForPH } from '../../src/simulation/chemistry/acidBase';
import { coagulate, PAC_AL_FRACTION, PAC_BASICITY, type Coagulant } from '../../src/simulation/chemistry/coagulation';
import { coagSolubility } from '../../src/simulation/chemistry/solubility';
import { pK1, pK2, pKw } from '../../src/simulation/chemistry/constants';
import { checkMassBalance, components, zeroComponents } from '../../src/simulation/core/massBalance';

const T = 25;
const K1 = 10 ** -pK1(T), K2 = 10 ** -pK2(T), Kw = 10 ** -pKw(T);
const carbAlk = (ct: number, pH: number) => { const H = 10 ** -pH; return (ct * (K1 * H + 2 * K1 * K2)) / (H * H + K1 * H + K1 * K2) + Kw / H - H; };
/** water at pH0 with alkalinity alk (mg/L CaCO3) */
function water(alk: number, pH0: number) {
  const H = 10 ** -pH0;
  const ct = alk / 50000 / ((K1 * H + 2 * K1 * K2) / (H * H + K1 * H + K1 * K2));
  return { s: setCbForPH({ ...emptyStream(1000), T, CT: ct, colloid: 50 }, pH0), ct, alkEq: carbAlk(ct, pH0) };
}
function handPH(alkEq: number, ct: number) {
  let lo = 0, hi = 14;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (carbAlk(ct, m) > alkEq) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
const EQ_PER_MG: Record<Coagulant, number> = { alum: 6 / MW.alum, ferric: 3 / MW.FeCl3, pac: (3 * (1 - PAC_BASICITY)) / (MW.Al / PAC_AL_FRACTION) };

describe('pH after coagulant dosing (closed carbonate system hand calculation)', () => {
  for (const [alk, pH0] of [[100, 7.5], [250, 8.0], [50, 7.0]] as const)
    for (const c of ['alum', 'ferric', 'pac'] as Coagulant[])
      for (const d of [25, 100]) {
        const { s, ct, alkEq } = water(alk, pH0);
        const dEq = (EQ_PER_MG[c] * d) / 1000;
        if (dEq > 0.8 * alkEq) continue; // hand calc assumes complete precipitation — only valid with alkalinity to spare
        it(`${c} ${d} mg/L into alk ${alk}, pH ${pH0}`, () => {
          const r = coagulate(s, { coagulant: c, dose_mgL: d, flocTime_min: 20 });
          // Al coagulants: dissolved Al (aluminate above pH ≈ 7.5) adds charge the hand calculation leaves out
          expect(Math.abs(r.out.pH - handPH(alkEq - dEq, ct))).toBeLessThan(c === 'ferric' ? 0.04 : 0.1);
          expect(r.out.CT).toBeCloseTo(s.CT, 12); // HCO3− → CO2 leaves C_T unchanged
        });
      }
  it('PAC (B = 0.7) consumes ≈ 0.15 mg CaCO3 per mg product — 30 % of alum per mol Al', () => {
    const { s } = water(150, 7.0);
    const r = coagulate(s, { coagulant: 'pac', dose_mgL: 100, flocTime_min: 20 });
    expect(r.calcs.alk.value / 100).toBeCloseTo(0.150, 2);
    // measured (filtered) drop is slightly less: the trace of dissolved aluminate still titrates as alkalinity
    expect(Math.abs(alkalinity(s) - alkalinity(r.out) - 15.0)).toBeLessThan(1);
  });
  it('Al(OH)3(am) solubility minimum ≈ 0.04 mg/L near pH 6.2; Fe(OH)3(am) negligible at pH 4–11', () => {
    let best = { pH: 0, mg: Infinity };
    for (let pH = 5; pH <= 8; pH += 0.01) { const mg = coagSolubility('Al', pH).molL * MW.Al * 1000; if (mg < best.mg) best = { pH, mg }; }
    expect(best.pH).toBeGreaterThan(5.9);
    expect(best.pH).toBeLessThan(6.5);
    expect(best.mg).toBeLessThan(0.08);
    for (const pH of [4, 7, 11]) expect(coagSolubility('Fe', pH).molL * MW.Fe * 1000).toBeLessThan(0.1);
  });
});

describe('coagulant overdose beyond the alkalinity', () => {
  it('alum: excess Al stays dissolved and pH bottoms out ≈ 4.6–5 (Al3+ / Al(OH)3 buffer)', () => {
    const { s } = water(100, 7.5);
    const r = coagulate(s, { coagulant: 'alum', dose_mgL: 300, flocTime_min: 20 });
    expect(r.out.pH).toBeGreaterThan(4.5);
    expect(r.out.pH).toBeLessThan(5.0);
    // excess acidity ≈ 300·0.505 − 100 = 51 mg/L CaCO3 ≈ 1.0 meq/L → roughly 1/3 mmol Al dissolved ≈ 9–12 mg/L
    expect(r.out.alDissolved).toBeGreaterThan(8);
    expect(r.out.alDissolved).toBeLessThan(14);
    expect(r.notes.some((n) => n.code === 'coag.aluminate')).toBe(true);
    // reported consumption is what the water actually had (≈ 100), not the stoichiometric 152
    expect(Math.abs(r.calcs.alk.value - alkalinity(s))).toBeLessThan(5);
  });
  it('ferric: pH goes far lower and some Fe stays dissolved, flagged and counted as effluent Fe', () => {
    const { s } = water(100, 7.5);
    const r = coagulate(s, { coagulant: 'ferric', dose_mgL: 300, flocTime_min: 20 });
    expect(r.out.pH).toBeLessThan(3);
    expect(r.out.feDissolved ?? 0).toBeGreaterThan(1);
    expect(r.notes.some((n) => n.code === 'coag.ferricDissolved')).toBe(true);
    const c = components(r.out);
    expect(c.Fe).toBeCloseTo((s.Q * 300 * MW.Fe) / MW.FeCl3 / 1000, 6); // dissolved + solid = dosed
  });
  it('dissolved Al / Fe re-precipitate when a later unit neutralises, and the base demand includes them', () => {
    const { s } = water(100, 7.5);
    for (const c of ['alum', 'ferric'] as const) {
      const r = coagulate(s, { coagulant: c, dose_mgL: 300, flocTime_min: 20 });
      const n = equilibrate(adjustPH(r.out, 7).stream);
      expect(n.pH).toBeCloseTo(7, 3);
      expect(n.alDissolved).toBeLessThan(0.3);
      expect(n.feDissolved ?? 0).toBeLessThan(0.01);
      expect(n.alSolid + n.alDissolved).toBeCloseTo(r.out.alSolid + r.out.alDissolved, 9);
      expect(n.feSolid + (n.feDissolved ?? 0)).toBeCloseTo(r.out.feSolid + (r.out.feDissolved ?? 0), 9);
    }
  });
  it('pH control holds its set-point exactly for every coagulant, mass balance closes', () => {
    const { s } = water(100, 7.5);
    for (const c of ['alum', 'ferric', 'pac'] as const) {
      const r = coagulate(s, { coagulant: c, dose_mgL: 300, flocTime_min: 20, pHset: 6.5 });
      expect(r.out.pH).toBeCloseTo(6.5, 3);
      const bal = checkMassBalance({ in: components(s), out: components(r.out), sludge: zeroComponents(), gas: zeroComponents(), consumed: { ...zeroComponents(), ...r.consumed }, produced: { ...zeroComponents(), ...r.produced } });
      expect(bal.ok).toBe(true);
    }
  });
});
