import { useEffect, useRef, useState } from 'react';
import { simulate, type ProcessGraph, type SimResult } from '../../simulation/treatment/graph';
import type { Stream } from '../../simulation/core/stream';

/** Graph identity ignoring canvas positions — the simulation only reruns when the process changes. */
export function processKey(g: ProcessGraph): string {
  return JSON.stringify({ n: g.nodes.map((n) => [n.id, n.kind, n.params, !!n.bypass, n.inst ?? null]), e: g.edges.map((e) => [e.from, e.to, e.fromPort ?? 'out']) });
}

let worker: Worker | null | undefined;
/** id of the request the worker is busy with (0 = idle) */
let inFlight = 0;
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}
/**
 * A worker runs one simulation at a time, so a slow solve (large recycle loops) would make every later edit queue
 * behind stale work. When a newer request arrives while an older one is still running, the old worker is killed.
 */
function freshWorker(): Worker | null {
  if (worker && inFlight) {
    worker.terminate();
    worker = undefined;
    inFlight = 0;
  }
  return getWorker();
}

let seq = 0;
/** a solve that has not answered by then is treated as hung: the worker is killed and the failure reported */
const TIMEOUT_MS = 20_000;

/**
 * Debounced, latest-request-wins simulation in a Web Worker (synchronous fallback without Worker support).
 * Keeps showing the previous result while a new one is computed; a failed solve is reported, never silently dropped.
 */
export function useSimulation(graph: ProcessGraph | null, influent: Stream | null, delayMs = 120): { sim: SimResult | null; busy: boolean; error: string | null } {
  const [sim, setSim] = useState<SimResult | null>(() => {
    try {
      return graph && influent ? simulate(graph, influent) : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    let w: Worker | null = null;
    let onMsg: ((e: MessageEvent) => void) | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const t = setTimeout(() => {
      w = freshWorker();
      if (w) {
        const ww = w;
        onMsg = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          if (inFlight === id) inFlight = 0;
          if (watchdog) clearTimeout(watchdog);
          ww.removeEventListener('message', onMsg!);
          if (latest.current !== id) return;
          if (e.data.result) {
            setSim(e.data.result as SimResult);
            setError(null);
          } else setError(String(e.data.error ?? 'simulation failed'));
          setBusy(false);
        };
        ww.addEventListener('message', onMsg);
        inFlight = id;
        ww.postMessage({ id, graph: g, influent });
        watchdog = setTimeout(() => {
          if (inFlight !== id) return;
          ww.terminate();
          worker = undefined;
          inFlight = 0;
          if (latest.current === id) {
            setError('The calculation took too long and was stopped — check recycle loops and unit sizes.');
            setBusy(false);
          }
        }, TIMEOUT_MS);
      } else {
        try {
          const r = simulate(g, influent);
          if (latest.current === id) {
            setSim(r);
            setError(null);
          }
        } catch (err) {
          if (latest.current === id) setError(String(err));
        }
        if (latest.current === id) setBusy(false);
      }
    }, delayMs);
    return () => {
      clearTimeout(t);
      if (watchdog) clearTimeout(watchdog);
      if (w && onMsg) w.removeEventListener('message', onMsg);
    };
  }, [key, influent, delayMs]);

  return { sim, busy, error };
}
