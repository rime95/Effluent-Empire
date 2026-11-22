import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  MarkerType,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { engineersBusy, useActiveProject, useGame } from '../../game/store';
import { projectSlots } from '../../game/staff';
import { designBasis } from '../../game/lab';
import { constructionWeeks, makeNode, retrofitCharge, RETROFIT_PREMIUM, type Project } from '../../game/project';
import type { Plant } from '../../game/operations';
import { currentInfluent, upgradeQuote, VO_MARKUP } from '../../game/upgrade';
import { simulate } from '../../simulation/treatment/graph';
import { CATALOGUE, PRICES, UnitType } from '../../simulation/treatment/catalogue';
import { PNode, PortId, ProcessGraph, SimResult } from '../../simulation/treatment/graph';
import { evaluate, measure, STANDARDS } from '../../simulation/treatment/compliance';
import { Stream } from '../../simulation/core/stream';
import { DisposalSymbol, UnitSymbol } from '../components/Symbols';
import { CATEGORY_COLOR, edgeTypes, nodeTypes, type DosingTag, type UnitNodeData } from './nodes';
import { NumberField } from './NumberField';
import { PidSheet } from './PidSheet';
import { applicableInstruments, hasInst, STANDBY_BLOWER_EXTRA_RM, type InstKey } from '../../simulation/treatment/instrumentation';
import { useHistory } from './useHistory';
import { useSimulation } from './useSimulation';
import type { Screen } from '../App';
import { fmt, rm } from '../format';

