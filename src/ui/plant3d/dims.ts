/**
 * 3D size and nozzle positions of every unit, from its own design parameters (pure). Ref: knowledge/ui/plant3d.md.
 * GAME MODEL for the shapes: typical side-water depths and aspect ratios; the area or volume the engineer sized is
 * kept exactly, so a bigger design really is a bigger tank on the site.
 * Local frame: flow runs along +x (inlet on −x, outlet on +x), y up, z across; metres. Site rotation is applied later.
 */
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import type { PNode, PortId } from '../../simulation/treatment/graph';

export type Shape =
  | 'rectBasin' | 'roundTank' | 'reactor' | 'columns' | 'skidRO' | 'skidUF' | 'tallVessel' | 'evaporator' | 'press' | 'dryer'
  | 'cellTank' | 'junction' | 'inletPit' | 'outfall' | 'skip' | 'tankerPad' | 'reclaimTank';

export type Port3Id = PortId | 'in';
export interface Port3 {
  id: Port3Id;
  /** local position, m */
  x: number;
  y: number;
  z: number;
}

export interface Dims {
  shape: Shape;
  /** footprint length along flow (x), width (z) and height (y), m */
  w: number;
  d: number;
  h: number;
  /** round shapes: radius, m */
  r?: number;
  ports: Port3[];
  /** shape details */
  columns?: number;
  /** clarifier / thickener: rotating bridge; aeration / MBR: diffused air */
  bridge?: boolean;
  aerated?: boolean;
  /** stirred reactors: liquid tint override (chromate yellow, sulfide grey …) */
  liquid?: string;
}

