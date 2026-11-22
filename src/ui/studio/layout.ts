/** Canvas position of a process-graph node: shared by the Studio PFD and the SCADA live view so both draw the same plant. */
import type { PNode } from '../../simulation/treatment/graph';

/**
 * Saved position, else a default row layout. `count` = number of nodes in the drawing: an unplaced final discharge goes
 * to the right of the last default unit slot (a fixed x overlapped long trains).
 */
export function defaultPos(n: PNode, i: number, count = 7): { x: number; y: number } {
  return n.position ?? (n.kind === 'influent' ? { x: 0, y: n.params.source ? 400 : 160 } : n.kind === 'discharge' ? { x: Math.max(1100, 160 + (count - 1) * 190), y: 160 } : { x: 160 + i * 190, y: 160 });
}
