import { useState } from 'react';
import type { Employee } from '../../game/staff';
import { portraitFor } from '../art';
import { BrandMark } from './Symbols';

/** Employee portrait (art.ts) — the founder shows the company badge; initials if the picture is unavailable. */
export function Avatar({ e, large = false }: { e: Pick<Employee, 'id' | 'name' | 'role' | 'founder'>; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = portraitFor(e);
  const cls = `avatar ${large ? 'lg' : ''}`;
  if (e.founder) return <span className={cls} title="You — the founder"><BrandMark /></span>;
  if (!src || failed) {
    const initials = e.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
    return <span className={cls}>{initials}</span>;
  }
  return <img className={cls} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
