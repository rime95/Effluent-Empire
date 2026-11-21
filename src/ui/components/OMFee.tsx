import { FeeQuote, OM } from '../../game/operations';
import { rm } from '../format';

/** O&M offer build-up: what the fixed fee pays for, what is re-billed, and what the contract should earn per month. */
export function OMFeeTable({ q, monthlyFee }: { q: FeeQuote; monthlyFee?: number }) {
  const fee = monthlyFee ?? q.monthlyFee;
  const opexAtCost = q.reimbursables / (1 + OM.handling);
  const handling = q.reimbursables - opexAtCost;
  // your costs: operators (payroll), maintenance, CePIETSO, sampling, management; chemicals/power/sludge at cost
  // management is head-office overhead recovery, not a plant cost
  const yourCosts = q.costBase - q.management + opexAtCost;
  const income = fee + q.reimbursables;
  const row = (label: string, v: number, sub?: string, strong = false) => (
    <tr>
      <td style={{ fontWeight: strong ? 600 : undefined }}>
        {label}
        {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
      </td>
      <td className="num" style={{ fontWeight: strong ? 600 : undefined }}>{rm(v)}</td>
    </tr>
  );
  return (
    <table className="data" style={{ fontSize: 12.5 }}>
      <tbody>
        <tr>
          <th colSpan={2}>Fixed monthly service fee — build-up</th>
        </tr>
        {row('Plant operators', q.staffing, `${q.operatorFTE} post(s) × RM ${OM.operatorSalary.toLocaleString()} + ${Math.round(OM.onCost * 100)} % on-costs`)}
        {row('CePIETSO competent person', q.supervision, `${Math.round(OM.cepietsoFTE * 100)} % of a certified environmental professional (IER 2009)`)}
        {row('Preventive maintenance', q.maintenance, `${Math.round(OM.maintenanceFraction * 100)} % of CAPEX per year`)}
        {row('Compliance sampling', q.lab, `weekly grab sample, accredited lab, RM ${OM.labPerParam}/parameter`)}
        {row('Management & insurance', q.management, `${Math.round(OM.managementFraction * 100)} % of the above — recovers your office overheads`)}
        {row('Cost base', q.costBase, undefined, true)}
        {row(`Margin (${Math.round(q.margin * 100)} %)`, fee - q.costBase, 'set by your reputation: 100–150 %')}
        {row('Fixed service fee / month', fee, `escalates ${Math.round(OM.escalation * 100)} % per contract year; −${Math.round(OM.deduction * 100)} % for each failed weekly sample`, true)}
        <tr>
          <th colSpan={2}>Reimbursables (billed at cost + {Math.round(OM.handling * 100)} %)</th>
        </tr>
        {row('Chemicals, power, sludge disposal', q.reimbursables, `≈ ${rm(opexAtCost)} at today's prices — market and flow changes are passed to the client`)}
        <tr>
          <th colSpan={2}>Expected per month</th>
        </tr>
        {row('Income (fee + reimbursables)', income)}
        {row('Your costs', -yourCosts, 'operators (payroll), maintenance, CePIETSO, sampling, chemicals/power/sludge')}
        {row('Expected margin', income - yourCosts, `margin + management recovery + ${rm(handling)} handling; before repairs and fines`, true)}
      </tbody>
    </table>
  );
}
