import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, applyNodeChanges } from '@xyflow/react';
import { useActiveProject, useGame } from '../../game/store';
import { designBasis } from '../../game/lab';
import { constructionWeeks, makeNode, RETROFIT_PREMIUM } from '../../game/project';
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { PNode, ProcessGraph, simulate } from '../../simulation/treatment/graph';
import { evaluate, measure, STANDARDS } from '../../simulation/treatment/compliance';
import { Stream } from '../../simulation/core/stream';
import { UnitSymbol } from '../components/Symbols';
import { CATEGORY_COLOR, nodeTypes } from './nodes';
import type { Screen } from '../App';
import { fmt, rm } from '../format';

const UNIT_ORDER: UnitType[] = ['eq', 'oilSep', 'clarifier', 'sandFilter', 'carbon', 'crReduction', 'neutralisation', 'precipitation', 'coagulation', 'activatedSludge'];

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export function Studio(props: { go: (s: Screen) => void }) {
  return (
    <ReactFlowProvider>
      <StudioInner {...props} />
    </ReactFlowProvider>
  );
}

/** Graph identity ignoring canvas positions — simulation only reruns when the process changes. */
function processKey(g: ProcessGraph) {
  return JSON.stringify({ n: g.nodes.map((n) => [n.id, n.kind, n.params]), e: g.edges.map((e) => [e.from, e.to]) });
}

