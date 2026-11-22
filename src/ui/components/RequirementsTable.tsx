import type { ReqCheck } from '../../game/requirements';
import { fmt } from '../format';

/** Contract requirements beyond the discharge standard, evaluated like regulated parameters. */
/** display decimals per requirement (energy and sludge intensities are small numbers) */
const DP: Partial<Record<ReqCheck['id'], number>> = { energyMax_kWhm3: 2, sludgeMax_kgm3: 3 };

export function RequirementsTable({ checks, title = 'Contract requirements' }: { checks: ReqCheck[]; title?: string }) {
  if (!checks.length) return null;
  return (
    <table className="data" style={{ marginTop: 10 }}>
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">Value</th>
          <th className="num">Limit</th>
          <th>Result</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id}>
            <td>{c.label}</td>
            <td className="num">{fmt(c.value, DP[c.id] ?? 0)} {c.unit}</td>
            <td className="num">{c.id === 'reuseMin' ? '≥' : '≤'} {fmt(c.limit, DP[c.id] ?? 0)} {c.unit}</td>
            <td>
              <span className={`pill ${c.pass ? 'pass' : 'fail'}`}>{c.pass ? 'PASS' : 'FAIL'}</span>
            </td>
            <td className="muted" style={{ fontSize: 12 }}>{c.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
