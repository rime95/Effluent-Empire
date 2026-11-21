import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LedgerCat, useGame } from '../../game/store';
import { rm } from '../format';

const AXIS = { stroke: '#8aa0b8', fontSize: 10, fontFamily: 'var(--mono)' };
const CAT_LABEL: Record<LedgerCat, string> = {
  capital: 'Capital',
  project: 'Project payments',
  om: 'O&M income (service fees + reimbursables)',
  opex: 'Plant running costs (O&M)',
  maintenance: 'SCADA field actions & maintenance',
  payroll: 'Payroll',
  overhead: 'Office overheads',
  lab: 'Laboratory',
  capex: 'Construction',
  penalty: 'Penalties',
  hiring: 'Recruitment',
};

/** Saves from before Phase 2 have uncategorised ledger lines: infer the category from the label. */
function inferCat(label: string): LedgerCat {
  if (label.startsWith('Lab:')) return 'lab';
  if (label.startsWith('Overheads')) return 'overhead';
  if (label.startsWith('Construction') || label.startsWith('Retrofit')) return 'capex';
  if (label.startsWith('Abandon')) return 'penalty';
  return 'project';
}

export function Finance() {
  const g = useGame();
  const cashSeries = useMemo(() => {
    const byWeek = new Map<number, number>();
    let cash = 0;
    for (const l of g.ledger) {
      cash += l.amount;
      byWeek.set(l.week, cash);
    }
    // ledger may be truncated: anchor the series to today's cash
    const offset = g.cash - cash;
    return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, c]) => ({ week, cash: Math.round(c + offset) }));
  }, [g.ledger, g.cash]);

  const window = 13;
  const from = g.week - window + 1;
  const statement = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of g.ledger) {
      if (l.week < from || l.cat === 'capital') continue;
      const k = l.cat ?? inferCat(l.label);
      m.set(k, (m.get(k) ?? 0) + l.amount);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [g.ledger, from]);
  const net = statement.reduce((a, [, v]) => a + v, 0);
  const marketData = g.market.history.map((h) => ({ week: h.week, chemicals: +h.chemicals.toFixed(3), electricity: +h.electricity.toFixed(3), sludge: +h.sludge.toFixed(3) }));

  return (
    <div className="page">
      <h1>Finance</h1>
      <p className="sub">Cash {rm(g.cash)}{g.negativeWeeks > 0 && <b style={{ color: 'var(--alarm)' }}> — beyond the RM 250,000 credit line for {g.negativeWeeks} week(s); insolvent after 6.</b>}</p>
      <div className="grid g2">
        <div className="panel">
          <h2>Cash position</h2>
          <div className="lab-chart" style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={cashSeries} margin={{ top: 8, right: 12, bottom: 4, left: 10 }}>
                <CartesianGrid stroke="#1c3653" />
                <XAxis dataKey="week" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#0d1c2e', border: '1px solid #24405f' }} formatter={(v: number) => rm(v)} labelFormatter={(l) => `Week ${l}`} />
                <Line type="stepAfter" dataKey="cash" stroke="var(--flow)" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>Last {window} weeks (weeks {Math.max(1, from)}–{g.week})</h2>
          <table className="data">
            <tbody>
              {statement.map(([k, v]) => (
                <tr key={k}>
                  <td>{CAT_LABEL[k as LedgerCat] ?? k}</td>
                  <td className="num" style={{ color: v < 0 ? '#ff9c9c' : '#6fd39a' }}>
                    {rm(v)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 600, color: '#fff' }}>Net cash flow</td>
                <td className="num" style={{ fontWeight: 600, color: net < 0 ? '#ff9c9c' : '#6fd39a' }}>
                  {rm(net)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Market price indices</h2>
          <div className="lab-chart" style={{ height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={marketData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#1c3653" />
                <XAxis dataKey="week" {...AXIS} />
                <YAxis {...AXIS} domain={[0.7, 1.6]} />
                <Tooltip contentStyle={{ background: '#0d1c2e', border: '1px solid #24405f' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="chemicals" stroke="var(--chem)" dot={false} isAnimationActive={false} />
                <Line dataKey="electricity" stroke="var(--warn)" dot={false} isAnimationActive={false} />
                <Line dataKey="sludge" stroke="var(--sludge)" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="muted" style={{ fontSize: 11 }}>1.00 = base price. Operated plants pay chemicals, electricity and sludge disposal at these indices.</p>
        </div>
        <div className="panel">
          <h2>Ledger (latest 12)</h2>
          <table className="data">
            <tbody>
              {g.ledger
                .slice(-12)
                .reverse()
                .map((l, i) => (
                  <tr key={i}>
                    <td className="muted num" style={{ textAlign: 'left', width: 50 }}>
                      wk {l.week}
                    </td>
                    <td>{l.label}</td>
                    <td className="num" style={{ color: l.amount < 0 ? '#ff9c9c' : '#6fd39a' }}>
                      {rm(l.amount)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