const n = (p: PNode['params'], k: string, fallback: number) => {
  const v = Number(p[k]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const def = (kind: UnitType, key: string, Q: number) => {
  const d = CATALOGUE[kind]?.params.find((x) => x.key === key)?.default(Q);
  return typeof d === 'number' ? d : Number(d) || 0;
};

/** rectangle of a given plan area with length:width = ratio (length along flow) */
function rect(area: number, ratio: number) {
  const w = Math.sqrt(Math.max(area, 0.5) * ratio);
  return { w, d: Math.max(area, 0.5) / w };
}

const SLUDGE_KINDS_BOTTOM = new Set(['clarifier', 'thickener', 'oilSep', 'daf', 'sandFilter', 'mbr', 'aop', 'filterPress', 'dryer']);
const REJECT = new Set(['uf', 'ro', 'ionExchange', 'evaporator']);

function withPorts(base: Omit<Dims, 'ports'>, kind: string): Dims {
  const { w, d, h } = base;
  const top = Math.max(0.6, h * 0.8);
  const ports: Port3[] = [];
  if (kind !== 'influent') ports.push({ id: 'in', x: -w / 2, y: top, z: 0 });
  if (kind === 'splitter') {
    ports.push({ id: 'a', x: w / 2, y: top, z: -d / 4 }, { id: 'b', x: w / 2, y: top, z: d / 4 });
  } else if (kind !== 'discharge' && kind !== 'disposal') {
    ports.push({ id: 'out', x: w / 2, y: top, z: 0 });
  }
  if (SLUDGE_KINDS_BOTTOM.has(kind)) ports.push({ id: 'sludge', x: w / 4, y: 0.3, z: d / 2 });
  if (REJECT.has(kind)) ports.push({ id: 'sludge', x: w / 2, y: Math.max(0.5, h * 0.35), z: d / 3 });
  if (kind === 'clarifier') ports.push({ id: 'ras', x: -w / 4, y: 0.3, z: d / 2 });
  return { ...base, ports };
}

/** 3D dimensions of a node (Q = design flow, m³/d, for parameters derived from flow) */
export function unitDims(node: Pick<PNode, 'kind' | 'params'>, Q: number): Dims {
  const p = node.params ?? {};
  const k = node.kind;
  const U = k as UnitType;
  switch (k) {
    case 'eq': {
      const V = n(p, 'volume', def(U, 'volume', Q));
      return withPorts({ shape: 'rectBasin', ...rect(V / 4, 2), h: 4.5 }, k);
    }
    case 'activatedSludge': {
      const V = n(p, 'volume', def(U, 'volume', Q));
      return withPorts({ shape: 'rectBasin', ...rect(V / 4.5, 2.5), h: 5, aerated: true }, k);
    }
    case 'mbr': {
      const V = n(p, 'volume', def(U, 'volume', Q));
      return withPorts({ shape: 'rectBasin', ...rect(V / 4, 2), h: 4.5, aerated: true }, k);
    }
    case 'oilSep': {
      const A = n(p, 'area', def(U, 'area', Q));
      return withPorts({ shape: 'rectBasin', ...rect(A, 3), h: 2.2 }, k);
    }
    case 'daf': {
      const A = n(p, 'area', def(U, 'area', Q));
      return withPorts({ shape: 'rectBasin', ...rect(A, 3), h: 2.6 }, k);
    }
    case 'sandFilter': {
      const A = n(p, 'area', def(U, 'area', Q));
      return withPorts({ shape: 'rectBasin', ...rect(A, 1.5), h: 3.2 }, k);
    }
    case 'coagulation': {
      // flash mix + flocculation chamber: volume = Q × floc time
      const V = Math.max(2, (Q / 1440) * n(p, 'flocTime', 20) * 1.15);
      return withPorts({ shape: 'rectBasin', ...rect(V / 3, 2), h: 3.4 }, k);
    }
    case 'clarifier':
    case 'thickener': {
      const A = n(p, 'area', def(U, 'area', Q));
      const r = Math.sqrt(A / Math.PI);
      const h = k === 'clarifier' ? n(p, 'depth', 3.5) : 3.5;
      return withPorts({ shape: 'roundTank', w: 2 * r, d: 2 * r, h, r, bridge: true }, k);
    }
    case 'neutralisation':
    case 'precipitation':
    case 'crReduction':
    case 'sulfide':
    case 'aop': {
      const V = n(p, 'volume', def(U, 'volume', Q));
      const D = Math.max(1.2, Math.cbrt((4 * V) / Math.PI)); // H ≈ D
      const liquid = k === 'crReduction' ? '#d9a21b' : k === 'sulfide' ? '#3b3f44' : k === 'aop' ? '#c9a24a' : undefined;
      return withPorts({ shape: 'reactor', w: D + 1.6, d: D + 0.6, h: D, r: D / 2, liquid }, k);
    }
    case 'uasb': {
      const V = n(p, 'volume', def(U, 'volume', Q));
      const H = 6;
      const D = Math.max(2, Math.sqrt((4 * V) / (Math.PI * H)));
      return withPorts({ shape: 'tallVessel', w: D, d: D, h: H, r: D / 2 }, k);
    }
    case 'carbon': {
      // two vessels in series, bed volume = Q × EBCT
      const Vb = Math.max(0.5, (Q / 1440) * n(p, 'ebct', 15));
      const D = Math.max(0.8, Math.sqrt((4 * (Vb / 2)) / (Math.PI * 2.5)));
      return withPorts({ shape: 'columns', w: 2 * D + 1.4, d: D + 0.8, h: 3.6, r: D / 2, columns: 2 }, k);
    }
    case 'ionExchange': {
      const R = n(p, 'resin', def(U, 'resin', Q) || 1);
      const D = Math.max(0.6, Math.sqrt((4 * R) / (Math.PI * 1.5)));
      return withPorts({ shape: 'columns', w: 2 * D + 1.4, d: D + 0.8, h: 3.2, r: D / 2, columns: 2 }, k);
    }
    case 'electrowinning': {
      const A = n(p, 'area', 10);
      const L = Math.min(30, 2 + A / 12);
      return withPorts({ shape: 'cellTank', w: L, d: 1.6, h: 1.6 }, k);
    }
    case 'uf':
      return withPorts({ shape: 'skidUF', w: 6, d: 2.4, h: 3 }, k);
    case 'ro':
      return withPorts({ shape: 'skidRO', w: 8, d: 2.4, h: 2.6 }, k);
    case 'evaporator':
      return withPorts({ shape: 'evaporator', w: 6, d: 5, h: 8, r: 1.3 }, k);
    case 'dryer':
      return withPorts({ shape: 'dryer', w: 8, d: 3, h: 3 }, k);
    case 'filterPress': {
      const V = n(p, 'volume', 0.5);
      return withPorts({ shape: 'press', w: Math.min(14, 3 + V * 5), d: 2.2, h: 2.4 }, k);
    }
    case 'splitter':
    case 'mixer':
      return withPorts({ shape: 'junction', w: 1.4, d: 1.4, h: 1.2 }, k);
    case 'influent':
      return withPorts({ shape: 'inletPit', w: 3, d: 3, h: 1.2 }, k);
    case 'discharge':
      return withPorts({ shape: 'outfall', w: 3, d: 2.5, h: 1.2 }, k);
    case 'disposal': {
      if (p.reuse === 'yes') return withPorts({ shape: 'reclaimTank', w: 4, d: 4, h: 4.5, r: 2 }, k);
      if (p.liquid === 'yes') return withPorts({ shape: 'tankerPad', w: 7, d: 3, h: 3 }, k);
      return withPorts({ shape: 'skip', w: 4, d: 2.2, h: 1.6 }, k);
    }
    default:
      return withPorts({ shape: 'junction', w: 2, d: 2, h: 2 }, k);
  }
}

/** footprint corners (axis-aligned after rotation): half sizes along world x and z */
export function halfExtents(d: Dims, rot: number): { hx: number; hz: number } {
  const turned = rot === 90 || rot === 270;
  return turned ? { hx: d.d / 2, hz: d.w / 2 } : { hx: d.w / 2, hz: d.d / 2 };
}

/** local → site offset for a port, after the unit's rotation (degrees, about +y, counter-clockwise from above) */
export function rotatePort(pt: { x: number; z: number }, rot: number): { x: number; z: number } {
  const a = (rot * Math.PI) / 180;
  return { x: pt.x * Math.cos(a) + pt.z * Math.sin(a), z: -pt.x * Math.sin(a) + pt.z * Math.cos(a) };
}
