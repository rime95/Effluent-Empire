import type { ReqCheck } from '../../game/requirements';
import { fmt } from '../format';

/** Contract requirements beyond the discharge standard, evaluated like regulated parameters. */
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
            <td className="num">{fmt(c.value, 0)} {c.unit}</td>
            <td className="num">≤ {fmt(c.limit, 0)} {c.unit}</td>
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