const UNIT_ORDER: UnitType[] = ['eq', 'oilSep', 'clarifier', 'sandFilter', 'carbon', 'crReduction', 'neutralisation', 'precipitation', 'coagulation', 'activatedSludge', 'thickener', 'filterPress', 'splitter', 'mixer'];
/** kinds that may receive a sludge line */
const SLUDGE_RECEIVERS: PNode['kind'][] = ['thickener', 'filterPress', 'disposal', 'mixer'];
const GRID = 20;
/** fixed end points (one inlet, one discharge) — cannot be deleted */
const isTerminal = (n: PNode) => n.kind === 'influent' || n.kind === 'discharge';
const isNonUnit = (n: PNode) => isTerminal(n) || n.kind === 'disposal';
/** Short reagent names for the dosing-package labels on the PFD. */
function shortChem(name: string): string {
  if (/NaOH/.test(name)) return 'NaOH';
  if (/lime|Ca\(OH\)/i.test(name)) return 'Lime';
  if (/H₂SO₄|H2SO4|sulph|sulfur/i.test(name)) return 'H₂SO₄';
  if (/FeCl|ferric/i.test(name)) return 'FeCl₃';
  if (/alum/i.test(name)) return 'Alum';
  if (/PAC|polyalumin/i.test(name)) return 'PAC';
  if (/polymer|PAM/i.test(name)) return 'Polymer';
  if (/bisulfite|S₂O₅|metabisul/i.test(name)) return 'SMBS';
  return name.split(/[ (]/)[0];
}

/** Stream numbers in flow order (topological when a simulation is available), so the PFD reads left to right. */
function numberStreams(g: ProcessGraph, order: string[] | undefined): Map<string, number> {
  const pos = new Map(g.nodes.map((n, i) => [n.id, defaultPos(n, i)]));
  const seq = order && order.length ? order : [...g.nodes].sort((a, b) => (pos.get(a.id)!.x - pos.get(b.id)!.x)).map((n) => n.id);
  const map = new Map<string, number>();
  let k = 1;
  for (const id of seq) {
    const outs = g.edges.filter((e) => e.from === id).sort((a, b) => (pos.get(a.to)?.y ?? 0) - (pos.get(b.to)?.y ?? 0));
    for (const e of outs) if (!map.has(e.id)) map.set(e.id, k++);
  }
  for (const e of g.edges) if (!map.has(e.id)) map.set(e.id, k++);
  return map;
}

const newEdgeId = () => `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export function Studio(props: { go: (s: Screen) => void }) {
  return (
    <ReactFlowProvider>
      <StudioInner {...props} />
    </ReactFlowProvider>
  );
}

function defaultPos(n: PNode, i: number) {
  return n.position ?? (n.kind === 'influent' ? { x: 0, y: 160 } : n.kind === 'discharge' ? { x: 1100, y: 160 } : { x: 160 + i * 190, y: 160 });
}

/**
 * An operating plant shown in the Studio as a read-only project: the as-built drawing, or the upgrade draft
 * (editable, status 'design') / upgrade under construction. Only the fields the Studio reads are filled.
 */
function plantAsProject(pl: Plant): Project {
  const Q = Math.round(currentInfluent(pl).Q);
  return {
    id: pl.id,
    status: pl.upgrade?.phase === 'draft' ? 'design' : 'completed',
    graph: pl.upgrade?.graph ?? pl.graph,
    built: pl.graph,
    attempts: 0,
    datasheet: { Q, peakFactor: Math.round(pl.trueStream.peakFactor * 10) / 10, T: pl.trueStream.T, pH: pl.trueStream.pH, COD: 0, TSS: 0, OG: 0 },
    enquiry: { company: pl.company, standard: pl.standard, contractValue: 0, opexLimitRMd: Infinity },
    spent: { lab: 0, capex: pl.capex },
    labQueue: [],
    reports: [],
  } as unknown as Project;
}

function StudioInner({ go }: { go: (s: Screen) => void }) {
  const proj = useActiveProject();
  const plant = useGame((s) => (s.studioPlantId ? (s.plants.find((x) => x.id === s.studioPlantId && x.status === 'operating') ?? null) : null));
  const setUpgradeGraph = useGame((s) => s.setUpgradeGraph);
  const plantGraphSetter = useCallback((g: ProcessGraph) => plant && setUpgradeGraph(plant.id, g), [plant?.id, setUpgradeGraph]); // eslint-disable-line react-hooks/exhaustive-deps
  const plantProj = useMemo(() => (plant ? plantAsProject(plant) : null), [plant]);
  const p = plantProj ?? proj;
  const projSetGraph = useGame((s) => s.setGraph);
  const storeSetGraph = plant ? plantGraphSetter : projSetGraph;
  const startConstruction = useGame((s) => s.startConstruction);
  const week = useGame((s) => s.week);
  const cash = useGame((s) => s.cash);
  const companyName = useGame((s) => s.companyName);
  const rf = useReactFlow();

  const editable = !!p && (p.status === 'design' || p.status === 'failed');
  const hist = useHistory<ProcessGraph>(p?.graph ?? { nodes: [], edges: [] });
  const draft = hist.state;
  const setDraft = hist.set;

  // a different project (or a project leaving/entering design) → reload the draft from the store
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const id = p ? `${p.id}:${p.status}:${p.attempts}` : null;
    if (id !== loadedFor.current) {
      loadedFor.current = id;
      if (p) hist.reset(p.graph);
    }
  }, [p, hist.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // commit the draft to the store, debounced (the store write triggers autosave + app re-render)
  const pending = useRef<ProcessGraph | null>(null);
  const flush = useCallback(() => {
    if (pending.current) {
      storeSetGraph(pending.current);
      pending.current = null;
    }
  }, [storeSetGraph]);
  useEffect(() => {
    if (!p || !editable || draft === p.graph) return;
    pending.current = draft;
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [draft, p, editable, flush]);
  useEffect(() => () => flush(), [flush]);

  // an operating plant is shown on its real influent at today's production level; a project on the lab design basis
  const plantBasis = useMemo(() => (plant ? { stream: currentInfluent(plant), assumptions: [] as string[] } : null), [plant?.trueStream, plant?.history.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const projBasis = useMemo(() => (proj ? designBasis(proj.datasheet) : null), [proj?.datasheet]); // eslint-disable-line react-hooks/exhaustive-deps
  const basis = plant ? plantBasis : projBasis;
  const { sim, busy, error: simError } = useSimulation(p ? draft : null, basis?.stream ?? null);
  const report = useMemo(() => (sim?.effluent && p ? evaluate(sim.effluent, p.enquiry.standard, sim) : null), [sim, p?.enquiry.standard]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- selection & live drag positions (local; positions are written to the draft on drag stop)
  const [selNodes, setSelNodes] = useState<Set<string>>(new Set());
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set());
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const [snap, setSnap] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // stable per-node objects: only nodes whose data / position / selection changed get a new object
  const cache = useRef(new Map<string, Node>());
  const rfNodes: Node[] = useMemo(() => {
    if (!p) return [];
    const next = new Map<string, Node>();
    const out = draft.nodes.map((n, i) => {
      const position = dragPos[n.id] ?? defaultPos(n, i);
      const selected = selNodes.has(n.id);
      let type: string;
      let data: Record<string, unknown>;
      if (n.kind === 'disposal') {
        type = 'terminal';
        const d = sim?.disposal.find((x) => x.id === n.id);
        data = { kind: 'disposal', tag: n.tag ?? 'SD', label: 'Sludge disposal', sub: d ? `${fmt(d.wetKgD, 0)} kg/d wet · ${rm(d.costRMd)}/d` : 'connect a sludge line' };
      } else if (isTerminal(n)) {
        type = 'terminal';
        data = { kind: n.kind, label: n.kind === 'influent' ? 'RAW WASTEWATER' : 'FINAL DISCHARGE', sub: n.kind === 'influent' ? `${p.datasheet.Q} m³/d` : `Standard ${p.enquiry.standard}` };
      } else {
        const ns = sim?.nodes[n.id];
        const notes = ns?.result.notes ?? [];
        const status: UnitNodeData['status'] = !ns ? 'idle' : notes.some((x) => x.level === 'error') ? 'error' : notes.some((x) => x.level === 'warn') ? 'warn' : 'ok';
        const c = ns?.result.calcs;
        const summary = c?.sor ? `SOR ${fmt(c.sor.value, 2)} m/h` : c?.pH && n.kind !== 'activatedSludge' ? `pH ${fmt(c.pH.value, 1)}` : c?.mlss ? `MLSS ${fmt(c.mlss.value, 0)}` : c?.rate ? `${fmt(c.rate.value, 1)} m/h` : c?.hrt ? `HRT ${fmt(c.hrt.value, 1)} h` : undefined;
        type = 'unit';
        const dosing: DosingTag[] = (ns?.result.chemicals ?? []).filter((c) => c.kgPerDay > 0.01).map((c) => ({ label: shortChem(c.name), kgd: c.kgPerDay }));
        const rasPort = n.kind === 'clarifier' && draft.edges.some((e) => e.to === n.id && draft.nodes.find((x) => x.id === e.from)?.kind === 'activatedSludge');
        data = { kind: n.kind, tag: n.tag ?? n.kind, status, summary, dosing, sludgeKgD: ns?.sludgeKgD, sludgeRouted: draft.edges.some((e) => e.from === n.id && e.fromPort === 'sludge'), flip: !!n.flip, rasPort };
      }
      const prev = cache.current.get(n.id);
      const sameData = prev && JSON.stringify(prev.data) === JSON.stringify(data);
      const node: Node =
        prev && sameData && prev.selected === selected && prev.position.x === position.x && prev.position.y === position.y && prev.deletable === (editable && !isTerminal(n)) && prev.type === type
          ? prev
          : { id: n.id, type, position, selected, data: sameData ? prev!.data : data, deletable: editable && !isTerminal(n) };
      next.set(n.id, node);
      return node;
    });
    cache.current = next;
    return out;
  }, [draft, sim, selNodes, dragPos, editable, p]);

  const streamNos = useMemo(() => numberStreams(draft, sim?.order), [draft, sim?.order]);
  const [drawerTab, setDrawerTab] = useState<'compliance' | 'streams'>('compliance');
  const [sheet, setSheet] = useState<'pfd' | 'pid'>('pfd');
  const rfEdges: Edge[] = useMemo(
    () =>
      draft.edges.map((e) => ({
        id: e.id,
        type: 'pipe',
        source: e.from,
        sourceHandle: e.fromPort ?? (draft.nodes.find((n) => n.id === e.from)?.kind === 'splitter' ? 'a' : 'out'),
        target: e.to,
        selected: selEdges.has(e.id),
        deletable: editable,
        markerEnd: { type: MarkerType.ArrowClosed, color: e.fromPort === 'sludge' || e.fromPort === 'ras' ? '#8b5a2b' : '#00a9c8', width: 14, height: 14 },
        data: { no: streamNos.get(e.id), q: sim?.edges[e.id] ? `${fmt(sim.edges[e.id].Q, sim.edges[e.id].Q < 10 ? 2 : 0)} m³/d` : undefined, service: e.fromPort === 'ras' ? ('ras' as const) : e.fromPort === 'sludge' ? ('sludge' as const) : sim?.tears.includes(e.id) ? ('recycle' as const) : ('process' as const) },
      })),
    [draft.edges, sim, selEdges, editable, streamNos],
  );

  // ---------- change handlers
  const removeNodes = useCallback(
    (ids: string[]) => {
      if (!editable || !ids.length) return;
      setDraft((g) => ({ nodes: g.nodes.filter((n) => !ids.includes(n.id) || isTerminal(n)), edges: g.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)) }));
      setSelNodes(new Set());
    },
    [editable, setDraft],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let sel: Set<string> | null = null;
      const live: Record<string, { x: number; y: number }> = {};
      const done: Record<string, { x: number; y: number }> = {};
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === 'select') {
          sel = sel ?? new Set(selNodes);
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        } else if (c.type === 'position' && c.position) {
          if (c.dragging) live[c.id] = c.position;
          else done[c.id] = c.position;
        } else if (c.type === 'position' && c.dragging === false) {
          const cur = dragPos[c.id];
          if (cur) done[c.id] = cur;
        } else if (c.type === 'remove') removed.push(c.id);
      }
      if (sel) setSelNodes(sel);
      if (Object.keys(live).length) setDragPos((d) => ({ ...d, ...live }));
      if (Object.keys(done).length) {
        setDraft((g) => ({ ...g, nodes: g.nodes.map((n) => (done[n.id] ? { ...n, position: done[n.id] } : n)) }), `move:${Object.keys(done).sort().join(',')}`);
        setDragPos((d) => {
          const n = { ...d };
          for (const id of Object.keys(done)) delete n[id];
          return n;
        });
      }
      if (removed.length) removeNodes(removed);
    },
    [selNodes, dragPos, setDraft, removeNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      let sel: Set<string> | null = null;
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === 'select') {
          sel = sel ?? new Set(selEdges);
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        } else if (c.type === 'remove') removed.push(c.id);
      }
      if (sel) setSelEdges(sel);
      if (removed.length && editable) {
        setDraft((g) => ({ ...g, edges: g.edges.filter((e) => !removed.includes(e.id)) }));
        setSelEdges(new Set());
      }
    },
    [selEdges, editable, setDraft],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!editable || !c.source || !c.target || c.source === c.target) return;
      const port = (c.sourceHandle ?? 'out') as PortId;
      setDraft((g) => (g.edges.some((e) => e.from === c.source && e.to === c.target && (e.fromPort ?? 'out') === port) ? g : { ...g, edges: [...g.edges, { id: newEdgeId(), from: c.source!, to: c.target!, ...(port !== 'out' ? { fromPort: port } : {}) }] }));
    },
    [editable, setDraft],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const to = draft.nodes.find((n) => n.id === c.target);
      if (!to || to.kind === 'influent') return false;
      if (c.sourceHandle === 'ras') return to.kind === 'activatedSludge';
      const sludge = c.sourceHandle === 'sludge';
      if (sludge) return SLUDGE_RECEIVERS.includes(to.kind);
      return to.kind !== 'disposal';
    },
    [draft.nodes],
  );

  const addUnit = useCallback(
    (kind: UnitType | 'disposal', position?: { x: number; y: number }) => {
      if (!p || !editable) return;
      const node = makeNode(kind, p.datasheet.Q, draft.nodes);
      const isSludgeKind = (k: string) => k === 'disposal' || CATALOGUE[k as UnitType]?.category === 'sludge';
      // process units go along the main line, sludge units along a second row; each row spaced so nozzles never overlap
      const units = draft.nodes.filter((n) => !isNonUnit(n) && !isSludgeKind(n.kind)).length;
      const sludgeUnits = draft.nodes.filter((n) => isSludgeKind(n.kind)).length;
      const pos = position ?? (isSludgeKind(kind) ? { x: 360 + sludgeUnits * 190, y: 420 } : { x: 180 + units * 190, y: 160 });
      node.position = snap ? { x: Math.round(pos.x / GRID) * GRID, y: Math.round(pos.y / GRID) * GRID } : pos;
      setDraft((g) => ({ ...g, nodes: [...g.nodes, node] }));
      setSelNodes(new Set([node.id]));
      setSelEdges(new Set());
    },
    [p, editable, draft.nodes, snap, setDraft],
  );

  // ---------- clipboard (copy / paste / duplicate)
  const clip = useRef<ProcessGraph | null>(null);
  const copySel = useCallback(() => {
    const ids = new Set([...selNodes].filter((id) => draft.nodes.some((n) => n.id === id && !isTerminal(n))));
    if (!ids.size) return false;
    clip.current = { nodes: draft.nodes.filter((n) => ids.has(n.id)), edges: draft.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
    return true;
  }, [selNodes, draft]);
  const paste = useCallback(() => {
    if (!clip.current || !p || !editable) return;
    const src = clip.current;
    setDraft((g) => {
      const map = new Map<string, string>();
      const nodes = [...g.nodes];
      for (const n of src.nodes) {
        const fresh = makeNode(n.kind, p.datasheet.Q, nodes);
        const pos = n.position ?? { x: 200, y: 200 };
        const added: PNode = { ...fresh, params: { ...n.params }, position: { x: pos.x + 40, y: pos.y + 40 } };
        map.set(n.id, added.id);
        nodes.push(added);
      }
      const edges = [...g.edges, ...src.edges.map((e) => ({ id: newEdgeId(), from: map.get(e.from)!, to: map.get(e.to)!, ...(e.fromPort ? { fromPort: e.fromPort } : {}) }))];
      setSelNodes(new Set(map.values()));
      clip.current = { nodes: src.nodes.map((n) => ({ ...n, position: n.position ? { x: n.position.x + 40, y: n.position.y + 40 } : n.position })), edges: src.edges };
      return { nodes, edges };
    });
  }, [p, editable, setDraft]);

  // ---------- keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (editable) hist.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        if (editable) hist.redo();
      } else if (k === 'c') {
        copySel();
      } else if (k === 'v') {
        e.preventDefault();
        paste();
      } else if (k === 'd') {
        e.preventDefault();
        if (copySel()) paste();
      } else if (k === 'a') {
        e.preventDefault();
        setSelNodes(new Set(draft.nodes.filter((n) => !isTerminal(n)).map((n) => n.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, hist.undo, hist.redo, copySel, paste, draft.nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/ee-unit') as UnitType | 'disposal';
    if (!kind) return;
    addUnit(kind, rf.screenToFlowPosition({ x: e.clientX - 60, y: e.clientY - 40 }));
  };

  const autoConnect = () => {
    setDraft((g) => {
      const units = g.nodes.filter((n) => !isNonUnit(n) && !['thickener', 'filterPress'].includes(n.kind)).sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
      const chain = [g.nodes.find((n) => n.kind === 'influent')!, ...units, g.nodes.find((n) => n.kind === 'discharge')!];
      return { ...g, edges: chain.slice(0, -1).map((n, i) => ({ id: `p-auto-${i}-${Date.now().toString(36)}`, from: n.id, to: chain[i + 1].id })) };
    });
  };

  const toggleInst = useCallback(
    (id: string, key: InstKey, on: boolean) => {
      setDraft((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, inst: { ...(n.inst ?? {}), [key]: on } } : n)) }));
    },
    [setDraft],
  );

  const updateParams = useCallback(
    (id: string, key: string, value: number | string) => {
      setDraft((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n)) }), `param:${id}:${key}`);
    },
    [setDraft],
  );

  if (!p || !basis)
    return (
      <div className="page">
        <h1>Engineering Studio</h1>
        <p className="muted">No active project. Pick a project in the sidebar, or open an operating plant&apos;s PFD from Plants &amp; O&amp;M or the sidebar.</p>
      </div>
    );

  const single = selNodes.size === 1 ? draft.nodes.find((n) => selNodes.has(n.id)) : undefined;
  const singleEdge = selNodes.size === 0 && selEdges.size === 1 ? [...selEdges][0] : undefined;
  const selectedEdgeStream = singleEdge ? sim?.edges[singleEdge] : undefined;
  const weeks = constructionWeeks(p);
  const capexToCharge = !sim ? 0 : !p.built ? sim.capex : retrofitCharge(p.built, draft, sim);

  const doCommission = () => {
    if (!sim?.ok) return;
    flush();
    if (draft !== p.graph) storeSetGraph(draft);
    const ok = confirm(`${p.built ? 'Retrofit' : 'Build'} and commission?\n\nConstruction: ${rm(capexToCharge)} paid weekly over ${weeks} weeks${p.built ? '' : ` · client pays ${rm(p.enquiry.contractValue * 0.6)} in progress claims`}\nCommissioning in week ${week + weeks}, tested on the REAL wastewater, not your design basis.`);
    if (!ok) return;
    if (startConstruction()) go('hq');
  };

  const menuNode = menu ? draft.nodes.find((n) => n.id === menu.id) : undefined;

  return (
    <div className="studio">
      <aside className="palette">
        <h2 style={{ fontSize: 12 }}>Unit processes</h2>
        <p className="muted" style={{ fontSize: 11, marginTop: -4 }}>Drag onto the canvas, or click to add.</p>
        {(['physical', 'chemical', 'biological', 'sludge', 'hydraulic'] as const).map((cat) => (
          <div key={cat}>
            <div className="nav-section" style={{ padding: '8px 2px 4px', color: CATEGORY_COLOR[cat] }}>
              {cat}
            </div>
            {UNIT_ORDER.filter((t) => CATALOGUE[t].category === cat).map((t) => (
              <PaletteItem key={t} type={t} editable={editable} onAdd={addUnit} />
            ))}
            {cat === 'sludge' && <DisposalPaletteItem editable={editable} onAdd={() => addUnit('disposal')} />}
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <button className="btn sm" style={{ width: '100%' }} onClick={autoConnect} disabled={!editable} title="Connect units left-to-right in a single line">
            Auto-connect in series
          </button>
        </div>
        <div className="muted shortcut-help">
          <div>
            <kbd>Drag</kbd> outlet → inlet to pipe
          </div>
          <div>
            <kbd>Shift</kbd>+drag box-select · <kbd>Ctrl</kbd>+click add
          </div>
          <div>
            <kbd>Del</kbd> delete · <kbd>Ctrl Z</kbd>/<kbd>Y</kbd> undo/redo
          </div>
          <div>
            <kbd>Ctrl C</kbd>/<kbd>V</kbd>/<kbd>D</kbd> copy/paste/duplicate
          </div>
          <div>
            <kbd>Right-click</kbd> a unit for more
          </div>
        </div>
      </aside>

      <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => menu && setMenu(null)}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            if (!editable || n.type === 'terminal') return;
            const box = (e.currentTarget as HTMLElement).closest('.canvas-wrap')!.getBoundingClientRect();
            setSelNodes(new Set([n.id]));
            setMenu({ x: e.clientX - box.left, y: e.clientY - box.top, id: n.id });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
          nodesDraggable={true}
          nodesConnectable={editable}
          elementsSelectable
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Control', 'Meta']}
          deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
          snapToGrid={snap}
          snapGrid={[GRID, GRID]}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
          minZoom={0.3}
          onlyRenderVisibleElements
        >
          <Background variant={BackgroundVariant.Lines} gap={GRID} color="#dce1e7" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={GRID * 5} color="#cdd4dc" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable style={{ background: '#f6f8fa' }} nodeColor="#9aa7b4" />
        </ReactFlow>

        <div className="sheet-tabs">
          <button className={sheet === 'pfd' ? 'on' : ''} onClick={() => setSheet('pfd')} title="Process flow diagram — draw and edit here">
            PFD
          </button>
          <button className={sheet === 'pid' ? 'on' : ''} onClick={() => setSheet('pid')} title="Piping & instrumentation diagram — generated from the PFD and the instruments chosen per unit">
            P&amp;ID
          </button>
        </div>
        {sheet === 'pid' && (
          <div className="pid-wrap">
            <PidSheet
              graph={draft}
              sim={sim}
              docNo={`EE-${p.id.slice(-4).toUpperCase()}-PFD-001`}
              onSelect={(id) => {
                setSelEdges(new Set());
                setSelNodes(new Set([id]));
              }}
            />
          </div>
        )}
        <div className="studio-toolbar" style={{ display: sheet === 'pid' ? 'none' : undefined }}>
          <button className="tb" onClick={hist.undo} disabled={!editable || !hist.canUndo} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button className="tb" onClick={hist.redo} disabled={!editable || !hist.canRedo} title="Redo (Ctrl+Y)">
            ↷
          </button>
          <span className="tb-sep" />
          <button className={`tb ${snap ? 'on' : ''}`} onClick={() => setSnap((s) => !s)} title="Snap to grid">
            ⊞ Snap
          </button>
          <button className="tb" onClick={() => rf.fitView({ padding: 0.25, maxZoom: 1.1, duration: 250 })} title="Fit drawing to screen">
            ⤢ Fit
          </button>
          <span className="tb-sep" />
          <span className={`tb-status ${busy ? 'busy' : ''}`} title={simError ?? undefined} style={simError && !busy ? { color: 'var(--alarm)' } : undefined}>{busy ? 'calculating…' : simError ? 'calculation failed — showing last result' : sim?.ok ? 'balance OK' : 'incomplete'}</span>
        </div>

        {menu && menuNode && (
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <div className="ctx-title">{menuNode.tag}</div>
            <button
              onClick={() => {
                if (copySel()) paste();
                setMenu(null);
              }}
            >
              Duplicate <kbd>Ctrl D</kbd>
            </button>
            <button
              onClick={() => {
                setDraft((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === menuNode.id ? { ...n, flip: !n.flip } : n)) }));
                setMenu(null);
              }}
            >
              Flip horizontally <kbd>inlet ⇄ outlet</kbd>
            </button>
            <button
              onClick={() => {
                const t = prompt('Equipment tag', menuNode.tag ?? '');
                if (t && t.trim()) setDraft((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === menuNode.id ? { ...n, tag: t.trim().toUpperCase().slice(0, 12) } : n)) }));
                setMenu(null);
              }}
            >
              Rename tag…
            </button>
            <button
              onClick={() => {
                setDraft((g) => ({ ...g, edges: g.edges.filter((e) => e.from !== menuNode.id && e.to !== menuNode.id) }));
                setMenu(null);
              }}
            >
              Disconnect all pipes
            </button>
            <button
              className="danger"
              onClick={() => {
                removeNodes([menuNode.id]);
                setMenu(null);
              }}
            >
              Delete <kbd>Del</kbd>
            </button>
          </div>
        )}

        <div className="sheet-frame" />
        <div className="title-block">
          <div>
            <span>PROCESS FLOW DIAGRAM</span>
            <span>REV {String.fromCharCode(65 + Math.min(p.attempts, 25))}</span>
          </div>
          <div>
            <span>DWG NO.</span>
            <span>
              EE-{p.id.slice(-4).toUpperCase()}-PFD-001 · SHEET 1/1 · NTS
            </span>
          </div>
          <div>
            <span>CLIENT</span>
            <span>{p.enquiry.company}</span>
          </div>
          <div>
            <span>DESIGN FLOW</span>
            <span>
              {p.datasheet.Q} m³/d · PF {p.datasheet.peakFactor}
            </span>
          </div>
          <div>
            <span>DISCHARGE</span>
            <span>{STANDARDS.standards[p.enquiry.standard].label}</span>
          </div>
          <div>
            <span>BY</span>
            <span>{companyName}</span>
          </div>
        </div>
        {plant && (
          <div className="note info" style={{ position: 'absolute', top: 52, left: 10, right: 10, zIndex: 5, background: '#fff', color: 'var(--ink)' }}>
            {plant.upgrade?.phase === 'draft'
              ? `Upgrade draft — ${plant.company}. Changed and new units are priced as plant modification works (${Math.round((RETROFIT_PREMIUM - 1) * 100)} % rework premium; added instruments only for the instruments). Shown on today's influent.`
              : plant.upgrade?.phase === 'building'
                ? `Upgrade under construction — ${plant.company}. Hand-over in week ${plant.upgrade.doneWeek}; the plant keeps running on the old design until then.`
                : `Operating plant — ${plant.company}. As-built drawing, read-only, on today's influent. Use “Propose upgrade” to modify it.`}
          </div>
        )}
        {p.status === 'failed' && (
          <div className="note error" style={{ position: 'absolute', top: 52, left: 10, right: 10, zIndex: 5, background: '#fff', color: 'var(--ink)' }}>
            Retrofit mode — the last commissioning failed. Modified or new units are charged at a {Math.round((RETROFIT_PREMIUM - 1) * 100)} % rework premium.
          </div>
        )}
      </div>

      <aside className="inspector">
        {single && !isNonUnit(single) ? (
          <UnitInspector node={single} editable={editable} sim={sim} onParam={updateParams} onInst={toggleInst} />
        ) : selectedEdgeStream ? (
          <StreamTable title="Pipe stream" s={selectedEdgeStream} />
        ) : single?.kind === 'disposal' ? (
          <DisposalInspector id={single.id} tag={single.tag ?? 'SD'} sim={sim} />
        ) : single?.kind === 'influent' ? (
          <>
            <StreamTable title="Raw wastewater (design basis)" s={basis.stream} />
            <InstrumentSection node={single} editable={editable} onInst={toggleInst} />
          </>
        ) : selNodes.size > 1 ? (
          <>
            <h2>{selNodes.size} units selected</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              Drag to move them together. <kbd>Del</kbd> deletes, <kbd>Ctrl D</kbd> duplicates.
            </p>
            <button className="btn sm danger" disabled={!editable} onClick={() => removeNodes([...selNodes])}>
              Delete selection
            </button>
          </>
        ) : plant ? (
          <PlantPanel plant={plant} draft={draft} sim={sim} busy={busy} week={week} go={go} flush={flush} />
        ) : (
          <DesignSummary sim={sim} capexToCharge={capexToCharge} weeks={weeks} cash={cash} editable={editable} onCommission={doCommission} />
        )}
      </aside>

      <section className="drawer">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="drawer-tabs">
            <button className={drawerTab === 'compliance' ? 'on' : ''} onClick={() => setDrawerTab('compliance')}>
              Effluent vs {STANDARDS.standards[p.enquiry.standard].label}
            </button>
            <button className={drawerTab === 'streams' ? 'on' : ''} onClick={() => setDrawerTab('streams')}>
              Stream table (mass balance)
            </button>
          </div>
          {report && <span className={`pill ${report.pass ? 'pass' : 'fail'}`}>{report.pass ? 'PREDICTED PASS' : `${report.checks.filter((c) => !c.pass).length} PARAMETER(S) FAIL`}</span>}
        </div>
        {drawerTab === 'compliance' && !report && <p className="muted">Connect raw wastewater → units → final discharge to see the predicted effluent.</p>}
        {drawerTab === 'compliance' && report && <ComplianceTable checks={report.checks} />}
        {drawerTab === 'streams' && (
          <StreamBalanceTable
            graph={draft}
            sim={sim}
            numbers={streamNos}
            selected={singleEdge}
            onPick={(id) => {
              setSelNodes(new Set());
              setSelEdges(new Set([id]));
            }}
          />
        )}
      </section>
    </div>
  );

  function DesignSummary(props: { sim: SimResult | null; capexToCharge: number; weeks: number; cash: number; editable: boolean; onCommission: () => void }) {
    const { sim, capexToCharge, weeks, cash, editable, onCommission } = props;
    const pp = p!;
    return (
      <>
        <h2>Design summary</h2>
        <div className="calc">
          <span>CAPEX (this design)</span>
          <span>{rm(sim?.capex ?? 0)}</span>
        </div>
        {pp.built && (
          <div className="calc">
            <span>Retrofit charge</span>
            <span>{rm(capexToCharge)}</span>
          </div>
        )}
        <div className="calc">
          <span>Contract value</span>
          <span>{rm(pp.enquiry.contractValue)}</span>
        </div>
        <div className="calc">
          <span>Projected margin</span>
          <span style={{ color: pp.enquiry.contractValue - pp.spent.lab - pp.spent.capex - capexToCharge < 0 ? 'var(--alarm)' : undefined }}>{rm(pp.enquiry.contractValue - pp.spent.lab - pp.spent.capex - capexToCharge)}</span>
        </div>
        <div className="calc">
          <span>Cash + credit vs build shortfall</span>
          <span style={{ color: cash + 250_000 < Math.max(0, capexToCharge - (pp.built ? 0 : pp.enquiry.contractValue * 0.6)) ? 'var(--alarm)' : undefined }}>
            {rm(cash + 250_000)} / {rm(Math.max(0, capexToCharge - (pp.built ? 0 : pp.enquiry.contractValue * 0.6)))}
          </span>
        </div>
        <div className="calc">
          <span>OPEX estimate</span>
          <span style={{ color: (sim?.opexRMd ?? 0) > pp.enquiry.opexLimitRMd ? 'var(--warn)' : undefined }}>
            {rm(sim?.opexRMd ?? 0)}/d (max {rm(pp.enquiry.opexLimitRMd)})
          </span>
        </div>
        <div className="calc">
          <span>Energy</span>
          <span>{fmt(sim?.energy_kWhd ?? 0, 0)} kWh/d</span>
        </div>
        <div className="calc">
          <span>Sludge to contractor (dry)</span>
          <span>{fmt(sim?.sludgeKgD ?? 0, 0)} kg/d</span>
        </div>
        {(sim?.disposal.length ?? 0) > 0 && (
          <div className="calc">
            <span>Sludge to own disposal</span>
            <span>
              {fmt(sim!.disposal.reduce((a, d) => a + d.wetKgD, 0), 0)} kg/d wet · {rm(sim!.disposal.reduce((a, d) => a + d.costRMd, 0))}/d
            </span>
          </div>
        )}
        {(sim?.tears.length ?? 0) > 0 && (
          <div className="calc">
            <span>Recycle loops</span>
            <span>
              {sim!.tears.length} · converged in {sim!.iterations} iterations
            </span>
          </div>
        )}
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
        <button className="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={!editable || !sim?.ok} onClick={onCommission}>
          {pp.built ? 'Retrofit & recommission' : 'Build & commission'} ▸
        </button>
        {basis!.assumptions.length > 0 && (
          <div className="note warn" style={{ marginTop: 10 }}>
            Predictions rely on {basis!.assumptions.length} assumption(s) — see the Laboratory.
          </div>
        )}
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Select a unit to size it, or a pipe to inspect its stream.</p>
      </>
    );
  }
}

