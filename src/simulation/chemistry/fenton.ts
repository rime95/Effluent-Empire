/**
 * Fenton advanced oxidation (Fe²⁺ + H₂O₂ → •OH) for refractory COD. Ref: knowledge/chemistry/fenton_aop.md
 *
 * Reactor sequence: acidify to the pH set-point (H₂SO₄) → H₂O₂ + iron → oxidation → neutralise to pH 7.5 (NaOH), which
 * precipitates the iron as Fe(OH)₃ floc (a clarifier must follow).
 * GAME MODEL:
 *  - stoichiometry: 2.125 g H₂O₂ per g COD (1 g COD = 1 g O₂; H₂O₂ → H₂O + ½O₂ supplies 16/34 g O₂ per g);
 *  - utilisation η = 0.6·exp(−((pH − 3)/1.0)²)·min(1, Fe:H₂O₂/0.1) (radical scavenging, iron precipitation away from pH 3,
 *    too little catalyst; verify against jar tests — typical field utilisation 30–60 %);
 *  - •OH is non-selective: oxidation is shared pro rata over the soluble COD (readily biodegradable and inert alike),
 *    capped at 90 % of it (intermediates such as oxalate resist);
 *  - iron is modelled as ferric (Fe²⁺ is oxidised to Fe³⁺ in the reaction) and dosed through the coagulation chemistry.
 */
import { Stream } from '../core/stream';
import { MW } from '../core/units';
import { neutralise } from './neutralisation';
import { coagulate } from './coagulation';
import { Note, ProcessResult, result } from '../treatment/types';

export const FENTON = { h2o2PerCOD: 2.125, etaMax: 0.6, feRatioRef: 0.1, capFrac: 0.9, h2o2RMkg: 3.2 };

export function fenton(s: Stream, p: { h2o2_mgL: number; feRatio: number; pHset: number; volume_m3: number }): ProcessResult {
  const notes: Note[] = [];
  const acid = neutralise(s, { targetPH: p.pHset, base: 'NaOH', volume_m3: p.volume_m3 });
  const a = acid.out;
  const pH = a.pH;
  const eta = FENTON.etaMax * Math.exp(-(((pH - 3) / 1.0) ** 2)) * Math.min(1, p.feRatio / FENTON.feRatioRef);
  const sol = a.SS + a.SI;
  const ox = Math.min(FENTON.capFrac * sol, (eta * p.h2o2_mgL) / FENTON.h2o2PerCOD);
  const ox2 = { ...a };
  if (sol > 0) {
    ox2.SS = a.SS - (ox * a.SS) / sol;
    ox2.SI = a.SI - (ox * a.SI) / sol;
  }
  // iron catalyst as ferric (FeCl₃-equivalent mass) through the coagulation chemistry; pH held at the set-point
  const feMgL = p.h2o2_mgL * p.feRatio;
  const coag = coagulate(ox2 as Stream, { coagulant: 'ferric', dose_mgL: (feMgL * MW.FeCl3) / MW.Fe, flocTime_min: 10, pHset: p.pHset });
  const neut = neutralise(coag.out, { targetPH: 7.5, base: 'NaOH', volume_m3: p.volume_m3 / 4 });
  if (pH < 2.5 || pH > 4) notes.push({ level: 'warn', code: 'aop.pH', text: `Fenton works at pH 2.5–4 (iron stays dissolved and catalytic); at pH ${pH.toFixed(1)} only ${(eta * 100).toFixed(0)} % of the peroxide does useful oxidation.` });
  if (p.feRatio < 0.05) notes.push({ level: 'warn', code: 'aop.fe', text: `Fe:H₂O₂ ${p.feRatio.toFixed(2)} (w/w) is too little catalyst — use 0.1–0.2.` });
  if (sol > 0 && ox >= FENTON.capFrac * sol - 1e-9) notes.push({ level: 'info', code: 'aop.excess', text: 'Peroxide exceeds what the soluble COD can use — residual H₂O₂ is wasted (and reads as COD in the lab test). Trim the dose.' });
  if (s.XS + s.XI > 200) notes.push({ level: 'info', code: 'aop.particulate', text: 'Particulate COD is barely touched by •OH — remove solids first; Fenton is for dissolved refractory COD.' });
  const chemicals = [...acid.chemicals, { name: 'Hydrogen peroxide (as 100 %)', kgPerDay: (s.Q * p.h2o2_mgL) / 1000, priceRMkg: FENTON.h2o2RMkg }, ...coag.chemicals.map((c) => ({ ...c, name: 'Iron catalyst (Fenton)' })), ...neut.chemicals];
  const sum = (k: 'produced' | 'consumed') => {
    const o: Record<string, number> = {};
    for (const r of [acid, coag, neut]) for (const [c, v] of Object.entries(r[k])) o[c] = (o[c] ?? 0) + (v as number);
    return o;
  };
  const consumed = sum('consumed');
  consumed.COD = (consumed.COD ?? 0) + (s.Q * ox) / 1000;
  return result(neut.out, {
    produced: sum('produced'),
    consumed,
    notes: [...notes, ...coag.notes.filter((n) => n.level !== 'info')],
    chemicals,
    energy_kWhd: p.volume_m3 * 0.02 * 24,
    calcs: {
      pH: { label: 'Reaction pH', value: pH, unit: '', digits: 1 },
      eta: { label: 'Peroxide utilisation', value: eta * 100, unit: '%', digits: 0 },
      ox: { label: 'COD oxidised', value: ox, unit: 'mg/L', digits: 0 },
      siOut: { label: 'Refractory (inert) COD after', value: ox2.SI, unit: 'mg/L', digits: 0 },
      ratio: { label: 'H₂O₂ : COD removed', value: ox > 0 ? p.h2o2_mgL / ox : 0, unit: 'g/g', digits: 1 },
      hrt: { label: 'Reaction time', value: (p.volume_m3 / Math.max(s.Q, 1e-9)) * 1440, unit: 'min', digits: 0 },
    },
  });
}
