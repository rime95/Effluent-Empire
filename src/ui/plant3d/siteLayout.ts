/**
 * Default site plan (pure). Units the player has not placed in 3D are laid out from the PFD: the PFD rows become rows
 * on the site and the left-to-right order is kept, but spacing follows the real footprints (unitDims) with a 3 m
 * access gap, so tanks never overlap whatever their size. A long row folds back and forth in lanes of about 45 m
 * (units on a returning lane are turned 180° so they still face the flow), giving a compact plot like a real site.
 * Units placed in 3D (node.site) keep their position.
 */
import type { PNode, ProcessGraph } from '../../simulation/treatment/graph';
import { defaultPos } from '../studio/layout';
import { Dims, halfExtents, unitDims } from './dims';

export interface Placed {
  node: PNode;
  dims: Dims;
  x: number;
  z: number;
  rot: 0 | 90 | 180 | 270;
  /** true when the position comes from node.site (placed by the player) */
  placed: boolean;
}

export const SITE_GAP = 3;
/** lane length before a row folds back, m */
export const LANE_MAX = 45;
const ROW_PX = 120;

export function siteLayout(g: ProcessGraph, Q: number): Placed[] {
  const all = g.nodes.map((n, i) => ({ n, i, dims: unitDims(n, Q), pos: defaultPos(n, i, g.nodes.length) }));
  const out: Placed[] = [];
  // rows by PFD height, top to bottom; units along each row by PFD x
  const auto = all.filter((a) => !a.n.site);
  const rows = new Map<number, typeof auto>();
  for (const a of auto) {
    const key = Math.round(a.pos.y / ROW_PX);
    rows.set(key, [...(rows.get(key) ?? []), a]);
  }
  let z = 0;
  for (const key of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(key)!.sort((a, b) => a.pos.x - b.pos.x);
    // split the row into lanes of at most LANE_MAX (a unit longer than a lane gets a lane of its own)
    const lanes: (typeof row)[] = [[]];
    let len = 0;
    for (const a of row) {
      const step = a.dims.w + SITE_GAP + 1;
      if (len > 0 && len + a.dims.w > LANE_MAX) {
        lanes.push([]);
        len = 0;
      }
      lanes[lanes.length - 1].push(a);
      len += step;
    }
    lanes.forEach((lane, li) => {
      const depth = Math.max(...lane.map((a) => a.dims.d));
      const laneZ = z + depth / 2;
      const back = li % 2 === 1;
      const total = lane.reduce((s, a) => s + a.dims.w, 0) + (lane.length - 1) * (SITE_GAP + 1);
      let x = back ? total : 0;
      for (const a of lane) {
        const cx = back ? x - a.dims.w / 2 : x + a.dims.w / 2;
        out.push({ node: a.n, dims: a.dims, x: cx, z: laneZ, rot: back ? 180 : 0, placed: false });
        x += (back ? -1 : 1) * (a.dims.w + SITE_GAP + 1);
      }
      z += depth + SITE_GAP * 2.5;
    });
    z += SITE_GAP;
  }
  for (const a of all.filter((a) => a.n.site)) out.push({ node: a.n, dims: a.dims, x: a.n.site!.x, z: a.n.site!.z, rot: a.n.site!.rot, placed: true });
  return out;
}

/** axis-aligned footprint rectangles of two placed units overlap (with a clearance, m) */
export function overlaps(a: Placed, b: Placed, clearance = 0): boolean {
  const ea = halfExtents(a.dims, a.rot), eb = halfExtents(b.dims, b.rot);
  return Math.abs(a.x - b.x) < ea.hx + eb.hx + clearance && Math.abs(a.z - b.z) < ea.hz + eb.hz + clearance;
}
