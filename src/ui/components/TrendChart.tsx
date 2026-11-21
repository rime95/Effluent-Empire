import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AxisGroup, axisDomain, clockLabel, tickLabel, timeTick } from './trendScale';
import { fmt } from '../format';

/* SCADA trend: at most two labelled y-axes (left = first quantity, right = second); tags of one quantity share an axis.
   Axis ranges come from trendScale.ts (minimum span, set-points and limits always in view). */
export interface TrendSeries {
  key: string;
  label: string;
  unit: string;
  group: AxisGroup;
  color: string;
  width?: number;
  dashed?: boolean;
  /** decimals in the tooltip */
  dp?: number;
}
export interface TrendRef {
  y: number;
  groupId: string;
  color: string;
  label: string;
  /** shade the region above (max limit) or below (min limit) */
  shade?: 'above' | 'below';
}

const LINE = '#16304a';
const AXIS = { stroke: '#6f88a3', fontSize: 10, fontFamily: 'var(--mono)' };
const HOURS = [0, 6, 12, 18, 24, 30, 36, 42, 48];

export function TrendChart({ data, series, refs = [], cursor, height }: { data: Record<string, number>[]; series: TrendSeries[]; refs?: TrendRef[]; cursor?: number; height: number }) {
  const groups: AxisGroup[] = [];
  for (const s of series) if (!groups.some((g) => g.id === s.group.id)) groups.push(s.group);
  const axes = groups.slice(0, 2).map((g, i) => {
    const vals: number[] = [];
    for (const s of series.filter((x) => x.group.id === g.id)) for (const p of data) if (Number.isFinite(p[s.key])) vals.push(p[s.key]);
    const ax = axisDomain(
      vals,
      g,
      refs.filter((r) => r.groupId === g.id).map((r) => r.y),
    );
    return { g, id: `ax${i}`, side: i === 0 ? ('left' as const) : ('right' as const), ...ax };
  });
  const axisOf = (gid: string) => axes.find((a) => a.g.id === gid);
  const shown = series.filter((s) => axisOf(s.group.id));
  if (!axes.length) return <div className="muted" style={{ height, fontSize: 12 }}>No signals to trend.</div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: axes.length > 1 ? 4 : 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={LINE} />
          <XAxis dataKey="t" type="number" domain={[0, 48]} ticks={HOURS} interval={0} {...AXIS} tickFormatter={timeTick} />
          {axes.map((a) => (
            <YAxis
              key={a.id}
              yAxisId={a.id}
              orientation={a.side}
              {...AXIS}
              type="number"
              domain={a.domain}
              ticks={a.ticks}
              allowDataOverflow
              tickFormatter={(v: number) => tickLabel(v, a.decimals)}
              width={52}
              label={{ value: a.g.label, angle: a.side === 'left' ? -90 : 90, position: a.side === 'left' ? 'insideLeft' : 'insideRight', fill: '#8aa0b8', fontSize: 10, style: { textAnchor: 'middle' } }}
            />
          ))}
          <Tooltip
            contentStyle={{ background: '#0d1c2e', border: `1px solid ${LINE}`, fontSize: 12 }}
            formatter={(v: number, k: string) => {
              const s = series.find((x) => x.key === k);
              return [`${fmt(v, s?.dp ?? 2)} ${s?.unit ?? ''}`, s?.label ?? k];
            }}
            labelFormatter={(l: number) => clockLabel(Number(l))}
          />
          <Legend formatter={(k: string) => { const s = series.find((x) => x.key === k); return s ? `${s.label}${s.unit ? ` (${s.unit})` : ''}` : k; }} wrapperStyle={{ fontSize: 11 }} />
          {refs.map((r, i) => {
            const a = axisOf(r.groupId);
            if (!a) return null;
            return [
              r.shade && <ReferenceArea key={`a${i}`} yAxisId={a.id} y1={r.shade === 'above' ? r.y : a.domain[0]} y2={r.shade === 'above' ? a.domain[1] : r.y} fill="var(--alarm)" fillOpacity={0.08} ifOverflow="hidden" />,
              <ReferenceLine key={`l${i}`} yAxisId={a.id} y={r.y} stroke={r.color} strokeDasharray="5 4" label={{ value: r.label, position: 'insideTopRight', fill: r.color, fontSize: 10 }} />,
            ];
          })}
          {cursor !== undefined && <ReferenceLine x={cursor} yAxisId={axes[0].id} stroke="#cfe3f7" strokeDasharray="2 3" />}
          {shown.map((s) => (
            <Line key={s.key} yAxisId={axisOf(s.group.id)!.id} dataKey={s.key} stroke={s.color} dot={false} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dashed ? '4 3' : undefined} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
