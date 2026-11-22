/**
 * SCADA live plant view: the as-built PFD (same layout as the Studio) drawn as cross-section tanks, with water moving
 * through the pipes and changing colour from raw (brown) to clean (blue) as it is treated, and a live instrument
 * faceplate under every unit. Driven by the 48 h dynamic replay at the playback cursor. Ref: knowledge/operations/scada.md
 */
import { memo, useMemo } from 'react';
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import type { Plant } from '../../game/operations';
import type { TrendPoint } from '../../simulation/dynamic/plantDynamics';
import { CATALOGUE, type UnitType } from '../../simulation/treatment/catalogue';
import type { PNode } from '../../simulation/treatment/graph';
import { defaultPos } from '../studio/layout';
import { SLUDGE_UNITS } from '../studio/nodes';
import { fmt } from '../format';
import { TANK_H, TANK_NOZZLE, TANK_W, Tank, waterColor } from './tanks';
import { TAG_DP, TAG_SHORT, TAG_UNITS, defaultTags, tagVisible } from './tags';

const TAG_ROW = 16;
const SLUDGE_COLOR = '#6b4a2a';
const EMPTY_PIPE = '#9aa7b4';

type Reading = { label: string; value?: string; level?: 'warn' | 'alarm'; noInst?: boolean };
type LiveUnitData = { kind: UnitType; tag: string; water: string; level: number; active: number; empty: boolean; readings: Reading[]; alarm: boolean; selected: boolean; flip?: boolean; ras?: boolean };
type LiveTermData = { kind: 'influent' | 'discharge' | 'disposal'; label: string; water: string; readings: Reading[]; alarm: boolean };
type LiveEdgeData = { Q: number; wq: number; sludge?: boolean; rel: number };

function Face({ readings }: { readings: Reading[] }) {
  if (!readings.length) return null;
  return (
    <div className="live-face">
      {readings.map((r) => (
        <div key={r.label} className="row2">
          <span>{r.label}</span>
          {r.noInst ? <span className="noinst">no instrument</span> : <span className={`v ${r.level ?? ''}`}>{r.value}</span>}
        </div>
      ))}
    </div>
  );
}

const LiveUnit = memo(function LiveUnit({ data }: NodeProps<Node<LiveUnitData>>) {
  const inSide = data.flip ? Position.Right : Position.Left;
  const outSide = data.flip ? Position.Left : Position.Right;
  const sludgeX = SLUDGE_UNITS[data.kind];
  const bottom = TAG_ROW + TANK_H - 4;
  return (
    <div className={`live-node ${data.alarm ? 'alarm' : ''} ${data.selected ? 'sel' : ''}`}>
      <div className="live-tag">
        <span>
          <span className="lamp" style={{ background: data.alarm ? 'var(--alarm)' : data.empty ? '#9aa7b4' : 'var(--ok)' }} />
          {data.tag}
        </span>
        <span style={{ fontWeight: 400, color: 'var(--ink-muted)', marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 62 }}>{CATALOGUE[data.kind].name.split(' ')[0]}</span>
      </div>
      <div className="live-tank">
        <Tank kind={data.kind} water={data.water} level={data.level} active={data.active} empty={data.empty} />
      </div>
      <Handle type="target" position={inSide} style={{ top: TAG_ROW + TANK_NOZZLE.in, opacity: 0 }} />
      {data.kind === 'splitter' ? (
        <>
          <Handle id="a" type="source" position={outSide} style={{ top: TAG_ROW + 28, opacity: 0 }} />
          <Handle id="b" type="source" position={outSide} style={{ top: TAG_ROW + 44, opacity: 0 }} />
        </>
      ) : (
        <Handle id="out" type="source" position={outSide} style={{ top: TAG_ROW + TANK_NOZZLE.out, opacity: 0 }} />
      )}
      {sludgeX !== undefined && <Handle id="sludge" type="source" position={Position.Bottom} style={{ left: sludgeX, top: bottom, opacity: 0 }} />}
      {data.ras && <Handle id="ras" type="source" position={Position.Bottom} style={{ left: 36, top: bottom, opacity: 0 }} />}
      <Face readings={data.readings} />
    </div>
  );
});

