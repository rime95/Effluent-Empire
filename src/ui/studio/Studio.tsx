import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ewAutoSize } from '../../simulation/chemistry/electrowinning';
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
import { constructionWeeks, projectDesignBasis, retrofitCharge, RETROFIT_PREMIUM, type Project } from '../../game/project';
import { OM, type Plant } from '../../game/operations';
import { currentInfluent, upgradeQuote, VO_MARKUP } from '../../game/upgrade';
import { REUSE_SPEC, isLiquidHaul, isReuse, simulate } from '../../simulation/treatment/graph';
import { CATALOGUE, PRICES, UnitType } from '../../simulation/treatment/catalogue';
import { PNode, PortId, ProcessGraph, SimResult } from '../../simulation/treatment/graph';
import { combinedMetalsApply, evaluate, limitsFor, measure, STANDARDS, type ParamId, type StandardId } from '../../simulation/treatment/compliance';
import { METALS, Stream, cloneStream, mainInlet, mapInlets, tdsTotal } from '../../simulation/core/stream';
import { DisposalSymbol, TankerSymbol, UnitSymbol } from '../components/Symbols';
import { defaultPos } from './layout';
import { CATEGORY_COLOR, edgeTypes, nodeTypes, type DosingTag, type UnitNodeData } from './nodes';
import { NumberField } from './NumberField';
import { PidSheet } from './PidSheet';
import { applicableInstruments, hasInst, STANDBY_BLOWER_EXTRA_RM, type InstKey } from '../../simulation/treatment/instrumentation';
import { useHistory } from './useHistory';
import { isUnitUnlocked } from '../../game/tech';
import { evaluateRequirements } from '../../game/requirements';
import { RequirementsTable } from '../components/RequirementsTable';
import { useSimulation } from './useSimulation';
import type { Screen } from '../App';
import { fmt, rm } from '../format';
import { brand } from '../prefs';
import { canConnect, connect, createNode, isNonUnit, isTerminal, nextPfdPosition, pasteNodes, removeNodes as removeGraphNodes, type AddKind } from './editing';
import { PRESETS, STUDIO_DEFAULT, useLayout, type StudioPreset } from '../layout';
import { Splitter } from '../components/Splitter';

const UNIT_ORDER: UnitType[] = ['eq', 'oilSep', 'daf', 'clarifier', 'sandFilter', 'carbon', 'crReduction', 'neutralisation', 'precipitation', 'sulfide', 'aop', 'ionExchange', 'electrowinning', 'coagulation', 'activatedSludge', 'uasb', 'mbr', 'uf', 'ro', 'evaporator', 'thickener', 'filterPress', 'dryer', 'splitter', 'mixer'];
const GRID = 20;
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
  const pos = new Map(g.nodes.map((n, i) => [n.id, defaultPos(n, i, g.nodes.length)]));
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

