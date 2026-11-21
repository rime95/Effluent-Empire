/**
 * Employees. Effects are deliberately simple and readable (GAME MODEL):
 *   engineer  — each runs one active project (founder counts)
 *   labTech   — lab tests cheaper (−15 % each, max −45 %) and the 2-week test becomes 1 week
 *   operator  — staffs 1 operator post (1.5 when senior); each O&M plant needs the posts its contract bills
 *               (operations.ts operatorFTE); uncovered plants wear faster and stay broken longer
 *   sales     — +1 open enquiry each (max +3) and larger, better-paid projects
 * Salaries: Malaysian private-sector monthly ranges (indicative, 2026), paid weekly (×12/52).
 */
import { createRng } from './rng';

export type Role = 'engineer' | 'labTech' | 'operator' | 'sales';

export interface Employee {
  id: string;
  name: string;
  role: Role;
  level: 1 | 2 | 3;
  salaryMonthly: number;
  hiredWeek: number;
  founder?: boolean;
}

export const ROLES: Record<Role, { label: string; salary: [number, number, number]; effect: string }> = {
  engineer: { label: 'Process Engineer', salary: [5_500, 8_000, 11_500], effect: 'Runs one active project at a time.' },
  labTech: { label: 'Laboratory Technician', salary: [3_000, 3_800, 4_800], effect: 'Lab tests 15 % cheaper each; long tests take 1 week instead of 2.' },
  operator: { label: 'Plant Operator', salary: [2_800, 3_400, 4_200], effect: 'Staffs 1 operator post (1.5 when senior). Each O&M plant needs the posts its contract bills (0.5–2.5). Uncovered plants wear out and stay broken longer.' },
  sales: { label: 'Sales Engineer', salary: [5_000, 7_000, 9_500], effect: '+1 open enquiry and larger, better-paid projects.' },
};

export const LEVEL_LABEL = ['', 'Junior', 'Experienced', 'Senior'];

const FIRST = ['Aisyah', 'Hafiz', 'Mei Ling', 'Arjun', 'Nurul', 'Kumar', 'Wei Jie', 'Siti', 'Daniel', 'Priya', 'Farid', 'Jia Hui', 'Ravi', 'Amirah', 'Kok Wai', 'Zulkifli', 'Shalini', 'Hui Min', 'Iskandar', 'Kavitha'];
const LAST = ['Rahman', 'Tan', 'Lim', 'Subramaniam', 'Ismail', 'Wong', 'Abdullah', 'Chong', 'Nair', 'Ong', 'Yusof', 'Lee', 'Raj', 'Hassan', 'Ng'];

export function founder(): Employee {
  return { id: 'founder', name: 'You (Founder)', role: 'engineer', level: 3, salaryMonthly: 0, hiredWeek: 1, founder: true };
}

export function weeklySalary(e: Employee): number {
  return (e.salaryMonthly * 12) / 52;
}

export function payroll(staff: Employee[]): number {
  return staff.reduce((a, e) => a + weeklySalary(e), 0);
}

export function generateCandidates(seed: number, week: number, reputation: number): Employee[] {
  const rng = createRng(seed * 13 + week);
  const roles: Role[] = ['engineer', 'labTech', 'operator', 'sales'];
  const out: Employee[] = [];
  for (let i = 0; i < 4; i++) {
    const role = roles[i];
    const levelRoll = rng.next() + Math.min(0.3, Math.max(0, reputation) / 300);
    const level = (levelRoll > 0.85 ? 3 : levelRoll > 0.5 ? 2 : 1) as 1 | 2 | 3;
    const salary = Math.round(ROLES[role].salary[level - 1] * rng.range(0.92, 1.1) / 50) * 50;
    out.push({ id: `c${seed}-${week}-${i}`, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, role, level, salaryMonthly: salary, hiredWeek: 0 });
  }
  return out;
}

export function count(staff: Employee[], role: Role): number {
  return staff.filter((e) => e.role === role).length;
}

export function projectSlots(staff: Employee[]): number {
  return count(staff, 'engineer');
}

export function labDiscount(staff: Employee[]): number {
  return Math.min(0.45, 0.15 * count(staff, 'labTech'));
}

export function labWeeks(staff: Employee[], weeks: number): number {
  return count(staff, 'labTech') > 0 ? Math.max(1, weeks - 1) : weeks;
}

/** Operator posts the company can staff (FTE): 1 per operator, 1.5 for a senior operator. */
export function operatorCapacity(staff: Employee[]): number {
  return staff.filter((e) => e.role === 'operator').reduce((a, e) => a + (e.level === 3 ? 1.5 : 1), 0);
}

export function salesBoost(staff: Employee[]): number {
  return Math.min(3, count(staff, 'sales'));
}
