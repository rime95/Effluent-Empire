/// <reference types="vite/client" />
/**
 * Unit models for the 3D site, built from primitives at the real size from dims.ts (C1 palette: concrete grey, steel,
 * yellow handrails, white GRP tanks, coloured water). Local frame: flow along +x, y up, ground at y = 0.
 */
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { Dims } from './dims';

const mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...o });
export const MAT = {
  concrete: mat('#b9bbb6'),
  concreteDark: mat('#8f918d'),
  steel: mat('#c7cfd6', { metalness: 0.35, roughness: 0.5 }),
  darkSteel: mat('#56616c', { metalness: 0.3, roughness: 0.6 }),
  rail: mat('#f2c230', { roughness: 0.6 }),
  white: mat('#eef1f3', { roughness: 0.7 }),
  grp: mat('#d9d0bf'),
  orange: mat('#e07a2a'),
  blue: mat('#2f6fb7'),
  skip: mat('#e9b311'),
  sludge: mat('#6b4a2a'),
  membrane: mat('#f6f7f8', { roughness: 0.5 }),
  copper: mat('#c46a2d', { metalness: 0.6, roughness: 0.4 }),
  dark: mat('#2b3138'),
  flame: mat('#ff9a2e', { emissive: '#ff7a1a', emissiveIntensity: 0.8 }),
  /** open-topped tank walls are seen from inside too */
  concreteWall: mat('#b9bbb6', { side: THREE.DoubleSide }),
  grpWall: mat('#d9d0bf', { side: THREE.DoubleSide }),
};

const waterCache = new Map<string, THREE.MeshStandardMaterial>();
export function waterMat(color: string): THREE.MeshStandardMaterial {
  let m = waterCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1 });
    waterCache.set(color, m);
  }
  return m;
}