function StudioInner({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const p = useActiveProject();
  const rf = useReactFlow();
  const [sel, setSel] = useState<Selection>(null);
  const [dragNodes, setDragNodes] = useState<Node[] | null>(null);

  const graph = p?.graph;
  const editable = !!p && (p.status === 'design' || p.status === 'failed');
  const basis = useMemo(() => (p ? designBasis(p.datasheet) : null), [p?.datasheet]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = graph ? processKey(graph) : '';
  const sim = useMemo(() => (graph && basis ? simulate(graph, basis.stream) : null), [key, basis]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => (sim?.effluent && p ? evaluate(sim.effluent, p.enquiry.standard, sim) : null), [sim, p?.enquiry.standard]); // eslint-disable-line react-hooks/exhaustive-deps

  const setGraph = useCallback((ng: ProcessGraph) => g.setGraph(ng), [g]);

  const rfNodes: Node[] = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.map((n, i) => {
      const pos = n.position ?? (n.kind === 'influent' ? { x: 0, y: 160 } : n.kind === 'discharge' ? { x: 1100, y: 160 } : { x: 160 + i * 150, y: 140 });
      if (n.kind === 'influent' || n.kind === 'discharge') {
        return {
          id: n.id,
          type: 'terminal',
          position: pos,
          deletable: false,
          selected: sel?.kind === 'node' && sel.id === n.id,
          data: { kind: n.kind, label: n.kind === 'influent' ? 'RAW WASTEWATER' : 'FINAL DISCHARGE', sub: n.kind === 'influent' ? `${p!.datasheet.Q} m³/d` : `Standard ${p!.enquiry.standard}` },
        };
      }
      const ns = sim?.nodes[n.id];
      const notes = ns?.result.notes ?? [];
      const status = !ns ? 'idle' : notes.some((x) => x.level === 'error') ? 'error' : notes.some((x) => x.level === 'warn') ? 'warn' : 'ok';
      const c = ns?.result.calcs;
      const summary = c?.sor ? `SOR ${fmt(c.sor.value, 2)} m/h` : c?.pH && n.kind !== 'activatedSludge' ? `pH ${fmt(c.pH.value, 1)}` : c?.mlss ? `MLSS ${fmt(c.mlss.value, 0)}` : c?.rate ? `${fmt(c.rate.value, 1)} m/h` : c?.hrt ? `HRT ${fmt(c.hrt.value, 1)} h` : undefined;
      return { id: n.id, type: 'unit', position: pos, selected: sel?.kind === 'node' && sel.id === n.id, data: { kind: n.kind, tag: n.tag ?? n.kind, status, summary }, deletable: editable };
    });
  }, [graph, sim, sel, editable, p]);

  const rfEdges: Edge[] = useMemo(
    () =>
      (graph?.edges ?? []).map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        animated: true,
        selected: sel?.kind === 'edge' && sel.id === e.id,
        deletable: editable,
        label: sim?.edges[e.id] ? `${fmt(sim.edges[e.id].Q, 0)} m³/d` : undefined,
        labelStyle: { fontFamily: 'var(--mono)', fontSize: 10, fill: '#1a2633' },
        labelBgStyle: { fill: '#eef1f4' },
      })),
    [graph, sim, sel, editable],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!graph) return;
      const moving = changes.some((c) => c.type === 'position' && c.dragging);
      const base = dragNodes ?? rfNodes;
      const next = applyNodeChanges(changes, base);
      if (moving) {
        setDragNodes(next);
        return;
      }
      setDragNodes(null);
      const posChanged = changes.some((c) => c.type === 'position' && !c.dragging);
      const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      if (posChanged || removed.length) {
        const pos = new Map(next.map((n) => [n.id, n.position]));
        setGraph({
          nodes: graph.nodes.filter((n) => !removed.includes(n.id)).map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })),
          edges: graph.edges.filter((e) => !removed.includes(e.from) && !removed.includes(e.to)),
        });
        if (sel?.kind === 'node' && removed.includes(sel.id)) setSel(null);
      }
    },
    [graph, rfNodes, dragNodes, setGraph, sel],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!graph) return;
      const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      if (removed.length) setGraph({ ...graph, edges: graph.edges.filter((e) => !removed.includes(e.id)) });
    },
    [graph, setGraph],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!graph || !editable || !c.source || !c.target || c.source === c.target) return;
      if (graph.edges.some((e) => e.from === c.source && e.to === c.target)) return;
      setGraph({ ...graph, edges: [...graph.edges, { id: `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e5)}`, from: c.source, to: c.target }] });
    },
    [graph, setGraph, editable],
  );

  const addUnit = useCallback(
    (kind: UnitType, position?: { x: number; y: number }) => {
      if (!graph || !p || !editable) return;
      const node = makeNode(kind, p.datasheet.Q, graph.nodes);
      const units = graph.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge').length;
      node.position = position ?? { x: 170 + units * 145, y: 120 + (units % 2) * 70 };
      setGraph({ ...graph, nodes: [...graph.nodes, node] });
      setSel({ kind: 'node', id: node.id });
    },
    [graph, p, editable, setGraph],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/ee-unit') as UnitType;
    if (!kind) return;
    addUnit(kind, rf.screenToFlowPosition({ x: e.clientX - 60, y: e.clientY - 40 }));
  };

  const autoConnect = () => {
    if (!graph) return;
    const units = graph.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge').sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
    const chain = [graph.nodes.find((n) => n.kind === 'influent')!, ...units, graph.nodes.find((n) => n.kind === 'discharge')!];
    setGraph({ ...graph, edges: chain.slice(0, -1).map((n, i) => ({ id: `p-auto-${i}-${Date.now().toString(36)}`, from: n.id, to: chain[i + 1].id })) });
  };

  if (!p || !graph || !basis) return <div className="page">No active project.</div>;

  const selectedNode = sel?.kind === 'node' ? graph.nodes.find((n) => n.id === sel.id) : undefined;
  const selectedEdgeStream = sel?.kind === 'edge' ? sim?.edges[sel.id] : undefined;
  const weeks = constructionWeeks(p);
  const capexToCharge = (() => {
    if (!sim) return 0;
    if (!p.built) return sim.capex;
    return Object.entries(sim.nodes).reduce((a, [id, n]) => {
      const prev = p.built!.nodes.find((b) => b.id === id);
      return a + (!prev || prev.kind !== n.node.kind || JSON.stringify(prev.params) !== JSON.stringify(n.node.params) ? n.capex * RETROFIT_PREMIUM : 0);
    }, 0);
  })();

  const doCommission = () => {
    if (!sim?.ok) return;
    const ok = confirm(`${p.built ? 'Retrofit' : 'Build'} and commission?\n\nConstruction: ${rm(capexToCharge)} paid now · ${weeks} weeks\nCommissioning in week ${g.week + weeks}, tested on the REAL wastewater, not your design basis.`);
    if (!ok) return;
    if (g.startConstruction()) go('hq');
  };

  return (
    <div className="studio">
      <aside className="palette">
        <h2 style={{ fontSize: 12 }}>Unit processes</h2>
        <p className="muted" style={{ fontSize: 11, marginTop: -4 }}>Drag onto the canvas, or click to add.</p>
        {(['physical', 'chemical', 'biological'] as const).map((cat) => (
          <div key={cat}>
            <div className="nav-section" style={{ padding: '8px 2px 4px', color: CATEGORY_COLOR[cat] }}>
              {cat}
            </div>
            {UNIT_ORDER.filter((t) => CATALOGUE[t].category === cat).map((t) => (
              <div
                key={t}
                className="palette-item"
                draggable={editable}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/ee-unit', t);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addUnit(t)}
                title={CATALOGUE[t].summary}
                style={{ background: '#f4f6f8', color: 'var(--ink)', opacity: editable ? 1 : 0.5 }}
              >
                <UnitSymbol type={t} accent={CATEGORY_COLOR[cat]} />
                {CATALOGUE[t].name}
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <button className="btn sm" style={{ width: '100%' }} onClick={autoConnect} disabled={!editable} title="Connect units left-to-right in a single line">
            Auto-connect in series
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>Connect outlet (right) to inlet (left). Select + Delete to remove.</p>
      </aside>

      <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow
          nodes={dragNodes ?? rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSel({ kind: 'node', id: n.id })}
          onEdgeClick={(_, e) => setSel({ kind: 'edge', id: e.id })}
          onPaneClick={() => setSel(null)}
          nodesDraggable
          nodesConnectable={editable}
          deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
          minZoom={0.3}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background variant={BackgroundVariant.Lines} gap={24} color="#dce1e7" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={120} color="#cdd4dc" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable style={{ background: '#f6f8fa' }} nodeColor="#9aa7b4" />
        </ReactFlow>
        <div className="title-block">
          <div>
            <span>PROCESS FLOW DIAGRAM</span>
            <span>REV {String.fromCharCode(65 + Math.min(p.attempts, 25))}</span>
          </div>
          <div>
            <span>CLIENT</span>
            <span>{p.enquiry.company}</span>
          </div>
          <div>
            <span>DESIGN FLOW</span>
            <span>{p.datasheet.Q} m³/d · PF {p.datasheet.peakFactor}</span>
          </div>
          <div>
            <span>DISCHARGE</span>
            <span>{STANDARDS.standards[p.enquiry.standard].label}</span>
          </div>
          <div>
            <span>BY</span>
            <span>{g.companyName}</span>
          </div>
        </div>
        {p.status === 'failed' && (
          <div className="note error" style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 5, background: '#fff', color: 'var(--ink)' }}>
            Retrofit mode — the last commissioning failed. Modified or new units are charged at a {Math.round((RETROFIT_PREMIUM - 1) * 100)} % rework premium.
          </div>
        )}
      </div>

      <aside className="inspector">
        {selectedNode && selectedNode.kind !== 'influent' && selectedNode.kind !== 'discharge' ? (
          <UnitInspector node={selectedNode} editable={editable} sim={sim} onChange={(params) => setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === selectedNode.id ? { ...n, params } : n)) })} />
        ) : selectedEdgeStream ? (
          <StreamTable title="Pipe stream" s={selectedEdgeStream} />
        ) : selectedNode?.kind === 'influent' ? (
          <StreamTable title="Raw wastewater (design basis)" s={basis.stream} />
        ) : (
          <>
            <h2>Design summary</h2>
            <div className="calc">
              <span>CAPEX (this design)</span>
              <span>{rm(sim?.capex ?? 0)}</span>
            </div>
            {p.built && (
              <div className="calc">
                <span>Retrofit charge</span>
                <span>{rm(capexToCharge)}</span>
              </div>
            )}
            <div className="calc">
              <span>Contract value</span>
              <span>{rm(p.enquiry.contractValue)}</span>
            </div>
            <div className="calc">
              <span>Projected margin</span>
              <span style={{ color: p.enquiry.contractValue - p.spent.lab - p.spent.capex - capexToCharge < 0 ? 'var(--alarm)' : undefined }}>{rm(p.enquiry.contractValue - p.spent.lab - p.spent.capex - capexToCharge)}</span>
            </div>
            <div className="calc">
              <span>Cash available to build</span>
              <span style={{ color: g.cash + (p.built ? 0 : p.enquiry.contractValue * 0.6) < capexToCharge ? 'var(--alarm)' : undefined }}>{rm(g.cash + (p.built ? 0 : p.enquiry.contractValue * 0.6))}</span>
            </div>
            <div className="calc">
              <span>OPEX estimate</span>
              <span style={{ color: (sim?.opexRMd ?? 0) > p.enquiry.opexLimitRMd ? 'var(--warn)' : undefined }}>
                {rm(sim?.opexRMd ?? 0)}/d (max {rm(p.enquiry.opexLimitRMd)})
              </span>
            </div>
            <div className="calc">
              <span>Energy</span>
              <span>{fmt(sim?.energy_kWhd ?? 0, 0)} kWh/d</span>
            </div>
            <div className="calc">
              <span>Sludge (dry)</span>
              <span>{fmt(sim?.sludgeKgD ?? 0, 0)} kg/d</span>
            </div>
            <div className="calc">
              <span>Footprint</span>
              <span>{fmt(sim?.footprint ?? 0, 0)} m²</span>
            </div>
            <div className="calc">
              <span>Construction time</span>
              <span>{weeks} weeks</span>
            </div>
            {(sim?.chemicals.length ?? 0) > 0 && <h2 style={{ marginTop: 14, fontSize: 12 }}>Chemicals</h2>}
            {sim?.chemicals.map((c) => (
              <div className="calc" key={c.name}>
                <span>{c.name}</span>
                <span>
                  {fmt(c.kgPerDay, 1)} kg/d · {rm(c.costRMd)}/d
                </span>
              </div>
            ))}
            {sim && !sim.balance?.ok && sim.ok && <div className="note error">Mass balance did not close — please report this design.</div>}
            {sim?.errors.map((e) => (
              <div key={e.code + e.text} className={`note ${e.level}`}>
                {e.text}
              </div>
            ))}
            <button className="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={!editable || !sim?.ok} onClick={doCommission}>
              {p.built ? 'Retrofit & recommission' : 'Build & commission'} ▸
            </button>
            {basis.assumptions.length > 0 && (
              <div className="note warn" style={{ marginTop: 10 }}>
                Predictions rely on {basis.assumptions.length} assumption(s) — see the Laboratory.
              </div>
            )}
            <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Select a unit to size it, or a pipe to inspect its stream.</p>
          </>
        )}
      </aside>

      <section className="drawer">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Predicted effluent vs {STANDARDS.standards[p.enquiry.standard].label}</h2>
          {report && <span className={`pill ${report.pass ? 'pass' : 'fail'}`}>{report.pass ? 'PREDICTED PASS' : `${report.checks.filter((c) => !c.pass).length} PARAMETER(S) FAIL`}</span>}
        </div>
        {!report && <p className="muted">Connect raw wastewater → units → final discharge to see the predicted effluent.</p>}
        {report && <ComplianceTable checks={report.checks} />}
      </section>
    </div>
  );
}

