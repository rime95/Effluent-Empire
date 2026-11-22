/**
 * Vacuum evaporator with mechanical vapour recompression (MVR). Ref: knowledge/physical/evaporation.md
 *
 * GAME MODEL:
 *  - water balance: distillate = r·Q, concentrate = (1−r)·Q carrying every non-volatile species and all solids;
 *  - the concentrate is capped at 300,000 mg/L dissolved solids (salts crystallise / the liquor stops being pumpable):
 *    a higher requested recovery is cut back to that limit;
 *  - volatile carry-over: free ammonia NH₃ (fraction α = 1/(1+10^(pKa−pH)), pKa ≈ 8.3 at 70 °C) strips with the vapour,
 *    90 % of it reaching the distillate; 2 % of soluble COD (volatile organics) carries over;
 *  - compressor energy 25 kWh/m³ distillate + 0.05 kWh/m³ per g/L concentrate TDS (boiling-point rise raises the
 *    compression ratio) — MVR typically 20–40 kWh/m³ (verify).
 */
import { METALS, Stream, cloneStream, tdsTotal, tss } from '../core/stream';
import { equilibrate } from '../chemistry/acidBase';
import { Note, ProcessResult, result } from '../treatment/types';

export const EVAP = {
  maxConcTDS: 300_000,
  pKaNH3_hot: 8.3,
  nh3Carry: 0.9,
  codCarry: 0.02,
  baseKWh_m3: 25,
  bprKWh_per_gL: 0.05,
};

const NONVOL = ['tds', 'SO4T', 'Cb', 'CT', 'weakAcidT', 'SS', 'SI', 'XS', 'XI', 'biomass', 'grit', 'inert', 'colloid', 'floc', 'alSolid', 'feSolid', 'alDissolved', 'feDissolved', 'CrVI', 'OGfree', 'OGemulsified', 'OGfloc', 'sulfideS', 'NO3N', 'NH4N'] as const;

export function evaporate(s: Stream, p: { recovery_pct: number }): ProcessResult {
  const notes: Note[] = [];
  const tdsF = tdsTotal(s);
  let r = Math.min(0.99, Math.max(0.1, p.recovery_pct / 100));
  const rMax = tdsF > 0 ? Math.max(0.1, 1 - tdsF / EVAP.maxConcTDS) : 0.99;
  if (r > rMax) {
    notes.push({ level: 'warn', code: 'evap.crystal', text: `At ${(r * 100).toFixed(0)} % recovery the concentrate would pass ${(EVAP.maxConcTDS / 1000).toFixed(0)} g/L and salts crystallise in the tubes — recovery held at ${(rMax * 100).toFixed(0)} %. Haul the concentrate or add a crystalliser/dryer.` });
    r = rMax;
  }
  const dist = cloneStream(s);
  const conc = cloneStream(s);
  dist.Q = s.Q * r;
  conc.Q = s.Q * (1 - r);
  dist.ml = conc.ml = undefined;
  dist.peakFactor = conc.peakFactor = 1;
  dist.T = conc.T = Math.max(s.T, 35);
  const D = dist as unknown as Record<string, number>;
  const C = conc as unknown as Record<string, number>;
  const S = s as unknown as Record<string, number>;
  for (const k of NONVOL) {
    D[k] = 0;
    C[k] = (S[k] ?? 0) / (1 - r);
  }
  for (const m of METALS) {
    dist.dissolved[m] = dist.precipitated[m] = dist.complexed![m] = dist.sulfide![m] = 0;
    conc.dissolved[m] = s.dissolved[m] / (1 - r);
    conc.precipitated[m] = s.precipitated[m] / (1 - r);
    conc.complexed![m] = (s.complexed?.[m] ?? 0) / (1 - r);
    conc.sulfide![m] = (s.sulfide?.[m] ?? 0) / (1 - r);
  }
  // volatiles to the distillate (mass moved from the concentrate)
  const aNH3 = 1 / (1 + Math.pow(10, EVAP.pKaNH3_hot - s.pH));
  const nh3 = s.NH4N * aNH3 * EVAP.nh3Carry; // mg/L of feed
  dist.NH4N = nh3 / r;
  conc.NH4N = (s.NH4N - nh3) / (1 - r);
  for (const k of ['SS', 'SI'] as const) {
    const v = S[k] * EVAP.codCarry;
    D[k] = v / r;
    C[k] = (S[k] - v) / (1 - r);
  }
  const tdsC = tdsTotal(conc);
  const kWh_m3 = EVAP.baseKWh_m3 + EVAP.bprKWh_per_gL * (tdsC / 1000);
  if (aNH3 > 0.2 && s.NH4N > 5) notes.push({ level: 'warn', code: 'evap.nh3', text: `${(aNH3 * 100).toFixed(0)} % of the ammonia is free NH₃ at pH ${s.pH.toFixed(1)} and boils over into the distillate (${dist.NH4N.toFixed(0)} mg/L N) — acidify the feed to pH ≈ 6 to keep it in the concentrate.` });
  if (s.pH < 5) notes.push({ level: 'warn', code: 'evap.corrosion', text: `Feed pH ${s.pH.toFixed(1)}: hot acidic chloride liquor corrodes stainless steel — neutralise to pH 6–7 (or specify titanium/duplex).` });
  if (s.OGfree + s.OGemulsified > 50) notes.push({ level: 'warn', code: 'evap.foam', text: 'Oil and surfactants foam under vacuum and carry over into the distillate — remove oil first.' });
  if (tss(s) > 500) notes.push({ level: 'info', code: 'evap.solids', text: 'High suspended solids foul the heat-exchange surfaces — clarify the feed.' });
  return result(equilibrate(dist), {
    reject: equilibrate(conc),
    notes,
    energy_kWhd: dist.Q * kWh_m3,
    chemicals: [{ name: 'Antifoam / cleaning chemicals (evaporator)', kgPerDay: (s.Q * 5) / 1000, priceRMkg: 8 }],
    calcs: {
      rec: { label: 'Distillate recovery', value: r * 100, unit: '%', digits: 0 },
      dist: { label: 'Distillate', value: dist.Q, unit: 'm³/d', digits: 2 },
      conc: { label: 'Concentrate', value: conc.Q, unit: 'm³/d', digits: 2 },
      tdsC: { label: 'Concentrate dissolved solids', value: tdsC, unit: 'mg/L', digits: 0 },
      cf: { label: 'Concentration factor', value: 1 / (1 - r), unit: '×', digits: 1 },
      spec: { label: 'Specific energy (MVR compressor)', value: kWh_m3, unit: 'kWh/m³ distillate', digits: 1 },
    },
  });
}