const PaletteItem = memo(function PaletteItem({ type, editable, onAdd }: { type: UnitType; editable: boolean; onAdd: (t: UnitType) => void }) {
  const cat = CATALOGUE[type].category;
  return (
    <div
      className="palette-item"
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/ee-unit', type);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onAdd(type)}
      title={CATALOGUE[type].summary}
      style={{ background: '#f4f6f8', color: 'var(--ink)', opacity: editable ? 1 : 0.5 }}
    >
      <UnitSymbol type={type} accent={CATEGORY_COLOR[cat]} />
      {CATALOGUE[type].name}
    </div>
  );
});

function DisposalPaletteItem({ editable, onAdd }: { editable: boolean; onAdd: () => void }) {
  return (
    <div
      className="palette-item"
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/ee-unit', 'disposal');
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onAdd}
      title="Where sludge or cake leaves site — costed per wet tonne (dewatering pays off here)."
      style={{ background: '#f4f6f8', color: 'var(--ink)', opacity: editable ? 1 : 0.5 }}
    >
      <DisposalSymbol />
      Sludge Disposal
    </div>
  );
}

function DisposalInspector({ id, tag, sim }: { id: string; tag: string; sim: SimResult | null }) {
  const d = sim?.disposal.find((x) => x.id === id);
  return (
    <>
      <div className="mono" style={{ fontSize: 11, color: 'var(--sludge)', textTransform: 'uppercase' }}>
        sludge
      </div>
      <h2 style={{ marginBottom: 4 }}>Sludge Disposal — {tag}</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Sludge or cake is hauled off site and charged per wet tonne ({rm(PRICES.disposalWet_kg.metal * 1000)}/t for metal sludge — scheduled waste SW 204; {rm(PRICES.disposalWet_kg.other * 1000)}/t otherwise). Every tonne of water you remove upstream saves money here.
      </p>
      {!d && <p className="muted">Pipe a sludge outlet (round brown nozzle) here.</p>}
      {d && (
        <>
          <div className="calc">
            <span>Wet mass</span>
            <span>{fmt(d.wetKgD, 0)} kg/d</span>
          </div>
          <div className="calc">
            <span>Dry solids</span>
            <span>{fmt(d.dryKgD, 1)} kg/d</span>
          </div>
          <div className="calc">
            <span>Solids content</span>
            <span>{fmt((100 * d.dryKgD) / Math.max(d.wetKgD, 1e-9), 1)} %</span>
          </div>
          <div className="calc">
            <span>Classification</span>
            <span>{d.metal ? 'Scheduled waste (metal)' : 'Non-hazardous'}</span>
          </div>
          <div className="calc">
            <span>Disposal cost</span>
            <span>
              {rm(d.costRMd)}/d · {rm(d.costRMd / Math.max(d.dryKgD, 1e-9))}/kg DS
            </span>
          </div>
        </>
      )}
    </>
  );
}

