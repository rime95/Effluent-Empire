import { Handle, NodeProps, Position, type Node } from '@xyflow/react';
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { UnitSymbol } from '../components/Symbols';

export const CATEGORY_COLOR = { physical: 'var(--phys)', chemical: 'var(--chem)', biological: 'var(--bio)' } as const;

export type UnitNodeData = { kind: UnitType; tag: string; status: 'ok' | 'warn' | 'error' | 'idle'; summary?: string };
export type TerminalNodeData = { kind: 'influent' | 'discharge'; label: string; sub: string };

const STATUS_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--alarm)', idle: '#9aa7b4' };

export function UnitNode({ data, selected }: NodeProps<Node<UnitNodeData>>) {
  const def = CATALOGUE[data.kind];
  const accent = CATEGORY_COLOR[def.category];
  return (
    <div className={`pfd-node ${selected ? 'selected' : ''}`} style={{ position: 'relative', borderTop: `4px solid ${accent}` }}>
      <span className="badge" style={{ background: STATUS_COLOR[data.status] }} title={data.status} />
      <Handle type="target" position={Position.Left} />
      <div className="tag">{data.tag}</div>
      <UnitSymbol type={data.kind} accent={accent} />
      <div className="name">{def.name}</div>
      {data.summary && <div className="name mono" style={{ color: 'var(--ink)' }}>{data.summary}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function TerminalNode({ data }: NodeProps<Node<TerminalNodeData>>) {
  return (
    <div className="pfd-terminal" style={{ background: data.kind === 'influent' ? 'var(--sludge)' : 'var(--clean)' }}>
      {data.kind === 'discharge' && <Handle type="target" position={Position.Left} />}
      <div style={{ fontWeight: 600 }}>{data.label}</div>
      <div style={{ fontSize: 10, opacity: 0.85 }}>{data.sub}</div>
      {data.kind === 'influent' && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export const nodeTypes = { unit: UnitNode, terminal: TerminalNode };