const LiveTerminal = memo(function LiveTerminal({ data }: NodeProps<Node<LiveTermData>>) {
  const inflow = data.kind === 'influent';
  return (
    <div className="live-node" style={{ width: 120 }}>
      <div className="live-tag">
        <span>
          <span className="lamp" style={{ background: data.alarm ? 'var(--alarm)' : 'var(--ok)' }} />
          {data.label}
        </span>
      </div>
      <svg width={120} height={44} viewBox="0 0 120 44" className={data.alarm ? 'tank-blink' : undefined}>
        <path d={inflow ? 'M4 10 H92 L112 22 L92 34 H4 Z' : data.kind === 'disposal' ? 'M10 8 H110 V36 H10 Z' : 'M28 10 H116 V34 H28 L8 22 Z'} fill={data.water} stroke="#9fb4c8" strokeWidth={1.5} />
      </svg>
      {inflow && <Handle id="out" type="source" position={Position.Right} style={{ top: TAG_ROW + 22, opacity: 0 }} />}
      {!inflow && <Handle type="target" position={Position.Left} style={{ top: TAG_ROW + 22, opacity: 0 }} />}
      <Face readings={data.readings} />
    </div>
  );
});

const LivePipe = memo(function LivePipe(props: EdgeProps<Edge<LiveEdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 4, offset: 18 });
  const Q = data?.Q ?? 0;
  const flowing = Q > 1e-3;
  const color = !flowing ? EMPTY_PIPE : data?.sludge ? SLUDGE_COLOR : waterColor(data?.wq ?? 0);
  const rel = data?.rel ?? 0;
  const w = flowing ? 3 + 3.5 * rel : 2.5;
  return (
    <>
      <path d={path} fill="none" stroke="#5b6b7c" strokeOpacity={0.35} strokeWidth={w + 2.5} />
      <path d={path} fill="none" stroke={color} strokeWidth={w} strokeOpacity={flowing ? 0.95 : 0.6} />
      {flowing && (
        <path
          d={path}
          fill="none"
          className="live-pipe"
          stroke="#ffffff"
          strokeOpacity={data?.sludge ? 0.25 : 0.45}
          strokeWidth={Math.max(1.2, w * 0.35)}
          strokeDasharray={data?.sludge ? '4 24' : '6 22'}
          strokeLinecap="round"
          style={{ animationDuration: `${(data?.sludge ? 4 : 2.6 - 1.8 * rel).toFixed(2)}s` }}
        />
      )}
    </>
  );
});

const nodeTypes = { liveUnit: LiveUnit, liveTerm: LiveTerminal };
const edgeTypes = { live: LivePipe };

const vis = (n: PNode, k: string) => tagVisible(n, k);

/** 2–4 live readings for a unit at this hour (instrument rules as in the trend panel) */
function unitReadings(n: PNode, u: Record<string, number> | undefined, outQ: number, wq: number): Reading[] {
  if (u?.bypassed) return [{ label: 'Status', value: 'BYPASSED', level: 'warn' }];
  const keys = Object.keys(u ?? {}).filter((k) => k !== 'sp' && k !== 'bypassed');
  const shown = keys.filter((k) => vis(n, k));
  const pick = [...new Set([...defaultTags(n.kind, shown), ...shown])].slice(0, 3);
  const out: Reading[] = pick.map((k) => {
    const v = u![k];
    let level: Reading['level'];
    if (k === 'DO' && v < 0.5) level = 'alarm';
    if (k === 'level' && v > 95) level = 'alarm';
    if (k === 'pump' && v > 99) level = 'warn';
    if (k === 'pHmeasured' && u!.sp !== undefined && Math.abs(v - u!.sp) > 0.5) level = 'warn';
    return { label: TAG_SHORT[k] ?? k, value: `${fmt(v, TAG_DP[k] ?? 0)}${TAG_UNITS[k] === '%' ? ' %' : ''}`, level };
  });
  // a tag the unit would report but has no instrument for (the player's instrumentation choice stays visible)
  const blind = keys.find((k) => !vis(n, k) && ['pH', 'DO', 'level'].includes(k));
  if (blind) out.push({ label: TAG_SHORT[blind] ?? blind, noInst: true });
  if (out.length < 2) out.push({ label: 'Out Q', value: `${fmt(outQ, outQ < 10 ? 1 : 0)} m³/d` });
  if (out.length < 3) out.push({ label: 'Quality', value: wq < 0.02 ? 'clean' : wq < 0.5 ? 'treated' : wq < 0.85 ? 'turbid' : 'raw', level: undefined });
  return out;
}