function InstrumentSection({ node, editable, onInst }: { node: PNode; editable: boolean; onInst: (id: string, key: InstKey, on: boolean) => void }) {
  const defs = applicableInstruments(node.kind, node.params);
  if (!defs.length) return null;
  return (
    <div className="inst-section">
      <h2 style={{ fontSize: 12, marginTop: 14 }}>Instrumentation &amp; redundancy</h2>
      {defs.map((d) => {
        const on = hasInst(node, d.key);
        const cost = d.capexRM + (d.key === 'standby' && node.kind === 'activatedSludge' ? STANDBY_BLOWER_EXTRA_RM : 0);
        return (
          <label key={d.key} className={`inst-row ${on ? 'on' : ''}`} title={d.why}>
            <input type="checkbox" disabled={!editable} checked={on} onChange={(e) => onInst(node.id, d.key, e.target.checked)} />
            <span className="inst-isa">{d.key === 'standby' ? (node.kind === 'activatedSludge' ? 'B·B' : 'P·B') : d.isa}</span>
            <span className="inst-label">
              {d.key === 'standby' ? (node.kind === 'activatedSludge' ? 'Standby blower (auto-changeover)' : 'Standby dosing pump (auto-changeover)') : d.label}
              <small>{d.why}</small>
            </span>
            <span className="inst-cost">{rm(cost)}</span>
          </label>
        );
      })}
    </div>
  );
}

