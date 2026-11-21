/**
 * Generated P&ID sheet (read-only): drawn from the PFD layout plus the instrumentation chosen per unit.
 * Symbols follow ISA-5.1 conventions: plain circle = field instrument, circle in square = shared display / control
 * (DCS/PLC), dashed line = electrical signal. Ref: knowledge/operations/instrumentation.md
 */
import { memo } from 'react';
import type { PNode, ProcessGraph, SimResult } from '../../simulation/treatment/graph';
import { hasInst } from '../../simulation/treatment/instrumentation';
import { UnitType } from '../../simulation/treatment/catalogue';
import { DisposalSymbol, UnitSymbol } from '../components/Symbols';

const INK = '#1a2633';
const W = 120;
const TAG_H = 18;
const NOZ: Partial<Record<string, { in: number; out: number }>> = { clarifier: { in: 44, out: 30 }, sandFilter: { in: 26, out: 44 }, thickener: { in: 30, out: 26 }, filterPress: { in: 40, out: 40 } };
const SLUDGE_X: Partial<Record<string, number>> = { clarifier: 60, oilSep: 94, sandFilter: 100, thickener: 60, filterPress: 60 };
const DOSING = ['neutralisation', 'precipitation', 'crReduction', 'coagulation'];

function num(tag: string | undefined): string {
  const m = (tag ?? '').match(/(\d+)/);
  return m ? m[1].padStart(2, '0') : '00';
}

