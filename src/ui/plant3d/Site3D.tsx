/**
 * 3D site view and editor of the design in the Engineering Studio (react-three-fiber). Same ProcessGraph as the PFD:
 * units at their real size (dims.ts) on a site plan (siteLayout.ts), pipes routed at right angles, water coloured by
 * quality like SCADA. Orthographic camera at the isometric angle, rotatable in 90° steps. Loaded lazily (own chunk).
 * Editing: drag to move (1 m grid), R to rotate, drop units from the palette, click a port then a unit to lay a pipe
 * (same rules as the PFD, editing.ts), Del to delete. Every edit goes through the Studio's undo history.
 */
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, MapControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { PNode, PortId, ProcessGraph, SimResult } from '../../simulation/treatment/graph';
import { REJECT_KINDS } from '../../simulation/treatment/graph';
import type { StandardId } from '../../simulation/treatment/compliance';
import { waterQualityIndex } from '../../simulation/treatment/waterQuality';
import { waterColor } from '../scada/tanks';
import { canConnect, isTerminal, type AddKind } from '../studio/editing';
import { Port3, halfExtents, rotatePort } from './dims';
import { Placed, pinLayout, siteLayout, snapM } from './siteLayout';
import { UnitModel } from './models';

const SLUDGE_COLOR = '#6b4a2a';
const REJECT_COLOR = '#d08a1e';
const IDLE_PIPE = '#9aa7b4';
const ISO_EL = Math.atan(1 / Math.SQRT2); // 35.26°
const PORT_COLOR: Record<string, string> = { in: '#2fbf71', out: '#00a9c8', a: '#00a9c8', b: '#00a9c8', sludge: '#8b5a2b', ras: '#c47a2c' };
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

type SiteRot = 0 | 90 | 180 | 270;

export interface Site3DProps {
  graph: ProcessGraph;
  sim: SimResult | null;
  /** design flow, m³/d (sizes parameters derived from flow) */
  Q: number;
  standard: StandardId;
  editable: boolean;
  selNodes: Set<string>;
  selEdges: Set<string>;
  onSelectNode: (id: string, add: boolean) => void;
  onSelectEdge: (id: string) => void;
  onClear: () => void;
  /** apply an edit through the Studio's undo history (coalesce key merges a drag into one step) */
  onEdit: (fn: (g: ProcessGraph) => ProcessGraph, coalesceKey?: string) => void;
  onAdd: (kind: AddKind, site: NonNullable<PNode['site']>) => void;
  onDelete: (nodeIds: string[], edgeIds: string[]) => void;
  onDuplicate: () => void;
  onConnect: (from: string, port: PortId, to: string) => void;
}

/** world position of a unit port (site placement + rotation) */
function portWorld(pl: Placed, id: Port3['id'], off = { dx: 0, dz: 0 }): { p: THREE.Vector3; dir: THREE.Vector3 } | null {
  const port = pl.dims.ports.find((x) => x.id === id) ?? (id === 'a' || id === 'b' ? pl.dims.ports.find((x) => x.id === 'out') : undefined);
  if (!port) return null;
  const r = rotatePort(port, pl.rot);
  // outward direction: the dominant local axis of the port relative to the unit centre
  const local = Math.abs(port.x) / pl.dims.w >= Math.abs(port.z) / pl.dims.d ? { x: Math.sign(port.x) || 1, z: 0 } : { x: 0, z: Math.sign(port.z) || 1 };
  const dr = rotatePort(local, pl.rot);
  return { p: new THREE.Vector3(pl.x + off.dx + r.x, port.y, pl.z + off.dz + r.z), dir: new THREE.Vector3(dr.x, 0, dr.z) };
}

/** right-angle route: out of the nozzle, down to the pipe run, across x then z, up into the target nozzle */
function route(a: { p: THREE.Vector3; dir: THREE.Vector3 }, b: { p: THREE.Vector3; dir: THREE.Vector3 }, run: number): THREE.Vector3[] {
  const a1 = a.p.clone().addScaledVector(a.dir, 1.2);
  const b1 = b.p.clone().addScaledVector(b.dir, 1.2);
  const pts = [a.p, a1, new THREE.Vector3(a1.x, run, a1.z), new THREE.Vector3(b1.x, run, a1.z), new THREE.Vector3(b1.x, run, b1.z), b1, b.p];
  return pts.filter((v, i) => i === 0 || v.distanceToSquared(pts[i - 1]) > 1e-6);
}

