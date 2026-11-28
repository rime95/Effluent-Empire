/// <reference types="vite/client" />
/**
 * Game art (style C1 "technical colour", generated 2026-11-28 — see art/README.md). All images are optional: every
 * place that shows one keeps its previous look (SVG symbol, initials, plain card) if the file is missing or fails.
 */
import type { IndustryId } from '../game/industries';
import type { Employee } from '../game/staff';

export const artUrl = (path: string) => `${import.meta.env.BASE_URL}art/${path}`;

/** process units with an isometric sprite (public/art/units/<kind>.webp) */
export const UNIT_ART = new Set([
  'eq', 'oilSep', 'daf', 'crReduction', 'neutralisation', 'precipitation', 'sulfide', 'ionExchange', 'electrowinning', 'aop', 'coagulation',
  'clarifier', 'activatedSludge', 'uasb', 'mbr', 'uf', 'ro', 'evaporator', 'sandFilter', 'carbon', 'thickener', 'filterPress', 'dryer',
]);
export const unitArt = (kind: string) => (UNIT_ART.has(kind) ? artUrl(`units/${kind}.webp`) : null);

export const industryArt = (ind: IndustryId) => artUrl(`industry/${ind}.webp`);

export const MENU_ART = 'scenes/menu.webp';

/**
 * Portrait set: who each picture shows (fictional people). A generated employee gets a portrait matching the community
 * and gender implied by the first name, preferring one dressed for their role; deterministic per employee id.
 */
type Group = 'malayF' | 'malayM' | 'chineseF' | 'chineseM' | 'indianF' | 'indianM';
const PORTRAITS: { file: string; group: Group; role: Employee['role'] }[] = [
  { file: 'engineer-1', group: 'malayF', role: 'engineer' },
  { file: 'engineer-2', group: 'chineseM', role: 'engineer' },
  { file: 'engineer-3', group: 'indianM', role: 'engineer' },
  { file: 'engineer-4', group: 'malayM', role: 'engineer' },
  { file: 'labTech-1', group: 'chineseF', role: 'labTech' },
  { file: 'labTech-2', group: 'indianF', role: 'labTech' },
  { file: 'operator-1', group: 'malayM', role: 'operator' },
  { file: 'operator-2', group: 'indianM', role: 'operator' },
  { file: 'operator-3', group: 'chineseM', role: 'operator' },
  { file: 'sales-1', group: 'malayF', role: 'sales' },
  { file: 'sales-2', group: 'chineseF', role: 'sales' },
  { file: 'sales-3', group: 'indianM', role: 'sales' },
];
/** first names used by the candidate generator (src/game/staff.ts) */
const FIRST_GROUP: Record<string, Group> = {
  Aisyah: 'malayF', Nurul: 'malayF', Siti: 'malayF', Amirah: 'malayF',
  Hafiz: 'malayM', Farid: 'malayM', Zulkifli: 'malayM', Iskandar: 'malayM',
  'Mei Ling': 'chineseF', 'Jia Hui': 'chineseF', 'Hui Min': 'chineseF',
  'Wei Jie': 'chineseM', 'Kok Wai': 'chineseM', Daniel: 'chineseM',
  Priya: 'indianF', Shalini: 'indianF', Kavitha: 'indianF',
  Arjun: 'indianM', Kumar: 'indianM', Ravi: 'indianM',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function portraitFor(e: Pick<Employee, 'id' | 'name' | 'role' | 'founder'>): string | null {
  if (e.founder) return null;
  const first = Object.keys(FIRST_GROUP).find((f) => e.name.startsWith(f + ' '));
  const group = first ? FIRST_GROUP[first] : null;
  const pool = PORTRAITS.filter((p) => !group || p.group === group);
  const best = pool.filter((p) => p.role === e.role);
  const pick = (best.length ? best : pool)[hash(e.id) % (best.length || pool.length)];
  return artUrl(`portraits/${pick.file}.webp`);
}

/** Office building by company size (cosmetic, HQ screen): shoplot → office floor → own building → campus → tower. */
export const OFFICE_STAGES = [
  { file: 'office-1', label: 'Shoplot office' },
  { file: 'office-2', label: 'Rented office floor' },
  { file: 'office-3', label: 'Own building with laboratory' },
  { file: 'office-4', label: 'Engineering campus' },
  { file: 'office-5', label: 'Group headquarters tower' },
] as const;

export function officeStage(reputation: number, plantsRun: number, staff: number): number {
  if (reputation >= 90 && plantsRun >= 10) return 4;
  if (reputation >= 70 && plantsRun >= 5) return 3;
  if (reputation >= 40 && plantsRun >= 2) return 2;
  if (reputation >= 20 || staff >= 4) return 1;
  return 0;
}