/** ISA bubble: letters over loop number. kind 'field' = circle, 'dcs' = circle inside square. */
function Bubble({ x, y, letters, loop, kind, title, onClick }: { x: number; y: number; letters: string; loop: string; kind: 'field' | 'dcs'; title: string; onClick?: () => void }) {
  return (
    <g transform={`translate(${x},${y})`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <title>{title}</title>
      {kind === 'dcs' && <rect x={-15} y={-15} width={30} height={30} fill="#fff" stroke={INK} strokeWidth={1.2} />}
      <circle r={14} fill="#fff" stroke={INK} strokeWidth={1.4} />
      {kind === 'dcs' && <path d="M-14 0 H14" stroke={INK} strokeWidth={1} />}
      <text y={kind === 'dcs' ? -3 : -1} textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fontWeight={700} fill={INK}>
        {letters}
      </text>
      <text y={kind === 'dcs' ? 10 : 9} textAnchor="middle" fontSize={7.5} fontFamily="var(--mono)" fill={INK}>
        {loop}
      </text>
    </g>
  );
}

function Pump({ x, y, tag, standby = false, metering = false }: { x: number; y: number; tag: string; standby?: boolean; metering?: boolean }) {
  return (
    <g transform={`translate(${x},${y})`} opacity={standby ? 0.75 : 1}>
      <circle r={8} fill="#fff" stroke={INK} strokeWidth={1.4} strokeDasharray={standby ? '3 2' : undefined} />
      {metering ? <path d="M-4 4 L0 -5 L4 4" fill="none" stroke={INK} strokeWidth={1.1} /> : <path d="M0 -8 H10" stroke={INK} strokeWidth={1.4} />}
      <text y={20} textAnchor="middle" fontSize={7.5} fontFamily="var(--mono)" fill={INK}>
        {tag}
      </text>
    </g>
  );
}

function Signal({ d }: { d: string }) {
  return <path d={d} fill="none" stroke={INK} strokeWidth={1} strokeDasharray="5 3" />;
}

export const PidSheet = memo(function PidSheet({ graph, sim, onSelect, docNo }: { graph: ProcessGraph; sim: SimResult | null; onSelect: (id: string) => void; docNo: string }) {
  const pos = new Map(graph.nodes.map((n, i) => [n.id, n.position ?? { x: 160 + i * 190, y: 160 }]));
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const minX = Math.min(...xs) - 80;
  const minY = Math.min(...ys) - 170;
  const maxX = Math.max(...xs) + W + 120;
  const maxY = Math.max(...ys) + 230;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const port = (n: PNode, side: 'in' | 'out' | 'sludge' | 'a' | 'b') => {
    const p = pos.get(n.id)!;
    if (n.kind === 'influent' || n.kind === 'discharge') return { x: p.x + (side === 'in' ? 0 : 140), y: p.y + 18 };
    if (n.kind === 'disposal') return { x: p.x, y: p.y + TAG_H + 30 };
    const z = NOZ[n.kind] ?? { in: 44, out: 44 };
    if (side === 'sludge') return { x: p.x + (SLUDGE_X[n.kind] ?? 60), y: p.y + TAG_H + 80 };
    if (side === 'a') return { x: p.x + W, y: p.y + TAG_H + 30 };
    if (side === 'b') return { x: p.x + W, y: p.y + TAG_H + 58 };
    return { x: p.x + (side === 'in' ? 0 : W), y: p.y + TAG_H + (side === 'in' ? z.in : z.out) };
  };
  let line = 0;
  const tears = new Set(sim?.tears ?? []);

  return (
    <svg className="pid-sheet" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="pidArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={INK} />
        </marker>
      </defs>
      <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#fbfcfd" />
      <rect x={minX + 8} y={minY + 8} width={maxX - minX - 16} height={maxY - minY - 16} fill="none" stroke="#4b5a69" strokeWidth={2} />

      {/* process, sludge and recycle lines with line numbers */}
      {graph.edges.map((e) => {
        const from = byId.get(e.from);
        const to = byId.get(e.to);
        if (!from || !to) return null;
        const s = port(from, (e.fromPort ?? (from.kind === 'splitter' ? 'a' : 'out')) as 'out');
        const t = port(to, 'in');
        const sludge = e.fromPort === 'sludge';
        const mx = sludge ? s.x : (s.x + t.x) / 2;
        const d = sludge ? `M${s.x} ${s.y} V${t.y} H${t.x}` : `M${s.x} ${s.y} H${mx} V${t.y} H${t.x}`;
        line += 1;
        const lineNo = `${sludge ? 'SL' : tears.has(e.id) ? 'RC' : 'WW'}-${String(line).padStart(3, '0')}`;
        const lx = sludge ? s.x + 4 : mx + 4;
        const ly = sludge ? (s.y + t.y) / 2 : Math.min(s.y, t.y) - 6;
        const pumped = from.kind === 'eq' || sludge;
        return (
          <g key={e.id}>
            <path d={d} fill="none" stroke={INK} strokeWidth={sludge ? 1.6 : 2} strokeDasharray={sludge ? '8 4' : tears.has(e.id) ? '10 3 2 3' : undefined} markerEnd="url(#pidArrow)" />
            <text x={lx} y={ly} fontSize={8} fontFamily="var(--mono)" fill="#5b6b7c">
              {lineNo}
            </text>
            {pumped && (
              <>
                <Pump x={sludge ? s.x : s.x + 22} y={sludge ? s.y + 22 : s.y} tag={`P-${num(from.tag)}A`} />
                <Pump x={sludge ? s.x + 26 : s.x + 22} y={sludge ? s.y + 22 : s.y + 26} tag={`P-${num(from.tag)}B`} standby />
              </>
            )}
          </g>
        );
      })}

      {/* equipment + instrumentation */}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const loop = num(n.tag);
        if (n.kind === 'influent' || n.kind === 'discharge') {
          const fm = n.kind === 'influent' && hasInst(n, 'flow');
          return (
            <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: 'pointer' }}>
              <path d={`M${p.x} ${p.y + 6} h126 l14 12 l-14 12 h-126 z`} fill="#fff" stroke={INK} strokeWidth={1.4} />
              <text x={p.x + 8} y={p.y + 22} fontSize={9} fontFamily="var(--mono)" fontWeight={700} fill={INK}>
                {n.kind === 'influent' ? 'RAW WASTEWATER' : 'TO DRAIN (STD)'}
              </text>
              {fm && (
                <>
                  <Signal d={`M${p.x + 170} ${p.y + 18} V${p.y - 22}`} />
                  <Bubble x={p.x + 170} y={p.y - 36} letters="FIT" loop="00" kind="field" title="Inlet flow transmitter (magnetic flow meter) — trended in SCADA" />
                </>
              )}
            </g>
          );
        }
        if (n.kind === 'disposal')
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(n.id)} style={{ cursor: 'pointer' }}>
              <text x={60} y={12} textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fontWeight={700} fill={INK}>
                {n.tag}
              </text>
              <g transform={`translate(0,${TAG_H})`}>
                <DisposalSymbol />
              </g>
            </g>
          );
        const ph = DOSING.includes(n.kind) && hasInst(n, 'pHLoop');
        const doL = n.kind === 'activatedSludge' && hasInst(n, 'doLoop');
        const sb = hasInst(n, 'standby');
        const chems = sim?.nodes[n.id]?.result.chemicals.filter((c) => c.kgPerDay > 0.01) ?? [];
        return (
          <g key={n.id}>
            <g transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(n.id)} style={{ cursor: 'pointer' }}>
              <text x={60} y={12} textAnchor="middle" fontSize={10.5} fontFamily="var(--mono)" fontWeight={700} fill={INK}>
                {n.tag}
              </text>
              <g transform={`translate(0,${TAG_H})`}>
                <svg width={120} height={80} viewBox="0 0 120 80" overflow="visible">
                  <UnitSymbol type={n.kind as UnitType} accent="#9aa7b4" />
                </svg>
              </g>
              {n.bypass && <text x={60} y={TAG_H + 96} textAnchor="middle" fontSize={8} fill="#d64545">OUT OF SERVICE</text>}
            </g>

            {/* chemical dosing: metering pump(s) feeding the tank */}
            {DOSING.includes(n.kind) &&
              chems.slice(0, 2).map((c, i) => {
                const px = p.x + 12 + i * 52;
                const py = p.y - 40;
                return (
                  <g key={c.name}>
                    <path d={`M${px} ${py + 8} V${p.y + TAG_H + 6}`} stroke="#e07b24" strokeWidth={1.2} strokeDasharray="4 2" />
                    <Pump x={px} y={py} tag={`DP-${loop}${String.fromCharCode(65 + i * 2)}`} metering />
                    {sb && <Pump x={px + 22} y={py} tag={`DP-${loop}${String.fromCharCode(66 + i * 2)}`} metering standby />}
                  </g>
                );
              })}
            {DOSING.includes(n.kind) && n.kind !== 'crReduction' && !(n.kind === 'coagulation' && !(Number(n.params.pHset) > 0)) && !ph && (
              <text x={p.x + 60} y={p.y - 70} textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="#d9a21b">
                MANUAL DOSE — NO pH LOOP
              </text>
            )}
            {ph && (
              <g onClick={() => onSelect(n.id)}>
                <Signal d={`M${p.x + 112} ${p.y + 40} H${p.x + 140} V${p.y - 64}`} />
                <Bubble x={p.x + 140} y={p.y - 2} letters="AIT" loop={loop} kind="field" title="pH analyser transmitter" />
                <Bubble x={p.x + 140} y={p.y - 78} letters="AIC" loop={loop} kind="dcs" title="pH controller (PLC/DCS) — PI loop, alarms in SCADA" />
                <Signal d={`M${p.x + 126} ${p.y - 78} H${p.x + 12} V${p.y - 50}`} />
                <text x={p.x + 60} y={p.y - 82} fontSize={7.5} fontFamily="var(--mono)" fill="#5b6b7c">
                  SC → DP
                </text>
              </g>
            )}

            {/* aeration: blowers, DO loop */}
            {n.kind === 'activatedSludge' && (
              <g>
                <path d={`M${p.x + 60} ${p.y - 26} V${p.y + TAG_H + 6}`} stroke={INK} strokeWidth={1.4} />
                <g transform={`translate(${p.x + 40},${p.y - 34})`}>
                  <circle r={10} fill="#fff" stroke={INK} strokeWidth={1.4} />
                  <path d="M-6 -4 L6 0 L-6 4" fill="none" stroke={INK} strokeWidth={1.1} />
                  <text y={24} textAnchor="middle" fontSize={7.5} fontFamily="var(--mono)" fill={INK}>{`B-${loop}A`}</text>
                </g>
                {sb && (
                  <g transform={`translate(${p.x + 80},${p.y - 34})`} opacity={0.75}>
                    <circle r={10} fill="#fff" stroke={INK} strokeWidth={1.4} strokeDasharray="3 2" />
                    <path d="M-6 -4 L6 0 L-6 4" fill="none" stroke={INK} strokeWidth={1.1} />
                    <text y={24} textAnchor="middle" fontSize={7.5} fontFamily="var(--mono)" fill={INK}>{`B-${loop}B`}</text>
                  </g>
                )}
                {doL ? (
                  <g onClick={() => onSelect(n.id)}>
                    <Signal d={`M${p.x + 116} ${p.y + 50} H${p.x + 150} V${p.y - 60}`} />
                    <Bubble x={p.x + 150} y={p.y + 8} letters="AIT" loop={loop} kind="field" title="Dissolved-oxygen analyser transmitter" />
                    <Bubble x={p.x + 150} y={p.y - 74} letters="AIC" loop={loop} kind="dcs" title="DO controller — PI loop on blower speed (BSM1 tuning)" />
                    <Signal d={`M${p.x + 136} ${p.y - 74} H${p.x + 40} V${p.y - 44}`} />
                  </g>
                ) : (
                  <text x={p.x + 60} y={p.y - 62} textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="#d9a21b">
                    FIXED-SPEED BLOWER — NO DO LOOP
                  </text>
                )}
              </g>
            )}

            {/* EQ level */}
            {n.kind === 'eq' && hasInst(n, 'level') && (
              <g>
                <Signal d={`M${p.x + 108} ${p.y + 32} H${p.x + 140} V${p.y - 20}`} />
                <Bubble x={p.x + 140} y={p.y - 34} letters="LIT" loop={loop} kind="field" title="Level transmitter — SCADA level trend" />
                <Bubble x={p.x + 176} y={p.y - 34} letters="LSH" loop={loop} kind="field" title="High-level switch — overflow alarm" />
              </g>
            )}
          </g>
        );
      })}

      {/* legend + title block */}
      <g transform={`translate(${minX + 22},${maxY - 120})`} fontFamily="var(--mono)" fontSize={8.5} fill={INK}>
        <rect x={-8} y={-14} width={300} height={104} fill="#fff" stroke={INK} strokeWidth={1} />
        <text fontWeight={700}>LEGEND (ISA-5.1)</text>
        <Bubble x={14} y={22} letters="AIT" loop="xx" kind="field" title="" />
        <text x={36} y={25}>field-mounted instrument</text>
        <Bubble x={160} y={22} letters="AIC" loop="xx" kind="dcs" title="" />
        <text x={182} y={25}>PLC/DCS function</text>
        <path d="M0 58 H40" stroke={INK} strokeDasharray="5 3" />
        <text x={48} y={61}>electrical signal</text>
        <path d="M150 58 H190" stroke={INK} strokeWidth={2} />
        <text x={198} y={61}>process (WW)</text>
        <path d="M0 78 H40" stroke={INK} strokeWidth={1.6} strokeDasharray="8 4" />
        <text x={48} y={81}>sludge (SL)</text>
        <path d="M150 78 H190" stroke={INK} strokeWidth={2} strokeDasharray="10 3 2 3" />
        <text x={198} y={81}>recycle (RC)</text>
      </g>
      <g transform={`translate(${maxX - 270},${maxY - 70})`} fontFamily="var(--mono)" fontSize={9} fill={INK}>
        <rect width={250} height={52} fill="#fff" stroke={INK} strokeWidth={1.4} />
        <text x={8} y={16} fontWeight={700}>
          PIPING &amp; INSTRUMENTATION DIAGRAM
        </text>
        <text x={8} y={32}>{docNo.replace('PFD', 'PID')} · SHEET 1/1</text>
        <text x={8} y={46} fill="#5b6b7c">
          generated from PFD — instruments per unit inspector
        </text>
      </g>
    </svg>
  );
});