function UnitInspector({ node, editable, sim, onChange }: { node: PNode; editable: boolean; sim: ReturnType<typeof simulate> | null; onChange: (p: PNode['params']) => void }) {
  const def = CATALOGUE[node.kind as UnitType];
  const ns = sim?.nodes[node.id];
  return (
    <>
      <div className="mono" style={{ fontSize: 11, color: CATEGORY_COLOR[def.category], textTransform: 'uppercase' }}>
        {def.category}
      </div>
      <h2 style={{ marginBottom: 4 }}>
        {def.name} — {node.tag}
      </h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {def.summary}
      </p>
      {def.params.map((d) => (
        <div key={d.key} className="field">
          <label>
            {d.label} {d.unit && `(${d.unit})`}
          </label>
          {d.options ? (
            <select disabled={!editable} value={String(node.params[d.key])} onChange={(e) => onChange({ ...node.params, [d.key]: e.target.value })}>
              {d.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              disabled={!editable}
              min={d.min}
              max={d.max}
              step={d.step}
              value={Number(node.params[d.key])}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChange({ ...node.params, [d.key]: Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v)) });
              }}
            />
          )}
          {d.help && <span className="help">{d.help}</span>}
        </div>
      ))}
      {ns && (
        <>
          <h2 style={{ fontSize: 12, marginTop: 14 }}>Calculated performance</h2>
          {Object.values(ns.result.calcs).map((c) => (
            <div className="calc" key={c.label}>
              <span>{c.label}</span>
              <span>
                {fmt(c.value, c.digits ?? 1)} {c.unit}
              </span>
            </div>
          ))}
          <div className="calc">
            <span>CAPEX</span>
            <span>{rm(ns.capex)}</span>
          </div>
          <div className="calc">
            <span>OPEX</span>
            <span>{rm(ns.opexRMd)}/d</span>
          </div>
          <div className="calc">
            <span>Footprint</span>
            <span>{fmt(ns.footprint, 0)} m²</span>
          </div>
          {ns.result.notes.map((n) => (
            <div key={n.code} className={`note ${n.level}`}>
              {n.text}
            </div>
          ))}
          <h2 style={{ fontSize: 12, marginTop: 14 }}>Outlet</h2>
          <StreamRows s={ns.result.out} />
        </>
      )}
      {!ns && <p className="muted">Connect this unit into the train to see its performance.</p>}
    </>
  );
}

