import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, Position, type EdgeProps, type Node, type NodeProps, type Edge } from '@xyflow/react';
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { DisposalSymbol, UnitSymbol } from '../components/Symbols';

export const CATEGORY_COLOR = { physical: 'var(--phys)', chemical: 'var(--chem)', biological: 'var(--bio)', sludge: 'var(--sludge)', hydraulic: '#5b6b7c' } as const;

export type DosingTag = { label: string; kgd: number };
export type UnitNodeData = {
  kind: UnitType;
  tag: string;
  status: 'ok' | 'warn' | 'error' | 'idle';
  summary?: string;
  /** chemical dosing packages drawn above the unit (from the simulation) */
  dosing?: DosingTag[];
  /** dry solids removed to the sludge line, kg/d (stub until a sludge line is connected) */
  sludgeKgD?: number;
  /** sludge port is piped to a thickener / press / disposal point */
  sludgeRouted?: boolean;
};
export type TerminalNodeData = { kind: 'influent' | 'discharge' | 'disposal'; label: string; sub: string; tag?: string };

const STATUS_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--alarm)', idle: '#9aa7b4' };
/** symbol is 120×80 drawn below an 18 px tag row; nozzle heights (symbol y) per unit kind */
const TAG_H = 18;
const NOZZLE: Partial<Record<UnitType, { in: number; out: number }>> = {
  clarifier: { in: 44, out: 30 },
  sandFilter: { in: 26, out: 44 },
  thickener: { in: 30, out: 26 },
  filterPress: { in: 40, out: 40 },
};
/** sludge draw-off nozzle x (symbol coordinates) — at the hopper / underdrain */
export const SLUDGE_UNITS: Partial<Record<UnitType, number>> = { clarifier: 60, oilSep: 94, sandFilter: 100, thickener: 60, filterPress: 60 };

function UnitNodeImpl({ data, selected }: NodeProps<Node<UnitNodeData>>) {
  const def = CATALOGUE[data.kind];
  const accent = CATEGORY_COLOR[def.category];
  const nz = NOZZLE[data.kind] ?? { in: 44, out: 44 };
  const sludgeX = SLUDGE_UNITS[data.kind];
  const showSludge = sludgeX !== undefined && !data.sludgeRouted && (data.sludgeKgD ?? 0) > 0.05;
  return (
    <div className={`pfd-eq ${selected ? 'selected' : ''}`}>
      {data.dosing && data.dosing.length > 0 && (
        <div className="pfd-dosing">
          {data.dosing.slice(0, 2).map((d, i) => (
            <div key={d.label} className="pfd-dose" style={{ left: 6 + i * 58 }}>
              <svg viewBox="0 0 40 46" width="40" height="46">
                <rect x="2" y="2" width="16" height="20" fill="none" stroke="var(--chem)" strokeWidth="1.3" />
                <path d="M10 22 V30 H22" fill="none" stroke="var(--chem)" strokeWidth="1.2" />
                <circle cx="28" cy="30" r="6" fill="none" stroke="var(--chem)" strokeWidth="1.3" />
                <path d="M25 33 L28 26 L31 33" fill="none" stroke="var(--chem)" strokeWidth="1.1" />
                <path d="M28 36 V46" fill="none" stroke="var(--chem)" strokeWidth="1.3" strokeDasharray="3 2" />
              </svg>
              <div className="pfd-dose-label">
                {d.label}
                <br />
                {d.kgd < 10 ? d.kgd.toFixed(1) : d.kgd.toFixed(0)} kg/d
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="pfd-tag">
        <span className="lamp" style={{ background: STATUS_COLOR[data.status] }} title={data.status} />
        {data.tag}
      </div>
      <UnitSymbol type={data.kind} accent={accent} />
      <Handle type="target" position={Position.Left} style={{ top: TAG_H + nz.in }} />
      {data.kind === 'splitter' ? (
        <>
          <Handle id="a" type="source" position={Position.Right} style={{ top: TAG_H + 30 }} title="Outlet a" />
          <Handle id="b" type="source" position={Position.Right} style={{ top: TAG_H + 58 }} title="Outlet b" />
        </>
      ) : (
        <Handle id="out" type="source" position={Position.Right} style={{ top: TAG_H + nz.out }} />
      )}
      {sludgeX !== undefined && <Handle id="sludge" className="sludge-port" type="source" position={Position.Bottom} style={{ left: sludgeX, top: TAG_H + 78 }} title="Sludge outlet — pipe to a thickener, filter press or sludge disposal" />}
      <div className="pfd-name">{def.name}</div>
      {data.summary && <div className="pfd-duty">{data.summary}</div>}
      {showSludge && (
        <div className="pfd-sludge" title="Sludge leaves to off-site disposal (a sludge line arrives in a later update)">
          <svg viewBox="0 0 14 26" width="14" height="26">
            <path d="M7 0 V20" stroke="var(--sludge)" strokeWidth="1.8" strokeDasharray="4 3" />
            <path d="M2 17 L7 25 L12 17" fill="var(--sludge)" />
          </svg>
          <span>
            sludge {data.sludgeKgD! < 10 ? data.sludgeKgD!.toFixed(1) : data.sludgeKgD!.toFixed(0)} kg DS/d
          </span>
        </div>
      )}
    </div>
  );
}

function TerminalNodeImpl({ data, selected }: NodeProps<Node<TerminalNodeData>>) {
  if (data.kind === 'disposal')
    return (
      <div className={`pfd-eq ${selected ? 'selected' : ''}`}>
        <div className="pfd-tag">{data.tag}</div>
        <DisposalSymbol />
        <Handle type="target" position={Position.Left} style={{ top: TAG_H + 30 }} />
        <div className="pfd-name">{data.label}</div>
        <div className="pfd-duty">{data.sub}</div>
      </div>
    );
  const inflow = data.kind === 'influent';
  return (
    <div className={`pfd-terminal-arrow ${inflow ? 'in' : 'out'} ${selected ? 'selected' : ''}`}>
      {!inflow && <Handle type="target" position={Position.Left} />}
      <div className="t-label">{data.label}</div>
      <div className="t-sub">{data.sub}</div>
      {inflow && <Handle id="out" type="source" position={Position.Right} />}
    </div>
  );
}

export type PipeEdgeData = { no?: number; q?: string; highlight?: boolean; service?: 'process' | 'sludge' | 'recycle' };

/** Orthogonal process line with an arrowhead and an ISO-style stream-number diamond at its midpoint. */
function PipeEdgeImpl(props: EdgeProps<Edge<PipeEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data } = props;
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 2, offset: 18 });
  const service = data?.service ?? 'process';
  const color = service === 'sludge' ? 'var(--sludge)' : 'var(--flow)';
  const hi = selected || data?.highlight;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: hi ? 'var(--clean)' : color, strokeWidth: hi ? 3.2 : 2.2, strokeDasharray: service === 'sludge' ? '7 4' : service === 'recycle' ? '10 3 2 3' : undefined }}
      />
      {data?.no !== undefined && (
        <EdgeLabelRenderer>
          <div className={`pipe-label ${hi ? 'hi' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            <span className="stream-no">{data.no}</span>
            {data.q && <span className="stream-q">{data.q}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const UnitNode = memo(UnitNodeImpl);
export const TerminalNode = memo(TerminalNodeImpl);
export const PipeEdge = memo(PipeEdgeImpl);
export const nodeTypes = { unit: UnitNode, terminal: TerminalNode };
export const edgeTypes = { pipe: PipeEdge };