function UnitInspector({ node, editable, sim, onParam, onInst }: { node: PNode; editable: boolean; sim: SimResult | null; onParam: (id: string, key: string, v: number | string) => void; onInst: (id: string, key: InstKey, on: boolean) => void }) {
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
            <select disabled={!editable} value={String(node.params[d.key] ?? d.default(0))} onChange={(e) => onParam(node.id, d.key, e.target.value)}>
              {d.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <NumberField value={Number(node.params[d.key] ?? d.default(0))} min={d.min} max={d.max} step={d.step} disabled={!editable} onCommit={(v) => onParam(node.id, d.key, v)} />
          )}
          {d.help && <span className="help">{d.help}</span>}
        </div>
      ))}
      <InstrumentSection node={node} editable={editable} onInst={onInst} />
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

function StreamBalanceTable({ graph, sim, numbers, selected, onPick }: { graph: ProcessGraph; sim: SimResult | null; numbers: Map<string, number>; selected?: string; onPick: (edgeId: string) => void }) {
  const tag = (id: string) => graph.nodes.find((n) => n.id === id)?.tag ?? (id === 'in' ? 'RAW' : id);
  const cols = graph.edges
    .map((e) => ({ e, no: numbers.get(e.id) ?? 0, s: sim?.edges[e.id] }))
    .filter((c) => c.s)
    .sort((a, b) => a.no - b.no);
  if (!cols.length) return <p className="muted">Connect the train to see the stream table.</p>;
  const rows: [string, (s: Stream) => number, number][] = [
    ['Flow, m³/d', (s) => s.Q, 0],
    ['pH', (s) => measure(s).pH, 2],
    ['COD, mg/L', (s) => measure(s).COD, 0],
    ['BOD₅, mg/L', (s) => measure(s).BOD5, 0],
    ['TSS, mg/L', (s) => measure(s).TSS, 1],
    ['O&G, mg/L', (s) => measure(s).OG, 1],
    ['NH₄-N, mg/L', (s) => measure(s).NH3N, 1],
    ['Ni total, mg/L', (s) => measure(s).Ni, 2],
    ['Cu total, mg/L', (s) => measure(s).Cu, 2],
    ['Zn total, mg/L', (s) => measure(s).Zn, 2],
    ['Cr(VI), mg/L', (s) => measure(s).CrVI, 3],
    ['Solids, kg/d', (s) => (s.Q * measure(s).TSS) / 1000, 1],
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data stream-table">
        <thead>
          <tr>
            <th>Stream</th>
            {cols.map((c) => (
              <th key={c.e.id} className={selected === c.e.id ? 'hi' : ''} onClick={() => onPick(c.e.id)} title="Highlight this pipe on the PFD">
                <span className="stream-no">{c.no}</span>
                <div className="muted" style={{ fontSize: 10, fontWeight: 400 }}>
                  {tag(c.e.from)} → {tag(c.e.to)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f, d]) => (
            <tr key={label}>
              <td>{label}</td>
              {cols.map((c) => (
                <td key={c.e.id} className={`num ${selected === c.e.id ? 'hi' : ''}`}>
                  {fmt(f(c.s!), d)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

/** Inspector panel for an operating plant: as-built summary, upgrade proposal (variation order) and its quote. */
function PlantPanel({ plant, draft, sim, busy, week, go, flush }: { plant: Plant; draft: ProcessGraph; sim: SimResult | null; busy: boolean; week: number; go: (s: Screen) => void; flush: () => void }) {
  const startUpgrade = useGame((s) => s.startUpgrade);
  const discardUpgrade = useGame((s) => s.discardUpgrade);
  const submitUpgrade = useGame((s) => s.submitUpgrade);
  const cash = useGame((s) => s.cash);
  const engineerFree = useGame((s) => engineersBusy(s) < projectSlots(s.staff));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const u = plant.upgrade;
  // the as-built plant on today's influent (once per plant state, not per edit)
  const now = useMemo(() => simulate(plant.graph, currentInfluent(plant)), [plant.graph, plant.trueStream, plant.history.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // only quote on a simulation that is up to date with the draft (the worker result lags edits)
  const quote = useMemo(() => (u?.phase === 'draft' && sim && !busy ? upgradeQuote(plant, draft, week, { next: sim }) : null), [u?.phase, sim, busy, draft, plant.graph, plant.incidentLog, plant.history.length, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = plant.history[plant.history.length - 1];
  return (
    <>
      <h2>Operating plant</h2>
      <div className="calc"><span>Client</span><span>{plant.company}</span></div>
      <div className="calc"><span>O&amp;M fee</span><span>{plant.contract ? `${rm(plant.contract.monthlyFee)}/month` : '—'}</span></div>
      <div className="calc"><span>Today's flow</span><span>{fmt(currentInfluent(plant).Q, 0)} m³/d (×{fmt(last?.flowFactor ?? 1, 2)})</span></div>
      <div className="calc"><span>As-built on today's influent</span><span className={`pill ${now.ok && now.effluent && evaluate(now.effluent, plant.standard, now).pass ? 'pass' : 'fail'}`}>{now.ok && now.effluent && evaluate(now.effluent, plant.standard, now).pass ? 'PASS' : 'FAIL'}</span></div>
      <div className="calc"><span>Last weekly sample</span><span>{last ? (last.pass ? 'compliant' : `failed: ${last.failed.join(', ')}`) : '—'}</span></div>
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <button className="btn sm" onClick={() => go('scada')}>Open SCADA ▸</button>
        <button className="btn sm ghost" onClick={() => go('plants')}>Plant economics</button>
      </div>

      {!u && (
        <>
          <h2 style={{ marginTop: 16 }}>Upgrade</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Add standby pumps, control loops or instruments you left out, change options, or add, resize and remove units. You pay the works when ordered. The client pays a variation order (cost + {Math.round((VO_MARKUP - 1) * 100)} %) at hand-over for the units needed to restore compliance after failed samples, and for instruments that remedy recent incidents on that unit; the rest is yours.
          </p>
          <button className="btn primary" style={{ width: '100%' }} disabled={!engineerFree} onClick={() => startUpgrade(plant.id)}>
            Propose upgrade ▸
          </button>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {engineerFree ? 'An upgrade takes one engineer until hand-over or until you discard the draft.' : 'All engineers are busy on projects or upgrades — hire an engineer or finish one first.'}
          </p>
        </>
      )}

      {u?.phase === 'draft' && (
        <>
          <h2 style={{ marginTop: 16 }}>Upgrade quote</h2>
          {!quote ? (
            <p className="muted">{busy || !sim ? 'calculating…' : '—'}</p>
          ) : (
            <>
              <div className="calc"><span>Changed / new</span><span>{quote.changed.length ? quote.changed.join(', ') : 'nothing yet'}</span></div>
              {quote.removed.length > 0 && <div className="calc"><span>Removed</span><span>{quote.removed.join(', ')}</span></div>}
              <div className="calc"><span>Works cost (paid when ordered)</span><span>{rm(quote.cost)}</span></div>
              <div className="calc"><span>Client VO scope</span><span>{quote.clientFunded ? `${quote.clientUnits.join(', ')} — ${rm(quote.clientCost)}` : 'none'}</span></div>
              <div className="calc"><span>Client pays at hand-over</span><span>{rm(quote.price)}</span></div>
              <div className="calc"><span>Your net cost</span><span>{rm(quote.cost - quote.price)}</span></div>
              <div className="calc"><span>Construction</span><span>{quote.weeks} weeks, plant stays in service</span></div>
              <div className="calc"><span>Upgraded plant on today's influent</span><span className={`pill ${quote.draftPass ? 'pass' : 'fail'}`}>{quote.draftPass ? 'PASS' : 'FAIL'}</span></div>
              <div className={`note ${quote.clientFunded ? 'info' : 'warn'}`} style={{ marginTop: 8 }}>
                {quote.reason}
              </div>
              <div className="calc"><span>Cash + credit</span><span style={{ color: cash + 250_000 < quote.cost ? 'var(--alarm)' : undefined }}>{rm(cash + 250_000)}</span></div>
              {quote.errors.map((e) => (
                <div key={e} className="note error">{e}</div>
              ))}
            </>
          )}
          {msg && <div className={`note ${msg.ok ? 'info' : 'error'}`}>{msg.text}</div>}
          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={!quote?.ok}
            onClick={() => {
              flush();
              if (!quote || !confirm(`Order the upgrade works?\n\n${quote.changed.join(', ')}\nCost ${rm(quote.cost)} now · hand-over in week ${week + quote.weeks}\n${quote.clientFunded ? `Client pays ${rm(quote.price)} at hand-over.` : 'Funded by you.'}`)) return;
              setMsg(submitUpgrade(plant.id));
            }}
          >
            Order upgrade works ▸
          </button>
          <button className="btn sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => { if (confirm('Discard this upgrade draft?')) discardUpgrade(plant.id); }}>
            Discard draft
          </button>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Set-points are not works: change them in SCADA. The live SCADA set-points are kept at hand-over.</p>
        </>
      )}

      {u?.phase === 'building' && (
        <>
          <h2 style={{ marginTop: 16 }}>Upgrade under construction</h2>
          <div className="calc"><span>Hand-over</span><span>week {u.doneWeek}</span></div>
          <div className="calc"><span>Works cost</span><span>{rm(u.cost ?? 0)}</span></div>
          <div className="calc"><span>Variation order</span><span>{u.clientFunded ? `${rm(u.price ?? 0)} from the client` : 'operator-funded'}</span></div>
          {u.reason && <p className="muted" style={{ fontSize: 12 }}>{u.reason}</p>}
        </>
      )}
    </>
  );
}