function LivePlantInner({ plant, at, selected, onSelect }: { plant: Plant; at: TrendPoint | null; selected?: string; onSelect: (id: string) => void }) {
  const g = plant.graph;
  const edgesAt = at?.edges ?? {};
  const maxQ = useMemo(() => Math.max(1, ...Object.values(edgesAt).map((e) => e.Q)), [at]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes: Node[] = useMemo(() => {
    const qIn = (id: string) => g.edges.filter((e) => e.to === id).reduce((a, e) => a + (edgesAt[e.id]?.Q ?? 0), 0);
    const outEdges = (id: string) => g.edges.filter((e) => e.from === id && e.fromPort !== 'sludge' && e.fromPort !== 'ras');
    const qOut = (id: string) => outEdges(id).reduce((a, e) => a + (edgesAt[e.id]?.Q ?? 0), 0);
    const wqOut = (id: string) => {
      const es = outEdges(id).filter((e) => (edgesAt[e.id]?.Q ?? 0) > 0);
      return es.length ? Math.max(...es.map((e) => edgesAt[e.id].wq)) : g.edges.filter((e) => e.to === id).reduce((a, e) => Math.max(a, edgesAt[e.id]?.wq ?? 0), 0);
    };
    return g.nodes.map((n, i): Node => {
      const position = defaultPos(n, i, g.nodes.length);
      if (n.kind === 'influent' || n.kind === 'discharge' || n.kind === 'disposal') {
        const isIn = n.kind === 'influent';
        const Q = isIn ? qOut(n.id) : qIn(n.id);
        const wq = isIn ? wqOut(n.id) : g.edges.filter((e) => e.to === n.id).reduce((a, e) => Math.max(a, edgesAt[e.id]?.wq ?? 0), 0);
        const sludge = n.kind === 'disposal' && g.edges.some((e) => e.to === n.id && edgesAt[e.id]?.sludge);
        const fail = n.kind === 'discharge' && at && !at.pass;
        const readings: Reading[] = isIn
          ? [{ label: 'Inflow', value: `${fmt(Q, Q < 10 ? 1 : 0)} m³/d` }]
          : n.kind === 'discharge'
            ? [
                { label: 'Outflow', value: `${fmt(Q, Q < 10 ? 1 : 0)} m³/d` },
                { label: 'pH', value: at ? fmt(at.effluent.pH, 2) : '—' },
                { label: 'Status', value: !at ? '—' : at.pass ? 'COMPLIANT' : at.failed.slice(0, 2).join(', '), level: fail ? 'alarm' : undefined },
              ]
            : [{ label: n.params.reuse === 'yes' ? 'To process' : 'Hauled', value: `${fmt(Q, Q < 10 ? 2 : 0)} m³/d` }];
        const label = isIn ? (n.params.source ? n.tag ?? 'RAW-2' : 'RAW') : n.kind === 'discharge' ? 'OUT' : n.tag ?? 'SD';
        return { id: n.id, type: 'liveTerm', position, draggable: false, selectable: false, data: { kind: n.kind, label, water: sludge ? SLUDGE_COLOR : waterColor(wq), readings, alarm: !!fail } satisfies LiveTermData };
      }
      const u = at?.units[n.id];
      const qo = qOut(n.id);
      const wq = wqOut(n.id);
      const empty = qIn(n.id) < 1e-3 && qo < 1e-3;
      const level = n.kind === 'eq' && u?.level !== undefined ? u.level / 100 : n.kind === 'eq' ? 0.5 : 0.85;
      const active = u?.pump !== undefined ? Math.min(1, u.pump / 100) : u?.blower !== undefined ? Math.min(1, u.blower / 100) : ['coagulation', 'crReduction', 'sulfide', 'aop', 'electrowinning', 'uasb', 'mbr'].includes(n.kind) ? 0.5 : 0;
      const alarm = !!u && ((u.DO !== undefined && vis(n, 'DO') && u.DO < 0.5) || (u.level !== undefined && vis(n, 'level') && u.level > 95) || (u.sp !== undefined && vis(n, 'sp') && Math.abs(u.pHmeasured - u.sp) > 0.5));
      return {
        id: n.id,
        type: 'liveUnit',
        position,
        draggable: false,
        data: {
          kind: n.kind as UnitType,
          tag: n.tag ?? n.kind,
          water: waterColor(wq),
          level,
          active,
          empty,
          readings: unitReadings(n, u, qo, wq),
          alarm,
          selected: selected === n.id,
          flip: n.flip,
          ras: g.edges.some((e) => e.from === n.id && e.fromPort === 'ras'),
        } satisfies LiveUnitData,
      };
    });
  }, [g, at, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges: Edge[] = useMemo(
    () =>
      g.edges.map((e) => {
        const d = edgesAt[e.id];
        const Q = d?.Q ?? 0;
        return {
          id: e.id,
          type: 'live',
          source: e.from,
          sourceHandle: e.fromPort ?? (g.nodes.find((n) => n.id === e.from)?.kind === 'splitter' ? 'a' : 'out'),
          target: e.to,
          selectable: false,
          data: { Q, wq: d?.wq ?? 0, sludge: d?.sludge, rel: Q > 0 ? Math.log10(1 + Q) / Math.log10(1 + maxQ) : 0 } satisfies LiveEdgeData,
        };
      }),
    [g, at, maxQ], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => n.type === 'liveUnit' && onSelect(n.id)}
    >
      <Background color="#dce1e7" gap={20} />
    </ReactFlow>
  );
}

/** Live plant canvas (own React Flow provider; remounts per plant so the view fits the new drawing). */
export function LivePlant(props: { plant: Plant; at: TrendPoint | null; selected?: string; onSelect: (id: string) => void }) {
  // canvas height follows the drawing: a one-row train needs less height than a plant with a sludge line or side streams
  const ys = props.plant.graph.nodes.map((n, i) => defaultPos(n, i, props.plant.graph.nodes.length).y);
  const height = Math.round(Math.min(520, Math.max(260, 230 + (Math.max(...ys) - Math.min(...ys)) * 0.55)));
  return (
    <div style={{ height, background: 'var(--canvas)', borderRadius: 6, overflow: 'hidden' }}>
      <ReactFlowProvider key={props.plant.id}>
        <LivePlantInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

/** Colour bar legend: raw → meets the discharge limit. */
export function WaterLegend() {
  const stops = [1, 0.85, 0.65, 0.45, 0.2, 0];
  return (
    <div className="row" style={{ gap: 6, alignItems: 'center', fontSize: 11, color: '#8aa0b8' }}>
      <span>raw</span>
      <div style={{ display: 'flex', width: 140, height: 10, borderRadius: 2, overflow: 'hidden' }}>
        {stops.map((s) => (
          <div key={s} style={{ flex: 1, background: waterColor(s) }} />
        ))}
      </div>
      <span>meets limit</span>
      <span style={{ marginLeft: 6, display: 'inline-block', width: 14, height: 10, background: SLUDGE_COLOR, borderRadius: 2 }} />
      <span>sludge</span>
    </div>
  );
}

export { TANK_W };