function StreamRows({ s }: { s: Stream }) {
  const m = measure(s);
  const rows: [string, number, string][] = [
    ['Flow', s.Q, 'm³/d'],
    ['pH', m.pH, ''],
    ['COD', m.COD, 'mg/L'],
    ['BOD₅', m.BOD5, 'mg/L'],
    ['TSS', m.TSS, 'mg/L'],
    ['O&G', m.OG, 'mg/L'],
    ['NH₄-N', m.NH3N, 'mg/L'],
    ['Ni (total)', m.Ni, 'mg/L'],
    ['Cu (total)', m.Cu, 'mg/L'],
    ['Zn (total)', m.Zn, 'mg/L'],
    ['Al', m.Al, 'mg/L'],
    ['Fe', m.Fe, 'mg/L'],
  ];
  return (
    <>
      {rows.map(([l, v, u]) => (
        <div className="calc" key={l}>
          <span>{l}</span>
          <span>
            {fmt(v, l === 'pH' ? 2 : 1)} {u}
          </span>
        </div>
      ))}
    </>
  );
}

function StreamTable({ title, s }: { title: string; s: Stream }) {
  return (
    <>
      <h2>{title}</h2>
      <StreamRows s={s} />
      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Dissolved / particulate metals: Ni {fmt(s.dissolved.Ni, 2)} / {fmt(s.precipitated.Ni, 2)}, Cu {fmt(s.dissolved.Cu, 2)} / {fmt(s.precipitated.Cu, 2)}, Zn {fmt(s.dissolved.Zn, 2)} / {fmt(s.precipitated.Zn, 2)} mg/L
      </p>
    </>
  );
}

export function ComplianceTable({ checks }: { checks: ReturnType<typeof evaluate>['checks'] }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Parameter</th>
          <th style={{ textAlign: 'right' }}>Effluent</th>
          <th style={{ textAlign: 'right' }}>Limit</th>
          <th>Result</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {[...checks]
          .sort((a, b) => Number(a.pass) - Number(b.pass))
          .map((c) => (
            <tr key={c.param}>
              <td>{c.label}</td>
              <td className="num">
                {fmt(c.value, c.param === 'pH' ? 2 : c.value < 10 ? 2 : 0)} {c.unit}
              </td>
              <td className="num muted">{c.limit.min !== undefined ? `${c.limit.min}–${c.limit.max}` : `≤ ${c.limit.max}`}</td>
              <td>
                <span className={`pill ${c.pass ? 'pass' : 'fail'}`}>{c.pass ? 'PASS' : 'FAIL'}</span>
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                {c.why}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