function CameraRig({ center, extent, az, top, fitKey }: { center: THREE.Vector3; extent: number; az: number; top: boolean; fitKey: number }) {
  const { camera, size, controls } = useThree() as unknown as { camera: THREE.OrthographicCamera; size: { width: number; height: number }; controls: { target: THREE.Vector3; update: () => void } | null };
  const last = useRef({ fitKey: -1 });
  useEffect(() => {
    const el = top ? Math.PI / 2 - 0.001 : ISO_EL;
    const a = (az * Math.PI) / 180;
    const target = controls?.target ?? center;
    const refit = last.current.fitKey !== fitKey;
    if (refit) target.copy(center);
    const dist = 400;
    camera.position.set(target.x + dist * Math.cos(el) * Math.sin(a), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(a));
    camera.near = 0.1;
    camera.far = 2000;
    if (refit) camera.zoom = Math.max(2, Math.min(80, Math.min(size.width, size.height) / (extent * 1.05)));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls?.update();
    last.current = { fitKey };
  }, [az, top, fitKey, center, extent, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** exposes a screen → ground-plane projection for HTML drops (palette) */
function GroundPicker({ api }: { api: MutableRefObject<((clientX: number, clientY: number) => THREE.Vector3 | null) | null> }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    api.current = (cx, cy) => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(GROUND, new THREE.Vector3());
    };
  }, [camera, gl, api]);
  return null;
}

