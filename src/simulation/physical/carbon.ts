/**
 * Granular activated carbon (GAC) adsorption of refractory organics. Ref: knowledge/physical/adsorption.md
 *
 * Equilibrium — Freundlich isotherm: q = K_F · C^(1/n)   (q mg COD/g carbon, C mg COD/L)
 * Carbon usage rate (exhaustion at influent concentration, M&E §11-?): CUR = (C0 − Ce) / q(C0)   [g carbon / L treated]
 * Removal — GAME MODEL: adsorbable fraction removed 1 − exp(−EBCT/τ), τ = 4 min (EBCT 10–15 min typical);
 * suspended solids > 20 mg/L blind the bed (efficiency × 20/TSS).
 * Adsorbable organics: inert soluble COD (S_I) 80 %, residual readily biodegradable S_S 30 % (polar, poorly adsorbed),
 * emulsified oil 70 %. Isotherm constants are lumped-COD GAME values (verify with a site isotherm).
 */
import { Stream, cloneStream, emptyStream, tss } from '../core/stream';
import { Note, ProcessResult, result } from '../treatment/types';

export const GAC = { KF: 20, invN: 0.4, tau_min: 4, priceRMkg: 9, adsorbable: { SI: 0.8, SS: 0.3, OGemulsified: 0.7 } };

export function freundlichQ(C_mgL: number): number {
  return GAC.KF * Math.pow(Math.max(C_mgL, 0), GAC.invN);
}

export function adsorb(s: Stream, p: { ebct_min: number }): ProcessResult {
  const notes: Note[] = [];
  const feedTSS = tss(s);
  const blinding = feedTSS > 20 ? 20 / feedTSS : 1;
  const eff = (1 - Math.exp(-p.ebct_min / GAC.tau_min)) * blinding;
  const out = cloneStream(s);
  const removed = emptyStream(s.Q);
  const take = (key: 'SI' | 'SS' | 'OGemulsified') => {
    const r = s[key] * GAC.adsorbable[key] * eff;
    out[key] = s[key] - r;
    removed[key] = r;
    return r;
  };
  const codRemoved = take('SI') + take('SS');
  take('OGemulsified');
  // equilibrium at the ADSORBABLE influent concentration; adsorbed oil also occupies capacity
  const C0 = GAC.adsorbable.SI * s.SI + GAC.adsorbable.SS * s.SS;
  const q = freundlichQ(C0); // mg COD / g carbon at exhaustion
  const ogRemoved = s.OGemulsified - out.OGemulsified;
  // Q·ΔC [m³/d · g/m³ = g/d] ÷ q [mg/g = g/kg] = kg carbon/d
  const carbon_kgd = q > 0 ? (s.Q * (codRemoved + ogRemoved)) / q : 0;
  if (feedTSS > 20) notes.push({ level: 'warn', code: 'gac.tss', text: `Feed TSS ${feedTSS.toFixed(0)} mg/L blinds the carbon bed — filter upstream (target < 10 mg/L).` });
  if (p.ebct_min < 8) notes.push({ level: 'warn', code: 'gac.ebct', text: `EBCT ${p.ebct_min} min is short (10–15 min typical).` });
  if (C0 > 300) notes.push({ level: 'warn', code: 'gac.load', text: `Organic load ${C0.toFixed(0)} mg COD/L exhausts carbon quickly — GAC is a polishing step after biology.` });
  return result(out, {
    removed,
    chemicals: [{ name: 'Granular activated carbon (replacement)', kgPerDay: carbon_kgd, priceRMkg: GAC.priceRMkg }],
    energy_kWhd: 0.02 * s.Q,
    notes,
    calcs: {
      ebct: { label: 'Empty-bed contact time', value: p.ebct_min, unit: 'min', digits: 0 },
      eff: { label: 'Adsorbable fraction captured', value: eff * 100, unit: '%', digits: 0 },
      q: { label: 'Carbon capacity q(C₀) (Freundlich)', value: q, unit: 'mg COD/g', digits: 0 },
      cur: { label: 'Carbon usage', value: carbon_kgd, unit: 'kg/d', digits: 1 },
      bed: { label: 'Bed volume', value: (s.Q / 1440) * p.ebct_min, unit: 'm³', digits: 1 },
    },
  });
}
