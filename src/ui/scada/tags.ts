/** SCADA tag metadata shared by the live plant view and the trend panel. Ref: knowledge/operations/scada.md */
import { hasInst } from '../../simulation/treatment/instrumentation';
import type { PNode } from '../../simulation/treatment/graph';

/** Tags a unit can show in SCADA: without the instrument there is no signal (knowledge/operations/instrumentation.md). */
export function tagVisible(n: PNode | undefined, key: string): boolean {
  if (!n) return true;
  if (key === 'bypassed') return false;
  if (['pH', 'pHmeasured', 'pump', 'sp'].includes(key) && ['neutralisation', 'precipitation', 'coagulation'].includes(n.kind)) return hasInst(n, 'pHLoop');
  if (['DO', 'blower'].includes(key) && n.kind === 'activatedSludge') return hasInst(n, 'doLoop');
  if (['level', 'overflow'].includes(key) && n.kind === 'eq') return hasInst(n, 'level');
  return true;
}

export const TAG_UNITS: Record<string, string> = { level: '%', outflow: 'm³/d', overflow: 'm³/d', pH: '', pHmeasured: '', pump: '%', sp: '', DO: 'mg/L', MLSS: 'mg/L', NH4: 'mg N/L', NO3: 'mg N/L', OUR: 'mg/L·h', blower: '%', carry: '%', TSS: 'mg/L', SOR: 'm/h' };
export const TAG_LABEL: Record<string, string> = { level: 'Level', outflow: 'Outflow', overflow: 'Overflow', pH: 'pH (true)', pHmeasured: 'pH (probe)', pump: 'Dosing pump', sp: 'Set-point', DO: 'DO', MLSS: 'MLSS', NH4: 'NH₄-N', NO3: 'NO₃-N', OUR: 'OUR', blower: 'Blower', carry: 'Solids carry-over', TSS: 'TSS', SOR: 'SOR (peak)' };
/** mimic labels (fit the 110 px faceplate) and display decimals per tag */
export const TAG_SHORT: Record<string, string> = { level: 'Level', outflow: 'Out Q', overflow: 'Overflow', pH: 'pH', pHmeasured: 'pH probe', pump: 'Pump', DO: 'DO', MLSS: 'MLSS', NH4: 'NH₄-N', NO3: 'NO₃-N', OUR: 'OUR', blower: 'Blower', carry: 'Carry-ov', TSS: 'TSS', SOR: 'SOR' };
export const TAG_DP: Record<string, number> = { pH: 2, pHmeasured: 2, DO: 2, NH4: 1, NO3: 1, carry: 1, SOR: 2, OUR: 1 };
/** tags trended by default when a unit is selected */
export function defaultTags(kind: string, keys: string[]): string[] {
  const pref: Record<string, string[]> = { neutralisation: ['pH', 'pHmeasured', 'pump'], precipitation: ['pH', 'pHmeasured', 'pump'], coagulation: ['pH', 'pHmeasured'], crReduction: ['pH', 'pHmeasured'], activatedSludge: ['DO', 'blower'], eq: ['level', 'outflow'], clarifier: ['TSS'] };
  const want = (pref[kind] ?? keys.slice(0, 2)).filter((k) => keys.includes(k));
  return want.length ? want : keys.slice(0, 1);
}
