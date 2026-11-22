/**
 * Upflow anaerobic sludge blanket (UASB) reactor with biogas recovery. Ref: knowledge/biological/anaerobic_uasb.md
 *
 * GAME MODEL:
 *  - granular sludge is retained (SRT ≫ HRT); soluble biodegradable COD (S_S) and VFA follow first-order removal in a
 *    mixed blanket: S_out = S_in/(1 + k·HRT), k = 6 d⁻¹ at 35 °C, θ = 1.06 (verify); slowly biodegradable X_S is
 *    hydrolysed k_h = 0.25 d⁻¹ on the solids retention (≈ 30 d) — about 88 % at 35 °C;
 *  - organic overload: above 15 kg COD/m³·d k falls in proportion (VFA accumulate, granules float out);
 *  - yield 0.05 g VSS/g COD removed (anaerobic, verify), N taken from NH₄ at 0.124 g N/g VSS;
 *  - methane: 0.35 Nm³ CH₄ per kg COD converted at STP (0 °C, 1 atm), ×(273+T)/273 at the reactor temperature; the
 *    converted COD leaves as gas;
 *  - biogas → CHP at 38 % electrical efficiency, 9.97 kWh per Nm³ CH₄; the power offsets plant electricity;
 *  - not modelled: sulfate reduction / H₂S, ammonification of organic N, alkalinity consumption by VFA build-up.
 */
import { Stream, cloneStream } from '../core/stream';
import { COD_PER_VSS, N_PER_VSS, hrtDays } from '../core/units';
import { equilibrate } from '../chemistry/acidBase';
import { PRICES } from '../treatment/catalogue';
import { Note, ProcessResult, result } from '../treatment/types';

export const UASB = { k35: 6, theta: 1.06, kh: 0.25, srt: 30, olrMax: 15, Y: 0.05, ch4STP: 0.35, ch4kWh: 9.97, chpEff: 0.38, floor: 50, height: 6 };

export function uasb(s: Stream, p: { volume_m3: number }): ProcessResult {
  const notes: Note[] = [];
  const V = Math.max(p.volume_m3, 1);
  const hrt = hrtDays(V, Math.max(s.Q, 1e-9));
  const codIn = s.SS + s.SI + s.XS + s.XI + COD_PER_VSS * s.biomass;
  const olr = (s.Q * codIn) / 1000 / V;
  const fT = Math.pow(UASB.theta, s.T - 35);
  let k = UASB.k35 * fT;
  if (olr > UASB.olrMax) {
    k *= UASB.olrMax / olr;
    notes.push({ level: 'warn', code: 'uasb.olr', text: `Organic loading ${olr.toFixed(1)} kg COD/m³·d exceeds ~${UASB.olrMax} — VFA accumulate and granules wash out. Enlarge the reactor.` });
  }
  if (s.pH < 6.5) {
    k *= 0.3;
    notes.push({ level: 'warn', code: 'uasb.pH', text: `Feed pH ${s.pH.toFixed(1)}: methanogens need pH 6.8–7.5 — neutralise and keep alkalinity above ~1,500 mg/L CaCO₃.` });
  }
  if (s.T < 25) notes.push({ level: 'warn', code: 'uasb.cold', text: `${s.T.toFixed(0)} °C is below the mesophilic range (30–38 °C): rates fall sharply.` });
  const upflow = s.Q / 24 / (V / UASB.height);
  if (upflow > 1.0) notes.push({ level: 'warn', code: 'uasb.upflow', text: `Upflow velocity ${upflow.toFixed(2)} m/h (6 m deep reactor) exceeds ~1 m/h — granules wash out.` });
  if (s.OGfree + s.OGemulsified > 100) notes.push({ level: 'warn', code: 'uasb.oil', text: 'Oil above ~100 mg/L forms scum and coats the granules — remove it first (DAF).' });
  if ((s.SO4T ?? 0) * 96060 > 500) notes.push({ level: 'info', code: 'uasb.so4', text: 'High sulfate: sulfate reducers would compete for COD and make H₂S in the biogas (not modelled).' });
  if (codIn < 1500) notes.push({ level: 'info', code: 'uasb.weak', text: `Feed COD ${codIn.toFixed(0)} mg/L is low for anaerobic treatment — UASB pays off above ~2,000 mg/L.` });
  const out = cloneStream(s);
  const ss = Math.max(Math.min(s.SS, UASB.floor), s.SS / (1 + k * hrt));
  const xs = s.XS / (1 + UASB.kh * fT * UASB.srt);
  let removed = s.SS - ss + (s.XS - xs);
  // biomass synthesis needs ammonium
  let dX = UASB.Y * removed;
  if (N_PER_VSS * dX > s.NH4N) dX = s.NH4N / N_PER_VSS;
  out.SS = ss;
  out.XS = xs;
  out.biomass = s.biomass + dX;
  out.NH4N = s.NH4N - N_PER_VSS * dX;
  // VFA are converted with the soluble substrate; acid removed → pH rises; part of the CO2 stays dissolved
  const vfaOut = s.weakAcidT / (1 + k * hrt);
  out.weakAcidT = vfaOut;
  out.CT = s.CT + 0.5 * (s.weakAcidT - vfaOut);
  removed = Math.max(0, removed);
  const toGas = removed - COD_PER_VSS * dX; // mg/L COD to CH4
  const ch4 = ((s.Q * toGas) / 1000) * UASB.ch4STP * ((273.15 + s.T) / 273.15); // Nm³/d at T
  const ch4Std = ((s.Q * toGas) / 1000) * UASB.ch4STP;
  const kWhE = ch4Std * UASB.ch4kWh * UASB.chpEff;
  const credit = kWhE * PRICES.electricity_kWh;
  return result(equilibrate(out), {
    gas: { COD: (s.Q * toGas) / 1000 },
    credits: credit > 0 ? [{ name: 'Biogas CHP power', RMd: credit }] : [],
    notes,
    energy_kWhd: 0.05 * s.Q,
    calcs: {
      olr: { label: 'Organic loading rate', value: olr, unit: 'kg COD/m³·d', digits: 1 },
      hrt: { label: 'HRT', value: hrt * 24, unit: 'h', digits: 1 },
      up: { label: 'Upflow velocity', value: upflow, unit: 'm/h', digits: 2 },
      eff: { label: 'COD removal', value: codIn > 0 ? (100 * (removed)) / codIn : 0, unit: '%', digits: 0 },
      ch4: { label: 'Methane', value: ch4, unit: 'm³/d', digits: 0 },
      kwh: { label: 'CHP electricity', value: kWhE, unit: 'kWh/d', digits: 0 },
    },
  });
}