export function Studio(props: { go: (s: Screen) => void }) {
  return (
    <ReactFlowProvider>
      <StudioInner {...props} />
    </ReactFlowProvider>
  );
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
  const tech = useGame((s) => s.tech);
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
  const projBasis = useMemo(() => (proj ? projectDesignBasis(proj) : null), [proj?.datasheet, proj?.sideDatasheets]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const position = dragPos[n.id] ?? defaultPos(n, i, draft.nodes.length);
      const selected = selNodes.has(n.id);
      let type: string;
      let data: Record<string, unknown>;
      if (n.kind === 'disposal') {
        type = 'terminal';
        const d = sim?.disposal.find((x) => x.id === n.id);
        data = isReuse(n)
          ? { kind: 'disposal', reuse: true, tag: n.tag ?? 'RW', label: 'Water reclaim → process', sub: sim?.reuse ? `${fmt(sim.reuse.m3d, 0)} m³/d · ${sim.reuse.offSpec.length ? 'OFF SPEC' : `+${rm(sim.reuse.creditRMd)}/d`}` : 'connect a clean-water line' }
          : isLiquidHaul(n)
          ? { kind: 'disposal', liquid: true, tag: n.tag ?? 'LH', label: 'Liquid waste haulage', sub: d ? `${fmt(d.m3d ?? 0, (d.m3d ?? 0) < 10 ? 2 : 0)} m³/d · ${rm(d.costRMd)}/d` : 'connect a concentrate line' }
          : { kind: 'disposal', tag: n.tag ?? 'SD', label: 'Sludge disposal', sub: d ? `${fmt(d.wetKgD, 0)} kg/d wet · ${rm(d.costRMd)}/d` : 'connect a sludge line' };
      } else if (isTerminal(n)) {
        type = 'terminal';
        // segregated plants: one inlet per raw stream, labelled with the stream
        const sideIn = n.kind === 'influent' && n.params.source ? basis?.stream.side?.find((x) => x.id === n.params.source) : undefined;
        const multi = !!basis?.stream.side?.length;
        data =
          n.kind === 'influent'
            ? { kind: n.kind, tag: n.tag, label: sideIn ? `RAW — ${sideIn.label.toUpperCase()}` : multi ? 'RAW — MAIN' : 'RAW WASTEWATER', sub: `${fmt(sideIn ? sideIn.stream.Q : (basis?.stream.Q ?? p.datasheet.Q), (sideIn?.stream.Q ?? 10) < 10 ? 1 : 0)} m³/d` }
            : { kind: n.kind, label: 'FINAL DISCHARGE', sub: `Standard ${p.enquiry.standard}` };
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
  const L = useLayout();
  const st = L.studio;
  const [summaryOpen, setSummaryOpen] = useState(false);
  // a preset (or focus mode) changes the canvas size a lot: refit the drawing once the grid has settled
  useEffect(() => {
    if (st.preset === 'custom') return;
    const t = setTimeout(() => rf.fitView({ padding: 0.25, maxZoom: 1.1, duration: 200 }), 120);
    return () => clearTimeout(t);
  }, [st.preset, L.focus]); // eslint-disable-line react-hooks/exhaustive-deps
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
      setDraft((g) => removeGraphNodes(g, ids));
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
      setDraft((g) => connect(g, c.source!, port, c.target!));
    },
    [editable, setDraft],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target) return false;
      return canConnect(draft, c.source, (c.sourceHandle ?? 'out') as PortId, c.target).ok;
    },
    [draft],
  );

  const addUnit = useCallback(
    (kind: AddKind, position?: { x: number; y: number }, site?: PNode['site']) => {
      if (!p || !editable || !isUnitUnlocked(kind, tech)) return;
      const node = createNode(kind, p.datasheet.Q, draft.nodes);
      const pos = position ?? nextPfdPosition(draft.nodes, kind);
      if (site) node.site = site;
      node.position = snap ? { x: Math.round(pos.x / GRID) * GRID, y: Math.round(pos.y / GRID) * GRID } : pos;
      setDraft((g) => ({ ...g, nodes: [...g.nodes, node] }));
      setSelNodes(new Set([node.id]));
      setSelEdges(new Set());
    },
    [p, editable, draft.nodes, snap, setDraft, tech],
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
      const r = pasteNodes(g, src, p.datasheet.Q, (k) => isUnitUnlocked(k, tech));
      setSelNodes(new Set(r.added));
      clip.current = r.nextClip;
      return r.graph;
    });
  }, [p, editable, setDraft, tech]);

  // ---------- keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && !e.altKey) {
        const ls = useLayout.getState();
        const cur = ls.studio;
        if (e.key === '[') ls.setStudio({ palette: cur.palette === 'full' ? 'rail' : cur.palette === 'rail' ? 'hidden' : 'full' });
        else if (e.key === ']') ls.setStudio({ inspector: cur.inspector === 'docked' ? 'floating' : 'docked' });
        else if (e.key === '`') ls.setStudio({ drawerOpen: !cur.drawerOpen });
        else if (e.key === 'f' || e.key === 'F') ls.setFocus(!ls.focus);
        return;
      }
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
    const kind = e.dataTransfer.getData('application/ee-unit') as UnitType | 'disposal' | 'liquidHaul' | 'reclaim';
    if (!kind) return;
    addUnit(kind, rf.screenToFlowPosition({ x: e.clientX - 60, y: e.clientY - 40 }));
  };

  const autoConnect = () => {
    setDraft((g) => {
      const units = g.nodes.filter((n) => !isNonUnit(n) && !['thickener', 'filterPress'].includes(n.kind)).sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
      const chain = [g.nodes.find((n) => n.kind === 'influent' && !n.params.source)!, ...units, g.nodes.find((n) => n.kind === 'discharge')!];
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

  const inspectorBody = (
    <>
      {single && !isNonUnit(single) ? (
        <UnitInspector node={single} editable={editable} sim={sim} onParam={updateParams} onInst={toggleInst} />
      ) : selectedEdgeStream ? (
        <StreamTable title="Pipe stream" s={selectedEdgeStream} />
      ) : single?.kind === 'disposal' ? (
        <DisposalInspector id={single.id} tag={single.tag ?? 'SD'} sim={sim} />
      ) : single?.kind === 'influent' ? (
        <>
          <StreamTable
            title={single.params.source ? `${basis.stream.side?.find((x) => x.id === single.params.source)?.label ?? 'Side'} stream (design basis)` : 'Raw wastewater (design basis)'}
            s={single.params.source ? (basis.stream.side?.find((x) => x.id === single.params.source)?.stream ?? basis.stream) : mainInlet(basis.stream)}
          />
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
    </>
  );
  // ---------- workspace layout (per-device, src/ui/layout.ts)
  const palW = st.palette === 'full' ? st.paletteW : st.palette === 'rail' ? 58 : 0;
  const inspW = st.inspector === 'docked' ? st.inspectorW : 0;
  const hasSel = !!single || !!selectedEdgeStream || selNodes.size > 1;
  const reqFails = sim?.ok && p.enquiry.requirements ? evaluateRequirements(sim, p.enquiry.requirements).filter((c) => !c.pass).length : 0;

  return (
    <div className="studio" style={{ gridTemplateColumns: `${palW}px minmax(0, 1fr) ${inspW}px`, gridTemplateRows: `minmax(0, 1fr) ${st.drawerOpen ? `${st.drawerH}px` : 'auto'}` }}>
      {st.palette !== 'hidden' && (
      <aside className={`palette ${st.palette === 'rail' ? 'rail' : ''}`}>
        <div className="panel-head">
          <span className="hide-rail">Unit processes</span>
          <button className="panel-btn" onClick={() => L.setStudio({ palette: st.palette === 'rail' ? 'full' : 'rail' })} title={st.palette === 'rail' ? 'Show names ([)' : 'Shrink to icons ([)'}>
            {st.palette === 'rail' ? '»' : '«'}
          </button>
        </div>
        <p className="muted hide-rail" style={{ fontSize: 11, marginTop: 0 }}>Drag onto the canvas, or click to add.</p>
        {(['physical', 'chemical', 'biological', 'sludge', 'hydraulic'] as const).map((cat) => (
          <div key={cat}>
            <div className="nav-section" style={{ padding: '8px 2px 4px', color: CATEGORY_COLOR[cat] }}>
              {cat}
            </div>
            {UNIT_ORDER.filter((t) => CATALOGUE[t].category === cat).map((t) => (
              <PaletteItem key={t} type={t} editable={editable} locked={!isUnitUnlocked(t, tech)} onAdd={addUnit} />
            ))}
            {cat === 'sludge' && <DisposalPaletteItem editable={editable} onAdd={() => addUnit('disposal')} />}
            {cat === 'sludge' && <DisposalPaletteItem liquid editable={editable} onAdd={() => addUnit('liquidHaul')} />}
            {cat === 'hydraulic' && <DisposalPaletteItem reuse editable={editable && isUnitUnlocked('reclaim', tech)} onAdd={() => addUnit('reclaim')} />}
          </div>
        ))}
        <div className="hide-rail" style={{ marginTop: 12 }}>
          <button className="btn sm" style={{ width: '100%' }} onClick={autoConnect} disabled={!editable} title="Connect units left-to-right in a single line">
            Auto-connect in series
          </button>
        </div>
        <div className="muted shortcut-help hide-rail">
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
          <div>
            <kbd>[</kbd> <kbd>]</kbd> <kbd>`</kbd> panels · <kbd>F</kbd> focus
          </div>
        </div>
      </aside>
      )}

      <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => menu && setMenu(null)}>
        {st.palette === 'full' && <Splitter dir="x" sign={1} size={st.paletteW} onSize={(w) => L.setStudio({ paletteW: w })} onReset={() => L.setStudio({ paletteW: STUDIO_DEFAULT.paletteW })} className="edge-left" />}
        {st.palette === 'hidden' && (
          <button className="edge-tab edge-tab-left" onClick={() => L.setStudio({ palette: 'full' })} title="Show the unit palette ([)">
            › Units
          </button>
        )}
        {st.inspector === 'docked' && <Splitter dir="x" sign={-1} size={st.inspectorW} onSize={(w) => L.setStudio({ inspectorW: w })} onReset={() => L.setStudio({ inspectorW: STUDIO_DEFAULT.inspectorW })} className="edge-right" />}
        {st.drawerOpen && <Splitter dir="y" sign={-1} size={st.drawerH} onSize={(h) => L.setStudio({ drawerH: h })} onReset={() => L.setStudio({ drawerH: STUDIO_DEFAULT.drawerH })} className="edge-bottom" />}
        <div className="view-bar">
          <select value={st.preset} onChange={(e) => e.target.value !== 'custom' && L.applyPreset(e.target.value as StudioPreset)} title="Workspace layout">
            {st.preset === 'custom' && <option value="custom">Custom layout</option>}
            {(Object.keys(PRESETS) as StudioPreset[]).map((k) => (
              <option key={k} value={k} title={PRESETS[k].hint}>
                {PRESETS[k].label} layout
              </option>
            ))}
          </select>
          <button className={`tb ${st.palette !== 'hidden' ? 'on' : ''}`} onClick={() => L.setStudio({ palette: st.palette === 'hidden' ? 'full' : 'hidden' })} title="Unit palette ([)">
            ▥
          </button>
          <button className={`tb ${st.inspector === 'docked' ? 'on' : ''}`} onClick={() => L.setStudio({ inspector: st.inspector === 'docked' ? 'floating' : 'docked' })} title="Inspector: docked / floating (])">
            ◨
          </button>
          <button className={`tb ${st.drawerOpen ? 'on' : ''}`} onClick={() => L.setStudio({ drawerOpen: !st.drawerOpen })} title="Results drawer (`)">
            ▤
          </button>
          <button className={`tb ${st.titleBlock ? 'on' : ''}`} onClick={() => L.setStudio({ titleBlock: !st.titleBlock })} title="Drawing title block">
            ⌗
          </button>
          <button className={`tb ${L.focus ? 'on' : ''}`} onClick={() => L.setFocus(!L.focus)} title="Focus mode: hide the menu and top bar (F · Esc to leave)">
            ⛶
          </button>
        </div>
        {st.inspector === 'floating' && (
          <FloatingCard
            // with nothing selected the card stays a small header (the summary on demand), so it doesn't cover the drawing
            pos={{ ...st.float, min: hasSel ? st.float.min : !summaryOpen }}
            title={single ? (single.tag ?? single.kind) : selectedEdgeStream ? 'Pipe stream' : plant ? 'Plant' : 'Design summary'}
            onMove={(right, top) => L.setStudio({ float: { ...st.float, right, top } })}
            onMin={() => (hasSel ? L.setStudio({ float: { ...st.float, min: !st.float.min } }) : setSummaryOpen((v) => !v))}
            onDock={() => L.setStudio({ inspector: 'docked' })}
          >
            {inspectorBody}
          </FloatingCard>
        )}
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
        {!st.titleBlock && (
          <button className="title-tag" onClick={() => L.setStudio({ titleBlock: true })} title="Show the title block">
            EE-{p.id.slice(-4).toUpperCase()}-PFD-001 · REV {String.fromCharCode(65 + Math.min(p.attempts, 25))}
          </button>
        )}
        {st.titleBlock && <div className="title-block">
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
            <span>{brand(p.enquiry.company)}</span>
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
        </div>}
        {plant && (
          <div className="note info" style={{ position: 'absolute', top: 52, left: 10, right: 300, zIndex: 5, background: '#fff', color: 'var(--ink)' }}>
            {plant.upgrade?.phase === 'draft'
              ? `Upgrade draft — ${brand(plant.company)}. Changed and new units are priced as plant modification works (${Math.round((RETROFIT_PREMIUM - 1) * 100)} % rework premium; added instruments only for the instruments). Shown on today's influent.`
              : plant.upgrade?.phase === 'building'
                ? `Upgrade under construction — ${brand(plant.company)}. Hand-over in week ${plant.upgrade.doneWeek}; the plant keeps running on the old design until then.`
                : `Operating plant — ${brand(plant.company)}. As-built drawing, read-only, on today's influent. Use “Propose upgrade” to modify it.`}
          </div>
        )}
        {p.status === 'failed' && (
          <div className="note error" style={{ position: 'absolute', top: 52, left: 10, right: 300, zIndex: 5, background: '#fff', color: 'var(--ink)' }}>
            Retrofit mode — the last commissioning failed. Modified or new units are charged at a {Math.round((RETROFIT_PREMIUM - 1) * 100)} % rework premium.
          </div>
        )}
      </div>

      {st.inspector === 'docked' && (
        <aside className="inspector">
          <div className="panel-head">
            <span>Inspector</span>
            <button className="panel-btn" onClick={() => L.setStudio({ inspector: 'floating' })} title="Float the inspector over the canvas (])">
              ⧉ Float
            </button>
          </div>
          {inspectorBody}
        </aside>
      )}

      {!st.drawerOpen && (
        <button className="drawer strip" onClick={() => L.setStudio({ drawerOpen: true })} title="Show the results (`)">
          <span>▴ Results</span>
          {report ? <span className={`pill ${report.pass ? 'pass' : 'fail'}`}>{report.pass ? 'PREDICTED PASS' : `${report.checks.filter((c) => !c.pass).length} PARAMETER(S) FAIL`}</span> : <span className="muted">incomplete</span>}
          {reqFails > 0 && <span className="pill fail">{reqFails} REQUIREMENT(S) FAIL</span>}
          <span className="mono">CAPEX {rm(sim?.capex ?? 0)}</span>
          <span className="mono">OPEX {rm(sim?.opexRMd ?? 0)}/d</span>
        </button>
      )}
      {st.drawerOpen && (
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
          <div className="row" style={{ gap: 8 }}>
            {report && <span className={`pill ${report.pass ? 'pass' : 'fail'}`}>{report.pass ? 'PREDICTED PASS' : `${report.checks.filter((c) => !c.pass).length} PARAMETER(S) FAIL`}</span>}
            <button className="panel-btn" onClick={() => L.setStudio({ drawerOpen: false })} title="Hide the results — a status strip stays (`)">
              ▾ Hide
            </button>
          </div>
        </div>
        {drawerTab === 'compliance' && !report && <p className="muted">Connect raw wastewater → units → final discharge to see the predicted effluent.</p>}
        {drawerTab === 'compliance' && report && <ComplianceTable checks={report.checks} />}
        {drawerTab === 'compliance' && report && basis && <MarginCheck graph={draft} influent={basis.stream} std={p.enquiry.standard} />}
        {drawerTab === 'compliance' && sim?.ok && p.enquiry.requirements && <RequirementsTable checks={evaluateRequirements(sim, p.enquiry.requirements)} title="Contract requirements (predicted)" />}
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
      )}
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

/** Inspector as a card floating over the canvas: drag by its header, minimise, or dock back to the side. */
function FloatingCard({ pos, title, onMove, onMin, onDock, children }: { pos: { right: number; top: number; min: boolean }; title: string; onMove: (right: number, top: number) => void; onMin: () => void; onDock: () => void; children: React.ReactNode }) {
  const drag = useRef<{ x: number; y: number; right: number; top: number } | null>(null);
  return (
    <div className={`float-card ${pos.min ? 'min' : ''}`} style={{ right: pos.right, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      <div
        className="float-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, right: pos.right, top: pos.top };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onMove(Math.max(0, drag.current.right - (e.clientX - drag.current.x)), Math.max(0, drag.current.top + (e.clientY - drag.current.y)));
        }}
        onPointerUp={() => (drag.current = null)}
        title="Drag to move"
      >
        <span>{title}</span>
        <button className="panel-btn" onClick={onMin} title={pos.min ? 'Expand' : 'Minimise'}>
          {pos.min ? '▸' : '–'}
        </button>
        <button className="panel-btn" onClick={onDock} title="Dock to the side (])">
          ⇥ Dock
        </button>
      </div>
      {!pos.min && <div className="float-body">{children}</div>}
    </div>
  );
}

const PaletteItem = memo(function PaletteItem({ type, editable, locked, onAdd }: { type: UnitType; editable: boolean; locked: boolean; onAdd: (t: UnitType) => void }) {
  const cat = CATALOGUE[type].category;
  if (locked)
    return (
      <div className="palette-item" title="Advanced technology — research it in the Technology Tree" style={{ background: '#e9edf1', color: '#7a8796', cursor: 'not-allowed' }}>
        <UnitSymbol type={type} accent="#9aa7b4" />
        <span className="pi-name" style={{ flex: 1 }}>{CATALOGUE[type].name}</span>
        <span className="pi-name" aria-label="locked">🔒</span>
      </div>
    );
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
      <span className="pi-name">{CATALOGUE[type].name}</span>
    </div>
  );
});

function DisposalPaletteItem({ editable, onAdd, liquid, reuse }: { editable: boolean; onAdd: () => void; liquid?: boolean; reuse?: boolean }) {
  if (reuse)
    return (
      <div
        className="palette-item"
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/ee-unit', 'reclaim');
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={editable ? onAdd : undefined}
        title={editable ? `Treated water returned to the client's process (storage, UV, pumps). Credited at ${rm(PRICES.reuseCredit_m3)}/m³ when it meets the reuse spec (TDS ≤ ${REUSE_SPEC.TDS.max}, TSS ≤ ${REUSE_SPEC.TSS.max}, COD ≤ ${REUSE_SPEC.COD.max}).` : 'Research the Water reclaim system in the Technology Tree.'}
        style={{ background: '#f4f6f8', color: 'var(--ink)', opacity: editable ? 1 : 0.5 }}
      >
        <DisposalSymbol />
        <span className="pi-name">{editable ? 'Water Reclaim → Process' : '🔒 Water Reclaim'}</span>
      </div>
    );
  return (
    <div
      className="palette-item"
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/ee-unit', liquid ? 'liquidHaul' : 'disposal');
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onAdd}
      title={liquid ? 'Licensed tanker haulage of small volumes of concentrated liquid waste (e.g. nickel concentrate) — costed per m³; not a discharge.' : 'Where sludge or cake leaves site — costed per wet tonne (dewatering pays off here).'}
      style={{ background: '#f4f6f8', color: 'var(--ink)', opacity: editable ? 1 : 0.5 }}
    >
      {liquid ? <TankerSymbol /> : <DisposalSymbol />}
      <span className="pi-name">{liquid ? 'Liquid Waste Haulage' : 'Sludge Disposal'}</span>
    </div>
  );
}

function DisposalInspector({ id, tag, sim }: { id: string; tag: string; sim: SimResult | null }) {
  const d = sim?.disposal.find((x) => x.id === id);
  if (tag.startsWith('RW'))
    return (
      <>
        <div className="mono" style={{ fontSize: 11, color: 'var(--clean)', textTransform: 'uppercase' }}>
          water reclaim
        </div>
        <h2 style={{ marginBottom: 4 }}>Water Reclaim System — {tag}</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Treated water goes back to the client&apos;s process instead of the river. It earns {rm(PRICES.reuseCredit_m3)}/m³ (the water the client no longer buys) — but only if it meets the reuse spec: TDS ≤ {REUSE_SPEC.TDS.max} mg/L, TSS ≤ {REUSE_SPEC.TSS.max}, COD ≤ {REUSE_SPEC.COD.max}, NH₃-N ≤ {REUSE_SPEC.NH3N.max}. That usually means RO permeate or evaporator distillate.
        </p>
        {!sim?.reuse && <p className="muted">Pipe permeate or distillate here.</p>}
        {sim?.reuse && (
          <>
            <div className="calc"><span>Returned to process</span><span>{fmt(sim.reuse.m3d, 1)} m³/d</span></div>
            <div className="calc"><span>On spec</span><span>{fmt(sim.reuse.onSpecM3d, 1)} m³/d</span></div>
            <div className="calc"><span>Reuse credit</span><span>{rm(sim.reuse.creditRMd)}/d</span></div>
            {sim.reuse.offSpec.length > 0 && <p style={{ color: 'var(--alarm)', fontSize: 12 }}>Off spec: {sim.reuse.offSpec.join(', ')}</p>}
          </>
        )}
      </>
    );
  if (d?.liquid || tag.startsWith('LH'))
    return (
      <>
        <div className="mono" style={{ fontSize: 11, color: 'var(--chem)', textTransform: 'uppercase' }}>
          liquid waste
        </div>
        <h2 style={{ marginBottom: 4 }}>Liquid Waste Haulage — {tag}</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          A licensed scheduled-waste contractor tankers the liquid off site ({rm(PRICES.liquidHaul_m3.metal)}/m³ for metal-bearing liquor, {rm(PRICES.liquidHaul_m3.other)}/m³ otherwise). It is not a discharge, so it does not count against the standard or zero-liquid-discharge — but it only pays for small, concentrated streams such as an evaporator&apos;s nickel concentrate.
        </p>
        {!d && <p className="muted">Pipe a concentrate, brine or sludge line here.</p>}
        {d && (
          <>
            <div className="calc"><span>Volume</span><span>{fmt(d.m3d ?? 0, 2)} m³/d · {fmt((d.m3d ?? 0) / PRICES.tanker_m3, 2)} tanker loads/d</span></div>
            <div className="calc"><span>Classification</span><span>{d.metal ? 'Scheduled waste (metal-bearing)' : 'Scheduled waste (general)'}</span></div>
            <div className="calc"><span>Haulage cost</span><span>{rm(d.costRMd)}/d</span></div>
          </>
        )}
      </>
    );
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
      {node.kind === 'electrowinning' && ns?.inlet && (
        <div className="field">
          <label>Auto-size the cell for nickel / copper recovery</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0.8, 0.9, 0.95].map((R) => (
              <button
                key={R}
                className="btn sm"
                disabled={!editable}
                onClick={() => {
                  const z = ewAutoSize(ns.inlet!, R, String(node.params.cathode ?? 'plate'));
                  onParam(node.id, 'area', z.area);
                  onParam(node.id, 'j', z.j);
                }}
              >
                {Math.round(R * 100)} %
              </button>
            ))}
          </div>
          <span className="help">Sets cathode area and current density from the liquor reaching this cell. Higher recovery needs a much bigger cathode (95 % ≈ 5× the area of 80 %). The plated metal is sold automatically — the income shows as a credit in OPEX.</span>
        </div>
      )}
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

/**
 * Design margin: the plant on the design basis at the end-of-contract production level (O&M growth cap) with the feed at
 * the top of its day-to-day variability (+8 % on every load). Weekly O&M samples see these conditions, commissioning
 * does not — a design that only just passes today fails samples later. Run on demand (one extra simulation).
 */
function MarginCheck({ graph, influent, std }: { graph: ProcessGraph; influent: Stream; std: StandardId }) {
  const [res, setRes] = useState<{ key: string; fails: { label: string; value: number; limit: number; unit: string }[]; ok: boolean } | null>(null);
  const key = JSON.stringify(graph.edges.map((e) => [e.from, e.to])) + JSON.stringify(graph.nodes.map((n) => [n.id, n.params, n.inst ?? null]));
  const run = () => {
    const stressed = mapInlets(influent, (x) => {
      const s = cloneStream(x);
      s.Q *= OM.growthCap;
      for (const k of ['SS', 'SI', 'XS', 'XI', 'colloid', 'OGfree', 'OGemulsified', 'NH4N'] as const) s[k] *= 1.08;
      for (const m of METALS) s.dissolved[m] *= 1.08;
      return s;
    });
    const sim = simulate(graph, stressed);
    const rep = sim.effluent ? evaluate(sim.effluent, std, sim) : null;
    setRes({ key, ok: !!rep?.pass, fails: rep ? rep.checks.filter((c) => !c.pass).map((c) => ({ label: c.label, value: c.value, limit: c.limit.max ?? c.limit.min ?? 0, unit: c.unit })) : [] });
  };
  const stale = res && res.key !== key;
  return (
    <div className="note info" style={{ marginTop: 10, fontSize: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span>
          <b>Design margin.</b> Weekly O&amp;M samples see production growth up to +{Math.round((OM.growthCap - 1) * 100)} % and feed swings of ±8 % — commissioning does not.
        </span>
        <button className="btn sm" onClick={run}>
          Check at +{Math.round((OM.growthCap - 1) * 100)} % flow
        </button>
      </div>
      {res && !stale && (
        <div style={{ marginTop: 6 }}>
          {res.ok ? (
            <span style={{ color: 'var(--ok)' }}>Still compliant at end-of-contract flow with a high-load day — good margin.</span>
          ) : (
            <span style={{ color: 'var(--alarm)' }}>
              Would fail in operation: {res.fails.map((f) => `${f.label} ${fmt(f.value, f.value < 10 ? 2 : 0)} ${f.unit} (limit ${f.limit})`).join('; ')}. Add capacity or a polishing step.
            </span>
          )}
        </div>
      )}
      {stale && <div className="muted" style={{ marginTop: 6 }}>Design changed — check again.</div>}
    </div>
  );
}

function StreamBalanceTable({ graph, sim, numbers, selected, onPick }: { graph: ProcessGraph; sim: SimResult | null; numbers: Map<string, number>; selected?: string; onPick: (edgeId: string) => void }) {
  const tag = (id: string) => graph.nodes.find((n) => n.id === id)?.tag ?? (id === 'in' ? 'RAW' : id);
  const cols = graph.edges
    .map((e) => ({ e, no: numbers.get(e.id) ?? 0, s: sim?.edges[e.id] }))
    .filter((c) => c.s)
    .sort((a, b) => a.no - b.no);
  if (!cols.length) return <p className="muted">Connect the train to see the stream table.</p>;
  const std = useStandard();
  const rows: [string, (s: Stream) => number, number, ParamId | null][] = [
    ...STREAM_PARAMS.map((r): [string, (s: Stream) => number, number, ParamId | null] => [r.unit ? `${r.label}, ${r.unit}` : r.label, (s) => r.get(s, measure(s)), r.label === 'Flow' ? 0 : r.dp, r.param]),
    ['Solids, kg/d', (s) => (s.Q * measure(s).TSS) / 1000, 1, null],
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
          {rows.map(([label, f, d, param]) => (
            <tr key={label}>
              <td>{label}</td>
              {cols.map((c) => {
                const v = f(c.s!);
                const over = overLimit(param, v, std, c.s!);
                return (
                  <td key={c.e.id} className={`num ${selected === c.e.id ? 'hi' : ''}`} style={over ? OVER_STYLE : undefined} title={over ? `Above the Standard ${std} limit` : undefined}>
                    {fmtStream(v, d)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** discharge standard of the drawing on screen (project, or the operating plant shown in the Studio) */
function useStandard(): StandardId {
  return useGame((g) => {
    const pl = g.studioPlantId ? g.plants.find((x) => x.id === g.studioPlantId) : undefined;
    if (pl) return pl.standard;
    return g.projects.find((x) => x.id === g.activeProjectId)?.enquiry.standard ?? 'B';
  });
}

/** value outside the discharge limit of this standard (shown red at every stage, not only at the outlet) */
function overLimit(param: ParamId | null, v: number, std: StandardId, s?: Stream): boolean {
  if (!param) return false;
  // Regulation 11(2) combined-metal limits apply only where two or more of the listed metals are present (as in evaluate)
  const lims = { ...limitsFor(std), ...(s && combinedMetalsApply(s) ? STANDARDS.combinedMetals[std] : {}) } as Partial<Record<ParamId, { min?: number; max?: number }>>;
  const l = lims[param];
  if (!l) return false;
  return (l.max !== undefined && v > l.max + 1e-9) || (l.min !== undefined && v < l.min - 1e-9);
}
const OVER_STYLE = { color: 'var(--alarm)', fontWeight: 600 } as const;
/** stream value at its display precision: traces below the last shown decimal read "< 0.001" instead of 4.2e-7 */
const fmtStream = (v: number, dp: number) => (v > 0 && v < Math.pow(10, -dp) ? `< ${Math.pow(10, -dp).toFixed(dp)}` : fmt(v, dp));

/** stream parameters shown in the pipe / outlet panels and the stream table (param = limit to compare against) */
const STREAM_PARAMS: { label: string; param: ParamId | null; unit: string; dp: number; get: (s: Stream, m: ReturnType<typeof measure>) => number }[] = [
  { label: 'Flow', param: null, unit: 'm³/d', dp: 1, get: (s) => s.Q },
  { label: 'Temperature', param: 'T', unit: '°C', dp: 1, get: (_, m) => m.T },
  { label: 'pH', param: 'pH', unit: '', dp: 2, get: (_, m) => m.pH },
  { label: 'COD', param: 'COD', unit: 'mg/L', dp: 1, get: (_, m) => m.COD },
  { label: 'BOD₅', param: 'BOD5', unit: 'mg/L', dp: 1, get: (_, m) => m.BOD5 },
  { label: 'TSS', param: 'TSS', unit: 'mg/L', dp: 1, get: (_, m) => m.TSS },
  { label: 'O&G', param: 'OG', unit: 'mg/L', dp: 1, get: (_, m) => m.OG },
  { label: 'NH₄-N', param: 'NH3N', unit: 'mg/L', dp: 1, get: (_, m) => m.NH3N },
  { label: 'Ni (total)', param: 'Ni', unit: 'mg/L', dp: 2, get: (_, m) => m.Ni },
  { label: 'Cu (total)', param: 'Cu', unit: 'mg/L', dp: 2, get: (_, m) => m.Cu },
  { label: 'Zn (total)', param: 'Zn', unit: 'mg/L', dp: 2, get: (_, m) => m.Zn },
  { label: 'Cr(VI)', param: 'CrVI', unit: 'mg/L', dp: 3, get: (_, m) => m.CrVI },
  { label: 'Cr(III)', param: 'CrIII', unit: 'mg/L', dp: 2, get: (_, m) => m.CrIII },
  { label: 'Al', param: 'Al', unit: 'mg/L', dp: 1, get: (_, m) => m.Al },
  { label: 'Fe', param: 'Fe', unit: 'mg/L', dp: 1, get: (_, m) => m.Fe },
  { label: 'Sulphide (as S)', param: 'Sulphide', unit: 'mg/L', dp: 2, get: (_, m) => m.Sulphide },
  { label: 'Combined metals, total', param: 'MetalsTotal', unit: 'mg/L', dp: 2, get: (_, m) => m.MetalsTotal },
  { label: 'Combined metals, soluble', param: 'MetalsSoluble', unit: 'mg/L', dp: 2, get: (_, m) => m.MetalsSoluble },
  { label: 'TDS', param: null, unit: 'mg/L', dp: 0, get: (s) => tdsTotal(s) },
];

function StreamRows({ s }: { s: Stream }) {
  const std = useStandard();
  const m = measure(s);
  return (
    <>
      {STREAM_PARAMS.map((r) => {
        const v = r.get(s, m);
        const over = overLimit(r.param, v, std, s);
        return (
          <div className="calc" key={r.label} title={over ? `Above the Standard ${std} discharge limit` : undefined}>
            <span style={over ? OVER_STYLE : undefined}>{r.label}</span>
            <span style={over ? OVER_STYLE : undefined}>
              {fmtStream(v, r.dp)} {r.unit}
            </span>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
        <span style={OVER_STYLE}>Red</span> = above the Standard {std} discharge limit at this point.
      </p>
    </>
  );
}

function StreamTable({ title, s }: { title: string; s: Stream }) {
  return (
    <>
      <h2>{title}</h2>
      <StreamRows s={s} />
      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Dissolved / particulate metals: Ni {fmt(s.dissolved.Ni, 2)} / {fmt(s.precipitated.Ni, 2)}, Cu {fmt(s.dissolved.Cu, 2)} / {fmt(s.precipitated.Cu, 2)}, Zn {fmt(s.dissolved.Zn, 2)} / {fmt(s.precipitated.Zn, 2)}, Cr(III) {fmt(s.dissolved.Cr, 2)} / {fmt(s.precipitated.Cr, 2)} mg/L
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
      <div className="calc"><span>Client</span><span>{brand(plant.company)}</span></div>
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
