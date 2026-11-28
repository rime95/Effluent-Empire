/**
 * 3D site view of the design in the Engineering Studio (react-three-fiber). Same ProcessGraph as the PFD: units at
 * their real size (dims.ts) on a site plan (siteLayout.ts), pipes routed at right angles, water coloured by quality
 * like SCADA. Orthographic camera at the isometric angle, rotatable in 90° steps. Loaded lazily (own chunk).
 */
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, MapControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PNode, PortId, ProcessGraph, SimResult } from '../../simulation/treatment/graph';
import { REJECT_KINDS } from '../../simulation/treatment/graph';
import type { StandardId } from '../../simulation/treatment/compliance';
import { waterQualityIndex } from '../../simulation/treatment/waterQuality';
import { waterColor } from '../scada/tanks';
import { Port3, halfExtents, rotatePort } from './dims';
import { Placed, siteLayout } from './siteLayout';
import { UnitModel } from './models';

const SLUDGE_COLOR = '#6b4a2a';
const REJECT_COLOR = '#d08a1e';
const IDLE_PIPE = '#9aa7b4';
const ISO_EL = Math.atan(1 / Math.SQRT2); // 35.26°

export interface Site3DProps {
  graph: ProcessGraph;
  sim: SimResult | null;
  /** design flow, m³/d (sizes parameters derived from flow) */
  Q: number;
  standard: StandardId;
  selNodes: Set<string>;
  selEdges: Set<string>;
  onSelectNode: (id: string, add: boolean) => void;
  onSelectEdge: (id: string) => void;
  onClear: () => void;
}

/** world position of a unit port (site placement + rotation) */
function portWorld(pl: Placed, id: Port3['id']): { p: THREE.Vector3; dir: THREE.Vector3 } | null {
  const port = pl.dims.ports.find((x) => x.id === id) ?? (id === 'a' || id === 'b' ? pl.dims.ports.find((x) => x.id === 'out') : undefined);
  if (!port) return null;
  const r = rotatePort(port, pl.rot);
  // outward direction: the dominant local axis of the port relative to the unit centre
  const local = Math.abs(port.x) / pl.dims.w >= Math.abs(port.z) / pl.dims.d ? { x: Math.sign(port.x) || 1, z: 0 } : { x: 0, z: Math.sign(port.z) || 1 };
  const dr = rotatePort(local, pl.rot);
  return { p: new THREE.Vector3(pl.x + r.x, port.y, pl.z + r.z), dir: new THREE.Vector3(dr.x, 0, dr.z) };
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
  const last = useRef({ az: NaN, top: false, fitKey: -1 });
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
    last.current = { az, top, fitKey };
  }, [az, top, fitKey, center, extent, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function Site3D(props: Site3DProps) {
  const { graph, sim, Q, standard, selNodes, selEdges } = props;
  const placed = useMemo(() => siteLayout(graph, Q), [graph, Q]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

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

  const pipes = useMemo(() => {
    return graph.edges
      .map((e, i) => {
        const a = byId.get(e.from), b = byId.get(e.to);
        if (!a || !b) return null;
        const port = (e.fromPort ?? 'out') as PortId;
        const pa = portWorld(a, port), pb = portWorld(b, 'in');
        if (!pa || !pb) return null;
        const sludge = port === 'ras' || (port === 'sludge' && !REJECT_KINDS.includes(a.node.kind));
        const reject = port === 'sludge' && REJECT_KINDS.includes(a.node.kind);
        const s = sim?.edges[e.id];
        const color = sludge ? SLUDGE_COLOR : reject ? REJECT_COLOR : s ? (s.Q > 1e-6 ? waterColor(waterQualityIndex(s, standard)) : IDLE_PIPE) : IDLE_PIPE;
        const run = (sludge ? 0.25 : 0.55) + (i % 4) * 0.12;
        return { id: e.id, pts: route(pa, pb, run), color };
      })
      .filter((x): x is { id: string; pts: THREE.Vector3[]; color: string } => !!x);
  }, [graph.edges, byId, sim, standard]);

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
  // tags only when zoomed in enough to read them (always for the selection)
  const [zoom, setZoom] = useState(10);
  const showTags = labels && zoom >= 7;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'q') setAz((a) => (a + 90) % 360);
      else if (k === 'e') setAz((a) => (a + 270) % 360);
      else if (k === 't') setTop((x) => !x);
      else if (k === 'home') setFitKey((x) => x + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    props.onSelectNode(id, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  return (
    <div className="site3d">
      <Canvas orthographic frameloop="demand" dpr={[1, 1.5]} camera={{ zoom: 10, position: [100, 100, 100], near: 0.1, far: 2000 }} onPointerMissed={() => props.onClear()} gl={{ antialias: true }}>
        <color attach="background" args={['#dfe7ee']} />
        <hemisphereLight args={['#eef4fa', '#7d8f62', 0.9]} />
        <directionalLight position={[40, 80, 30]} intensity={1.6} />
        <ambientLight intensity={0.25} />
        {/* grass + concrete slab under the plant */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, -0.02, center.z]}>
          <planeGeometry args={[extent * 4 + 200, extent * 4 + 200]} />
          <meshStandardMaterial color="#9cb47a" roughness={1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, 0, center.z]}>
          <planeGeometry args={[box.x1 - box.x0, box.z1 - box.z0]} />
          <meshStandardMaterial color="#d3d3cd" roughness={1} />
        </mesh>
        {placed.map((pl) => {
          const sel = selNodes.has(pl.node.id);
          const e = halfExtents(pl.dims, pl.rot);
          return (
            <group key={pl.node.id}>
              <group position={[pl.x, 0, pl.z]} rotation={[0, (pl.rot * Math.PI) / 180, 0]} onClick={pick(pl.node.id)}>
                <UnitModel d={pl.dims} water={water.get(pl.node.id) ?? waterColor(0.5)} />
              </group>
              {sel && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pl.x, 0.03, pl.z]}>
                  <planeGeometry args={[2 * e.hx + 1.2, 2 * e.hz + 1.2]} />
                  <meshBasicMaterial color="#00a9c8" transparent opacity={0.28} />
                </mesh>
              )}
              {(sel || showTags) && (
                <Html position={[pl.x, pl.dims.h + 2.2, pl.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
                  <div className={`u3-label ${sel ? 'sel' : ''}`}>{pl.node.tag ?? labelOf(pl.node)}</div>
                </Html>
              )}
            </group>
          );
        })}
        {pipes.map((p) => (
          <Line
            key={p.id}
            points={p.pts}
            color={selEdges.has(p.id) ? '#00e0ff' : p.color}
            lineWidth={selEdges.has(p.id) ? 6 : 3.5}
            onClick={(e) => {
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
        <span className="tb-status">wheel zoom · right-drag pan · click to select</span>
      </div>
    </div>
  );
}

function labelOf(n: PNode): string {
  return n.kind === 'influent' ? 'RAW' : n.kind === 'discharge' ? 'OUT' : n.kind;
}