function Box({ size, pos, m }: { size: [number, number, number]; pos: [number, number, number]; m: THREE.Material }) {
  return (
    <mesh position={pos} material={m}>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Cyl({ r, h, pos, m, seg = 24, open = false, rot }: { r: number; h: number; pos: [number, number, number]; m: THREE.Material; seg?: number; open?: boolean; rot?: [number, number, number] }) {
  return (
    <mesh position={pos} material={m} rotation={rot}>
      <cylinderGeometry args={[r, r, h, seg, 1, open]} />
    </mesh>
  );
}

/** handrail along the top edge of a rectangle (top + mid rail) */
function RectRail({ w, d, y }: { w: number; d: number; y: number }) {
  const t = 0.05;
  const rails = [0.55, 1.05].flatMap((dy) => [
    <Box key={`n${dy}`} size={[w, t, t]} pos={[0, y + dy, -d / 2]} m={MAT.rail} />,
    <Box key={`s${dy}`} size={[w, t, t]} pos={[0, y + dy, d / 2]} m={MAT.rail} />,
    <Box key={`w${dy}`} size={[t, t, d]} pos={[-w / 2, y + dy, 0]} m={MAT.rail} />,
    <Box key={`e${dy}`} size={[t, t, d]} pos={[w / 2, y + dy, 0]} m={MAT.rail} />,
  ]);
  const posts = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [w / 2, d / 2],
  ].map(([x, z], i) => <Box key={`p${i}`} size={[t, 1.05, t]} pos={[x, y + 0.53, z]} m={MAT.rail} />);
  return <group>{rails.concat(posts)}</group>;
}

function RectBasin({ d, water }: { d: Dims; water: string }) {
  const t = 0.3;
  const { w, d: dd, h } = d;
  return (
    <group>
      <Box size={[w, h, t]} pos={[0, h / 2, -dd / 2 + t / 2]} m={MAT.concrete} />
      <Box size={[w, h, t]} pos={[0, h / 2, dd / 2 - t / 2]} m={MAT.concrete} />
      <Box size={[t, h, dd - 2 * t]} pos={[-w / 2 + t / 2, h / 2, 0]} m={MAT.concrete} />
      <Box size={[t, h, dd - 2 * t]} pos={[w / 2 - t / 2, h / 2, 0]} m={MAT.concrete} />
      <mesh position={[0, h - 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat(water)}>
        <planeGeometry args={[w - 2 * t, dd - 2 * t]} />
      </mesh>
      {d.aerated &&
        // diffused air: a field of light patches where the air plumes roll the surface
        Array.from({ length: Math.min(40, Math.max(4, Math.round((w * dd) / 12))) }, (_, i) => {
          const cols = Math.max(2, Math.round(Math.sqrt(((w * dd) / 12) * (w / dd))));
          const cx = (i % cols) / cols, cz = Math.floor(i / cols) / Math.ceil(40 / cols);
          return (
            <mesh key={i} position={[-w / 2 + t + (w - 2 * t) * (cx + 0.5 / cols), h - 0.43, -dd / 2 + t + (dd - 2 * t) * Math.min(0.9, cz + 0.15)]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.membrane}>
              <circleGeometry args={[Math.min(0.6, w / cols / 4), 10]} />
            </mesh>
          );
        })}
      <RectRail w={w} d={dd} y={h} />
    </group>
  );
}

function RoundTank({ d, water }: { d: Dims; water: string }) {
  const r = d.r!;
  const h = d.h;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} material={MAT.concreteWall}>
        <cylinderGeometry args={[r, r, h, 48, 1, true]} />
      </mesh>
      <mesh position={[0, h - 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat(water)}>
        <circleGeometry args={[r - 0.15, 48]} />
      </mesh>
      {/* peripheral launder */}
      <mesh position={[0, h - 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.concreteDark}>
        <ringGeometry args={[r - 0.7, r - 0.15, 48]} />
      </mesh>
      {d.bridge && (
        <group>
          <Cyl r={0.45} h={0.9} pos={[0, h + 0.45, 0]} m={MAT.darkSteel} />
          <Box size={[r, 0.25, 0.9]} pos={[r / 2, h + 0.2, 0]} m={MAT.steel} />
          <Box size={[r, 0.05, 0.05]} pos={[r / 2, h + 1.1, -0.45]} m={MAT.rail} />
          <Box size={[r, 0.05, 0.05]} pos={[r / 2, h + 1.1, 0.45]} m={MAT.rail} />
        </group>
      )}
      <mesh position={[0, h + 1.05, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.rail}>
        <torusGeometry args={[r, 0.03, 4, 64]} />
      </mesh>
    </group>
  );
}

function Reactor({ d, water }: { d: Dims; water: string }) {
  const r = d.r!;
  const h = d.h;
  const cx = -d.w / 2 + r + 0.1;
  const liquid = d.liquid ?? water;
  return (
    <group>
      <mesh position={[cx, h / 2, 0]} material={MAT.grpWall}>
        <cylinderGeometry args={[r, r, h, 32, 1, true]} />
      </mesh>
      <mesh position={[cx, h - 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat(liquid)}>
        <circleGeometry args={[r - 0.05, 32]} />
      </mesh>
      {/* mixer bridge + motor */}
      <Box size={[2 * r + 0.2, 0.18, 0.3]} pos={[cx, h + 0.1, 0]} m={MAT.darkSteel} />
      <Box size={[0.45, 0.6, 0.45]} pos={[cx, h + 0.5, 0]} m={MAT.blue} />
      {/* dosing package */}
      <Cyl r={0.32} h={1.3} pos={[d.w / 2 - 0.45, 0.65, -d.d / 4]} m={MAT.white} />
      <Cyl r={0.28} h={1.1} pos={[d.w / 2 - 0.45, 0.55, d.d / 4]} m={MAT.orange} />
      <Box size={[0.5, 0.3, 0.4]} pos={[d.w / 2 - 1.1, 0.15, 0]} m={MAT.darkSteel} />
    </group>
  );
}

function Columns({ d }: { d: Dims }) {
  const r = d.r!;
  const n = d.columns ?? 2;
  const h = d.h - r;
  return (
    <group>
      <Box size={[d.w, 0.2, d.d]} pos={[0, 0.1, 0]} m={MAT.darkSteel} />
      {Array.from({ length: n }, (_, i) => {
        const x = -d.w / 2 + 0.7 + r + i * (2 * r + 0.4);
        return (
          <group key={i} position={[x, 0, 0]}>
            <Cyl r={r} h={h} pos={[0, 0.2 + h / 2, 0]} m={MAT.steel} />
            <mesh position={[0, 0.2 + h, 0]} material={MAT.steel}>
              <sphereGeometry args={[r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
          </group>
        );
      })}
      <Box size={[d.w - 0.6, 0.15, 0.15]} pos={[0, 1, d.d / 2 - 0.2]} m={MAT.blue} />
    </group>
  );
}

function SkidRO({ d }: { d: Dims }) {
  const tubes = [];
  for (let lvl = 0; lvl < 3; lvl++) for (let row = 0; row < 2; row++) tubes.push(<Cyl key={`${lvl}-${row}`} r={0.2} h={d.w - 1.6} pos={[0.3, 0.6 + lvl * 0.6, row ? 0.45 : -0.45]} m={MAT.membrane} rot={[0, 0, Math.PI / 2]} />);
  return (
    <group>
      <Box size={[d.w, 0.15, d.d]} pos={[0, 0.08, 0]} m={MAT.darkSteel} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.1, d.h - 0.2, 0.1]} pos={[sx * (d.w / 2 - 0.9), d.h / 2, sz * (d.d / 2 - 0.2)]} m={MAT.darkSteel} />))}
      {tubes}
      <Cyl r={0.35} h={0.9} pos={[-d.w / 2 + 0.6, 0.6, 0]} m={MAT.steel} rot={[0, 0, Math.PI / 2]} />
      <Box size={[0.6, 1.4, 0.5]} pos={[-d.w / 2 + 0.5, 0.85, d.d / 2 - 0.3]} m={MAT.white} />
    </group>
  );
}

function SkidUF({ d }: { d: Dims }) {
  const mods = [];
  for (let i = 0; i < 6; i++) for (let row = 0; row < 2; row++) mods.push(<Cyl key={`${i}-${row}`} r={0.16} h={2} pos={[-d.w / 2 + 1.2 + i * 0.7, 1.25, row ? 0.4 : -0.4]} m={MAT.membrane} />);
  return (
    <group>
      <Box size={[d.w, 0.15, d.d]} pos={[0, 0.08, 0]} m={MAT.darkSteel} />
      <Box size={[d.w - 1.4, 0.15, 0.15]} pos={[0.3, 0.35, 0]} m={MAT.blue} />
      <Box size={[d.w - 1.4, 0.15, 0.15]} pos={[0.3, 2.35, 0]} m={MAT.blue} />
      {mods}
      <Box size={[0.6, 1.4, 0.5]} pos={[d.w / 2 - 0.5, 0.85, d.d / 2 - 0.3]} m={MAT.white} />
    </group>
  );
}

function TallVessel({ d, water }: { d: Dims; water: string }) {
  const r = d.r!;
  return (
    <group>
      <Cyl r={r} h={d.h} pos={[0, d.h / 2, 0]} m={MAT.concrete} seg={36} />
      <mesh position={[0, d.h + 0.6, 0]} material={MAT.steel}>
        <coneGeometry args={[r, 1.2, 36]} />
      </mesh>
      <mesh position={[0, d.h - 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat(water)}>
        <ringGeometry args={[r * 0.98, r + 0.05, 36]} />
      </mesh>
      {/* biogas line and flare */}
      <Box size={[0.12, 0.12, r + 3]} pos={[0, d.h + 1.1, (r + 3) / 2]} m={MAT.steel} />
      <Cyl r={0.12} h={d.h + 1} pos={[0, (d.h + 1) / 2, r + 3]} m={MAT.steel} />
      <mesh position={[0, d.h + 1.5, r + 3]} material={MAT.flame}>
        <coneGeometry args={[0.25, 0.8, 8]} />
      </mesh>
    </group>
  );
}

function Evaporator({ d }: { d: Dims }) {
  return (
    <group>
      <Box size={[d.w, 0.2, d.d]} pos={[0, 0.1, 0]} m={MAT.concreteDark} />
      <Cyl r={1.3} h={d.h - 1} pos={[-d.w / 2 + 1.6, (d.h - 1) / 2 + 0.2, -d.d / 2 + 1.6]} m={MAT.steel} />
      <mesh position={[-d.w / 2 + 1.6, d.h - 0.3, -d.d / 2 + 1.6]} material={MAT.steel}>
        <sphereGeometry args={[1.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <Cyl r={0.55} h={3.6} pos={[0.8, 1.6, 0.6]} m={MAT.steel} rot={[0, 0, Math.PI / 2]} />
      <Box size={[1.6, 1.5, 1.4]} pos={[d.w / 2 - 1.1, 0.95, -d.d / 2 + 1.2]} m={MAT.blue} />
      <Cyl r={0.6} h={1.6} pos={[d.w / 2 - 1, 1, d.d / 2 - 1]} m={MAT.white} />
    </group>
  );
}

function Press({ d }: { d: Dims }) {
  const plates = Math.max(6, Math.round((d.w - 1.4) / 0.12));
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.15, 1.6, 0.15]} pos={[sx * (d.w / 2 - 0.2), 0.8, sz * (d.d / 2 - 0.2)]} m={MAT.darkSteel} />))}
      <Box size={[d.w, 0.15, d.d]} pos={[0, 1.6, 0]} m={MAT.darkSteel} />
      {Array.from({ length: plates }, (_, i) => (
        <Box key={i} size={[0.09, 1, 1.4]} pos={[-d.w / 2 + 0.9 + i * 0.12, 2.2, 0]} m={MAT.concreteDark} />
      ))}
      <Cyl r={0.2} h={0.9} pos={[-d.w / 2 + 0.4, 2.2, 0]} m={MAT.steel} rot={[0, 0, Math.PI / 2]} />
      {/* cake skip under the press */}
      <Box size={[Math.min(d.w - 1, 3), 0.9, 1.6]} pos={[0, 0.45, 0]} m={MAT.skip} />
      <Box size={[Math.min(d.w - 1.2, 2.8), 0.1, 1.4]} pos={[0, 0.85, 0]} m={MAT.sludge} />
    </group>
  );
}

