/// <reference lib="webworker" />
/** Runs the steady-state process simulation off the main thread so dragging and typing never stall. */
import { simulate, type ProcessGraph } from '../../simulation/treatment/graph';
import type { Stream } from '../../simulation/core/stream';

export interface SimRequest {
  id: number;
  graph: ProcessGraph;
  influent: Stream;
}

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, graph, influent } = e.data;
  try {
    const result = simulate(graph, influent);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
