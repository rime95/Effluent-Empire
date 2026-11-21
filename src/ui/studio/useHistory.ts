import { useCallback, useRef, useState } from 'react';

/**
 * Undo/redo over immutable snapshots. Consecutive edits with the same coalesce key within `windowMs`
 * (e.g. typing into one field, nudging one node) merge into a single undo step.
 */
export function useHistory<T>(initial: T, limit = 100, windowMs = 1200) {
  const [state, setState] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const last = useRef<{ key: string; t: number } | null>(null);
  const cur = useRef(initial);
  const [, force] = useState(0);

  const set = useCallback(
    (next: T | ((prev: T) => T), coalesce?: string) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(cur.current) : next;
      if (value === cur.current) return;
      const now = Date.now();
      const merge = !!coalesce && last.current?.key === coalesce && now - last.current.t < windowMs;
      if (!merge) {
        past.current = [...past.current, cur.current].slice(-limit);
      }
      future.current = [];
      last.current = coalesce ? { key: coalesce, t: now } : null;
      cur.current = value;
      setState(value);
    },
    [limit, windowMs],
  );

  const undo = useCallback(() => {
    const prev = past.current[past.current.length - 1];
    if (prev === undefined) return;
    past.current = past.current.slice(0, -1);
    future.current = [cur.current, ...future.current];
    last.current = null;
    cur.current = prev;
    setState(prev);
  }, []);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (next === undefined) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, cur.current];
    last.current = null;
    cur.current = next;
    setState(next);
  }, []);

  /** Replace the state without recording history (e.g. a different project was opened). */
  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    last.current = null;
    cur.current = value;
    setState(value);
    force((x) => x + 1);
  }, []);

  return { state, set, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