function Dryer({ d }: { d: Dims }) {
  return (
    <group>
      <Box size={[d.w - 1, d.h - 0.6, d.d]} pos={[0.5, (d.h - 0.6) / 2 + 0.2, 0]} m={MAT.steel} />
      <Box size={[1, 1.2, 1]} pos={[-d.w / 2 + 0.5, 1.2, 0]} m={MAT.darkSteel} />
      <Cyl r={0.3} h={2.2} pos={[d.w / 2 - 1.2, d.h + 0.8, 0]} m={MAT.darkSteel} />
      <Box size={[1.1, 1, 1.1]} pos={[d.w / 2 - 0.6, 0.5, d.d / 2 + 0.3]} m={MAT.white} />
    </group>
  );
}

function CellTank({ d }: { d: Dims }) {
  const plates = Math.max(4, Math.round(d.w / 0.35));
  return (
    <group>
      <Box size={[d.w, d.h, d.d]} pos={[0, d.h / 2, 0]} m={MAT.grp} />
      <mesh position={[0, d.h + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat('#2f9e57')}>
        <planeGeometry args={[d.w - 0.2, d.d - 0.2]} />
      </mesh>
      {Array.from({ length: plates }, (_, i) => (
        <Box key={i} size={[0.03, 0.6, d.d - 0.4]} pos={[-d.w / 2 + 0.2 + i * ((d.w - 0.4) / (plates - 1)), d.h + 0.15, 0]} m={MAT.steel} />
      ))}
      <Box size={[d.w, 0.08, 0.08]} pos={[0, d.h + 0.48, -0.4]} m={MAT.copper} />
      <Box size={[d.w, 0.08, 0.08]} pos={[0, d.h + 0.48, 0.4]} m={MAT.copper} />
      <Box size={[1, 1.8, 0.8]} pos={[d.w / 2 + 0.8, 0.9, 0]} m={MAT.steel} />
    </group>
  );
}

function Terminal({ d, water }: { d: Dims; water: string }) {
  switch (d.shape) {
    case 'inletPit':
    case 'outfall':
      return (
        <group>
          <Box size={[d.w, d.h, d.d]} pos={[0, d.h / 2, 0]} m={MAT.concreteDark} />
          <mesh position={[0, d.h + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat(water)}>
            <planeGeometry args={[d.w - 0.4, d.d - 0.4]} />
          </mesh>
        </group>
      );
    case 'skip':
      return (
        <group>
          <Box size={[d.w, d.h, d.d]} pos={[0, d.h / 2, 0]} m={MAT.skip} />
          <Box size={[d.w - 0.3, 0.05, d.d - 0.3]} pos={[0, d.h - 0.1, 0]} m={MAT.sludge} />
        </group>
      );
    case 'tankerPad':
      return (
        <group>
          <Box size={[d.w, 0.15, d.d]} pos={[0, 0.08, 0]} m={MAT.concreteDark} />
          <Cyl r={1} h={d.w - 1.5} pos={[0.2, 1.4, 0]} m={MAT.steel} rot={[0, 0, Math.PI / 2]} />
          <Box size={[1.2, 1.6, d.d - 0.4]} pos={[-d.w / 2 + 0.7, 1, 0]} m={MAT.white} />
        </group>
      );
    case 'reclaimTank':
      return (
        <group>
          <Cyl r={d.r!} h={d.h} pos={[0, d.h / 2, 0]} m={MAT.white} seg={32} />
          <mesh position={[0, d.h + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMat('#3f97d8')}>
            <circleGeometry args={[d.r! - 0.1, 32]} />
          </mesh>
        </group>
      );
    default:
      return (
        <group>
          <Box size={[d.w, d.h, d.d]} pos={[0, d.h / 2, 0]} m={MAT.concrete} />
          <Box size={[d.w - 0.2, 0.05, d.d - 0.2]} pos={[0, d.h + 0.02, 0]} m={MAT.darkSteel} />
        </group>
      );
  }
}

/**
 * Detailed Meshy models (GLB) for fixed-size skids (art/README.md). Each is scaled uniformly to fit the unit's
 * footprint and height from dims.ts and set on the ground; if a file is missing or fails, the code-built model shows.
 */
export const GLB_MODELS: Partial<Record<string, string>> = {
  // RO skid pilot (2026-11-28, 30 credits) not used: a dark artefact from the source sprite was baked into the mesh and the
  // file was 4 MB; the code-built skid reads as well. The GLB is kept in art/source/models/ro.glb. Add entries as 'kind': 'models/x.glb'.
};

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function GlbModel({ url, d }: { url: string; d: Dims }) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => {
    const o = scene.clone(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const s = Math.min(d.w / Math.max(size.x, 1e-6), d.d / Math.max(size.z, 1e-6), (d.h * 1.4) / Math.max(size.y, 1e-6));
    o.scale.setScalar(s);
    const b2 = new THREE.Box3().setFromObject(o);
    const c = b2.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -b2.min.y, -c.z);
    return o;
  }, [scene, d.w, d.d, d.h]);
  return <primitive object={obj} />;
}

/** the model for a unit: its Meshy GLB where one exists, else the code-built shape */
export function UnitModel({ d, water, kind }: { d: Dims; water: string; kind?: string }) {
  const glb = kind ? GLB_MODELS[kind] : undefined;
  const built = <BuiltModel d={d} water={water} />;
  if (!glb) return built;
  return (
    <Fallback fallback={built}>
      <Suspense fallback={built}>
        <GlbModel url={`${import.meta.env.BASE_URL}${glb}`} d={d} />
      </Suspense>
    </Fallback>
  );
}

function BuiltModel({ d, water }: { d: Dims; water: string }) {
  return useMemo(() => {
    switch (d.shape) {
      case 'rectBasin':
        return <RectBasin d={d} water={water} />;
      case 'roundTank':
        return <RoundTank d={d} water={water} />;
      case 'reactor':
        return <Reactor d={d} water={water} />;
      case 'columns':
        return <Columns d={d} />;
      case 'skidRO':
        return <SkidRO d={d} />;
      case 'skidUF':
        return <SkidUF d={d} />;
      case 'tallVessel':
        return <TallVessel d={d} water={water} />;
      case 'evaporator':
        return <Evaporator d={d} />;
      case 'press':
        return <Press d={d} />;
      case 'dryer':
        return <Dryer d={d} />;
      case 'cellTank':
        return <CellTank d={d} />;
      default:
        return <Terminal d={d} water={water} />;
    }
  }, [d, water]);
}