export default function Site3D(props: Site3DProps) {
  const { graph, sim, Q, standard, selNodes, selEdges, editable } = props;
  const placed = useMemo(() => siteLayout(graph, Q), [graph, Q]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  // ---- drag (move) state: live offset for the dragged units, committed on release
  const [drag, setDrag] = useState<{ ids: string[]; start: THREE.Vector3; dx: number; dz: number } | null>(null);
  const off = (id: string) => (drag && drag.ids.includes(id) ? { dx: drag.dx, dz: drag.dz } : { dx: 0, dz: 0 });
  // ---- connect state: chosen outlet port; hover target
  const [linkFrom, setLinkFrom] = useState<{ id: string; port: PortId } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<THREE.Vector3 | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  // water colour of each unit = quality of what it lets out (as the SCADA live view)
  const water = useMemo(() => {
    const m = new Map<string, string>();
    const wqOf = (edgeId: string) => (sim?.edges[edgeId] ? waterQualityIndex(sim.edges[edgeId], standard) : null);
    for (const pl of placed) {
      const n = pl.node;
      const outs = graph.edges.filter((e) => e.from === n.id && (e.fromPort ?? 'out') !== 'sludge' && e.fromPort !== 'ras');
      const ins = graph.edges.filter((e) => e.to === n.id);
      const wq = (outs.length ? outs : ins).map((e) => wqOf(e.id)).filter((x): x is number => x !== null);
      m.set(n.id, wq.length ? waterColor(Math.max(...wq)) : n.kind === 'influent' ? waterColor(1) : waterColor(0.5));
    }
    return m;
  }, [placed, graph.edges, sim, standard]);

  const pipes = graph.edges
    .map((e, i) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) return null;
      const port = (e.fromPort ?? 'out') as PortId;
      const pa = portWorld(a, port, off(a.node.id)), pb = portWorld(b, 'in', off(b.node.id));
      if (!pa || !pb) return null;
      const sludge = port === 'ras' || (port === 'sludge' && !REJECT_KINDS.includes(a.node.kind));
      const reject = port === 'sludge' && REJECT_KINDS.includes(a.node.kind);
      const s = sim?.edges[e.id];
      const color = sludge ? SLUDGE_COLOR : reject ? REJECT_COLOR : s ? (s.Q > 1e-6 ? waterColor(waterQualityIndex(s, standard)) : IDLE_PIPE) : IDLE_PIPE;
      const run = (sludge ? 0.25 : 0.55) + (i % 4) * 0.12;
      return { id: e.id, pts: route(pa, pb, run), color };
    })
    .filter((x): x is { id: string; pts: THREE.Vector3[]; color: string } => !!x);

  // site extent → camera fit, slab
  const box = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of placed) {
      const e = halfExtents(p.dims, p.rot);
      x0 = Math.min(x0, p.x - e.hx);
      x1 = Math.max(x1, p.x + e.hx);
      z0 = Math.min(z0, p.z - e.hz);
      z1 = Math.max(z1, p.z + e.hz);
    }
    if (!Number.isFinite(x0)) return { x0: -10, x1: 10, z0: -10, z1: 10 };
    return { x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 };
  }, [placed]);
  const center = useMemo(() => new THREE.Vector3((box.x0 + box.x1) / 2, 0, (box.z0 + box.z1) / 2), [box]);
  const extent = Math.max(box.x1 - box.x0, box.z1 - box.z0);

  const [az, setAz] = useState(45);
  const [top, setTop] = useState(false);
  const [labels, setLabels] = useState(true);
  const [fitKey, setFitKey] = useState(0);
  const [zoom, setZoom] = useState(10);
  const showTags = labels && zoom >= 7;

  // ---- edits
  /** delete, keeping the rest of the site where it is (pin the layout first) */
  const del = (nodeIds: string[], edgeIds: string[]) => {
    if (!editable || (!nodeIds.length && !edgeIds.length)) return;
    if (nodeIds.length) props.onEdit((g) => pinLayout(g, Q), 'pin');
    props.onDelete(nodeIds, edgeIds);
  };
  const rotateSel = (ids: string[]) => {
    const movable = ids.filter((id) => byId.has(id));
    if (!editable || !movable.length) return;
    props.onEdit((g) => {
      const pinned = pinLayout(g, Q);
      return { ...pinned, nodes: pinned.nodes.map((n) => (movable.includes(n.id) && n.site ? { ...n, site: { ...n.site, rot: (((n.site.rot + 90) % 360) as SiteRot) } } : n)) };
    }, `rot:${movable.join(',')}`);
  };
  const commitMove = (ids: string[], dx: number, dz: number) => {
    if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return;
    props.onEdit((g) => {
      const pinned = pinLayout(g, Q);
      return { ...pinned, nodes: pinned.nodes.map((n) => (ids.includes(n.id) && n.site ? { ...n, site: { ...n.site, x: snapM(n.site.x + dx), z: snapM(n.site.z + dz) } } : n)) };
    }, `site:${ids.join(',')}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'q') setAz((a) => (a + 90) % 360);
      else if (k === 'e') setAz((a) => (a + 270) % 360);
      else if (k === 't') setTop((x) => !x);
      else if (k === 'home') setFitKey((x) => x + 1);
      else if (k === 'r') rotateSel([...selNodes]);
      else if (k === 'escape') setLinkFrom(null);
      else if (k === 'delete' || k === 'backspace') del([...selNodes], [...selEdges]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render: reads the current selection

  const unitDown = (pl: Placed) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const id = pl.node.id;
    // finishing a pipe: click the target unit
    if (linkFrom) {
      const r = canConnect(graph, linkFrom.id, linkFrom.port, id);
      if (r.ok) {
        props.onConnect(linkFrom.id, linkFrom.port, id);
        setMsg({ text: `Pipe laid: ${byId.get(linkFrom.id)?.node.tag ?? "unit"} → ${pl.node.tag ?? labelOf(pl.node)}`, ok: true });
        setLinkFrom(null);
      } else setMsg({ text: r.reason ?? 'Not allowed.', ok: false });
      return;
    }
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!selNodes.has(id) || add) props.onSelectNode(id, add);
    if (!editable) return;
    const ids = selNodes.has(id) && !add ? [...selNodes].filter((x) => byId.has(x)) : [id];
    const start = e.ray.intersectPlane(GROUND, new THREE.Vector3());
    if (!start) return;
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    setDrag({ ids, start, dx: 0, dz: 0 });
  };
  const unitMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    const p = e.ray.intersectPlane(GROUND, new THREE.Vector3());
    if (p) setDrag((d) => (d ? { ...d, dx: snapM(p.x - d.start.x), dz: snapM(p.z - d.start.z) } : d));
  };
  const unitUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    commitMove(drag.ids, drag.dx, drag.dz);
    setDrag(null);
  };

  // palette drop
  const pick = useRef<((cx: number, cy: number) => THREE.Vector3 | null) | null>(null);
  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    const kind = ev.dataTransfer.getData('application/ee-unit') as AddKind;
    if (!kind || !editable) return;
    const p = pick.current?.(ev.clientX, ev.clientY);
    if (!p) return;
    // pin the current layout first so nothing else moves, then add at the drop point
    props.onEdit((g) => pinLayout(g, Q), 'pin');
    props.onAdd(kind, { x: snapM(p.x), z: snapM(p.z), rot: 0 });
  };

  const single = selNodes.size === 1 ? byId.get([...selNodes][0]) : undefined;
  const portsFor = editable && !drag ? (linkFrom ? undefined : single) : undefined;
  const hoverCheck = linkFrom && hover && hover !== linkFrom.id ? canConnect(graph, linkFrom.id, linkFrom.port, hover) : null;
  const linkStart = linkFrom ? byId.get(linkFrom.id) : undefined;
  const linkStartPt = linkStart ? portWorld(linkStart, linkFrom!.port)?.p : undefined;

  return (
    <div className="site3d" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Canvas
        orthographic
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ zoom: 10, position: [100, 100, 100], near: 0.1, far: 2000 }}
        onPointerMissed={(e) => {
          if ((e as MouseEvent).button !== 0) return;
          if (linkFrom) setLinkFrom(null);
          else props.onClear();
        }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#dfe7ee']} />
        <hemisphereLight args={['#eef4fa', '#7d8f62', 0.9]} />
        <directionalLight position={[40, 80, 30]} intensity={1.6} />
        <ambientLight intensity={0.25} />
        <GroundPicker api={pick} />
        {/* grass + concrete slab under the plant; pointer moves on the ground drive the pipe preview */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[center.x, -0.02, center.z]}
          onPointerMove={(e) => linkFrom && setCursor(e.point.clone())}
        >
          <planeGeometry args={[extent * 4 + 200, extent * 4 + 200]} />
          <meshStandardMaterial color="#9cb47a" roughness={1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, 0, center.z]} onPointerMove={(e) => linkFrom && setCursor(e.point.clone())}>
          <planeGeometry args={[box.x1 - box.x0, box.z1 - box.z0]} />
          <meshStandardMaterial color="#d3d3cd" roughness={1} />
        </mesh>
        {placed.map((pl) => {
          const id = pl.node.id;
          const sel = selNodes.has(id);
          const o = off(id);
          const e = halfExtents(pl.dims, pl.rot);
          const target = linkFrom && hover === id ? (hoverCheck?.ok ? '#2fbf71' : '#e0533f') : null;
          return (
            <group key={id}>
              <group
                position={[pl.x + o.dx, 0, pl.z + o.dz]}
                rotation={[0, (pl.rot * Math.PI) / 180, 0]}
                onPointerDown={unitDown(pl)}
                onPointerMove={unitMove}
                onPointerUp={unitUp}
                onPointerOver={(ev) => {
                  ev.stopPropagation();
                  setHover(id);
                }}
                onPointerOut={() => setHover((h) => (h === id ? null : h))}
              >
                <UnitModel d={pl.dims} water={water.get(id) ?? waterColor(0.5)} kind={pl.node.kind} />
              </group>
              {(sel || target) && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pl.x + o.dx, 0.03, pl.z + o.dz]}>
                  <planeGeometry args={[2 * e.hx + 1.2, 2 * e.hz + 1.2]} />
                  <meshBasicMaterial color={target ?? '#00a9c8'} transparent opacity={target ? 0.4 : 0.28} />
                </mesh>
              )}
              {(sel || showTags) && (
                <Html position={[pl.x + o.dx, pl.dims.h + 2.2, pl.z + o.dz]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
                  <div className={`u3-label ${sel ? 'sel' : ''}`}>{pl.node.tag ?? labelOf(pl.node)}</div>
                </Html>
              )}
            </group>
          );
        })}
        {/* outlet ports of the selected unit: click one to start a pipe */}
        {portsFor &&
          portsFor.dims.ports
            .filter((pt) => pt.id !== 'in')
            .map((pt) => {
              const w = portWorld(portsFor, pt.id);
              if (!w) return null;
              return (
                <mesh
                  key={pt.id}
                  position={w.p}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    setLinkFrom({ id: portsFor.node.id, port: pt.id as PortId });
                    setMsg({ text: `${portsFor.node.tag} ${pt.id === 'out' ? 'outlet' : pt.id === 'sludge' ? (REJECT_KINDS.includes(portsFor.node.kind) ? 'reject' : 'sludge') : pt.id}: click the unit it feeds (Esc to cancel)`, ok: true });
                  }}
                >
                  <sphereGeometry args={[0.55, 16, 12]} />
                  <meshStandardMaterial color={PORT_COLOR[pt.id] ?? '#00a9c8'} emissive={PORT_COLOR[pt.id] ?? '#00a9c8'} emissiveIntensity={0.4} />
                </mesh>
              );
            })}
        {linkStartPt && cursor && <Line points={[linkStartPt, new THREE.Vector3(cursor.x, linkStartPt.y, cursor.z)]} color="#00a9c8" lineWidth={3} dashed dashSize={0.8} gapSize={0.5} />}
        {pipes.map((p) => (
          <Line
            key={p.id}
            points={p.pts}
            color={selEdges.has(p.id) ? '#00e0ff' : p.color}
            lineWidth={selEdges.has(p.id) ? 6 : 3.5}
            onPointerDown={(e) => {
              if (e.button !== 0 || linkFrom) return;
              e.stopPropagation();
              props.onSelectEdge(p.id);
            }}
          />
        ))}
        <MapControls
          makeDefault
          enableRotate={false}
          screenSpacePanning
          zoomSpeed={2.2}
          zoomToCursor
          mouseButtons={{ LEFT: undefined as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
          minZoom={1.5}
          maxZoom={120}
          onChange={(e) => {
            const z = Math.round(((e?.target as unknown as { object: THREE.OrthographicCamera })?.object?.zoom ?? 10) * 2) / 2;
            setZoom((cur) => (cur === z ? cur : z));
          }}
        />
        <CameraRig center={center} extent={extent} az={az} top={top} fitKey={fitKey} />
      </Canvas>
      <div className="site3d-bar">
        <button className="tb" onClick={() => setAz((a) => (a + 90) % 360)} title="Rotate view 90° (Q)">
          ⟲
        </button>
        <button className="tb" onClick={() => setAz((a) => (a + 270) % 360)} title="Rotate view 90° (E)">
          ⟳
        </button>
        <button className={`tb ${top ? 'on' : ''}`} onClick={() => setTop((x) => !x)} title="Top view (T)">
          Top
        </button>
        <button className="tb" onClick={() => setFitKey((x) => x + 1)} title="Fit the site (Home)">
          ⤢ Fit
        </button>
        <button className={`tb ${labels ? 'on' : ''}`} onClick={() => setLabels((x) => !x)} title="Unit tags">
          Tags
        </button>
        {editable && selNodes.size > 0 && (
          <>
            <span className="tb-sep" />
            <button className="tb" onClick={() => rotateSel([...selNodes])} title="Rotate the selection 90° (R)">
              ↻ Rotate
            </button>
            <button className="tb" onClick={props.onDuplicate} title="Duplicate (Ctrl+D)">
              ⧉ Duplicate
            </button>
            <button className="tb" disabled={[...selNodes].every((id) => { const n = byId.get(id)?.node; return !n || isTerminal(n); })} onClick={() => del([...selNodes], [])} title="Delete (Del)">
              🗑 Delete
            </button>
          </>
        )}
        {editable && selEdges.size > 0 && (
          <>
            <span className="tb-sep" />
            <button className="tb" onClick={() => del([], [...selEdges])} title="Delete the pipe (Del)">
              🗑 Delete pipe
            </button>
          </>
        )}
        <span className="tb-status">{editable ? 'drag units · click a port, then a unit, to pipe · wheel zoom · right-drag pan' : 'view only · wheel zoom · right-drag pan'}</span>
      </div>
      {(() => {
        // one message line: the last action, else the live check of the unit under the cursor while laying a pipe
        const hint = linkFrom && hover && hover !== linkFrom.id && hoverCheck && !hoverCheck.ok ? { text: hoverCheck.reason ?? 'Not allowed.', ok: false } : null;
        const m = msg ?? hint;
        return m ? <div className={`site3d-msg ${m.ok ? '' : 'bad'}`}>{m.text}</div> : null;
      })()}
    </div>
  );
}

function labelOf(n: PNode): string {
  return n.kind === 'influent' ? 'RAW' : n.kind === 'discharge' ? 'OUT' : n.kind;
}
