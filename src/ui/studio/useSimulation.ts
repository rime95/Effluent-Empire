import { useEffect, useRef, useState } from 'react';
import { simulate, type ProcessGraph, type SimResult } from '../../simulation/treatment/graph';
import type { Stream } from '../../simulation/core/stream';

/** Graph identity ignoring canvas positions — the simulation only reruns when the process changes. */
export function processKey(g: ProcessGraph): string {
  return JSON.stringify({ n: g.nodes.map((n) => [n.id, n.kind, n.params, !!n.bypass, n.inst ?? null]), e: g.edges.map((e) => [e.from, e.to, e.fromPort ?? 'out']) });
}

let worker: Worker | null | undefined;
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

let seq = 0;

/**
 * Debounced, latest-request-wins simulation in a Web Worker (synchronous fallback without Worker support).
 * Keeps showing the previous result while a new one is computed.
 */
export function useSimulation(graph: ProcessGraph | null, influent: Stream | null, delayMs = 120): { sim: SimResult | null; busy: boolean } {
  const [sim, setSim] = useState<SimResult | null>(() => (graph && influent ? simulate(graph, influent) : null));
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const key = graph ? processKey(graph) : '';
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    const g = graphRef.current;
    if (!g || !influent) {
      setSim(null);
      return;
    }
    const id = ++seq;
    latest.current = id;
    setBusy(true);
    const w = getWorker();
    let onMsg: ((e: MessageEvent) => void) | null = null;
    const t = setTimeout(() => {
      if (w) {
        onMsg = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          if (latest.current === id) {
            if (e.data.result) setSim(e.data.result as SimResult);
            setBusy(false);
          }
          w.removeEventListener('message', onMsg!);
        };
        w.addEventListener('message', onMsg);
        w.postMessage({ id, graph: g, influent });
      } else {
        const r = simulate(g, influent);
        if (latest.current === id) {
          setSim(r);
          setBusy(false);
        }
      }
    }, delayMs);
    return () => {
      clearTimeout(t);
      if (w && onMsg) w.removeEventListener('message', onMsg);
    };
  }, [key, influent, delayMs]);

  return { sim, busy };
}
