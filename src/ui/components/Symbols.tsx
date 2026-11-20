/** Simplified 2D process-flow-diagram symbols (line art in the spirit of ISO 10628 / ISA-5.1). */
import { UnitType } from '../../simulation/treatment/catalogue';

const INK = 'var(--ink)';

export function UnitSymbol({ type, accent }: { type: UnitType; accent: string }) {
  const common = { fill: 'none', stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' as const };
  switch (type) {
    case 'eq':
      return (
        <svg viewBox="0 0 92 52">
          <rect x="10" y="10" width="72" height="34" {...common} />
          <path d="M10 22 h72" stroke={accent} strokeWidth="1.4" strokeDasharray="4 3" />
          <path d="M46 4 v26 M38 30 h16" {...common} />
          <rect x="10" y="22" width="72" height="22" fill={accent} opacity="0.12" />
        </svg>
      );
    case 'oilSep':
      return (
        <svg viewBox="0 0 92 52">
          <rect x="6" y="12" width="80" height="30" {...common} />
          <path d="M30 12 v22 M62 18 v24" {...common} />
          <rect x="7" y="13" width="78" height="5" fill={accent} opacity="0.35" />
          <path d="M70 8 l8 -4" {...common} />
        </svg>
      );
    case 'neutralisation':
    case 'precipitation':
      return (
        <svg viewBox="0 0 92 52">
          <path d="M28 10 v30 q0 6 6 6 h24 q6 0 6 -6 v-30" {...common} />
          <path d="M46 2 v30 M38 32 h16 M38 28 h16" {...common} />
          <path d="M70 6 h12 v12" {...common} />
          <path d="M78 14 l4 4 l4 -4" {...common} />
          <circle cx="76" cy="30" r="7" {...common} />
          <text x="76" y="33" textAnchor="middle" fontSize="8" fontFamily="var(--mono)" fill={INK}>{type === 'neutralisation' ? 'pH' : 'M'}</text>
          <rect x="29" y="24" width="34" height="21" fill={accent} opacity="0.12" />
        </svg>
      );
    case 'coagulation':
      return (
        <svg viewBox="0 0 92 52">
          <rect x="6" y="12" width="34" height="32" {...common} />
          <rect x="44" y="12" width="42" height="32" {...common} />
          <path d="M23 4 v24 M17 28 h12" {...common} />
          <path d="M58 6 v22 M72 6 v22 M53 22 h10 M67 22 h10" {...common} />
          <circle cx="54" cy="36" r="2" fill={accent} />
          <circle cx="66" cy="38" r="3" fill={accent} />
          <circle cx="78" cy="35" r="2.5" fill={accent} />
        </svg>
      );
    case 'clarifier':
      return (
        <svg viewBox="0 0 92 52">
          <path d="M8 12 h76 v18 l-32 16 h-12 l-32 -16 z" {...common} />
          <path d="M46 4 v36" {...common} />
          <path d="M14 18 h64" stroke={accent} strokeWidth="1.2" strokeDasharray="3 3" />
          <path d="M28 40 l18 6 l18 -6" fill="var(--sludge)" opacity="0.35" />
        </svg>
      );
    case 'activatedSludge':
      return (
        <svg viewBox="0 0 92 52">
          <rect x="6" y="10" width="80" height="34" {...common} />
          <rect x="7" y="16" width="78" height="27" fill={accent} opacity="0.12" />
          <path d="M14 40 h64" {...common} />
          {[18, 30, 42, 54, 66].map((x) => (
            <g key={x}>
              <circle cx={x + 2} cy="34" r="2" fill="none" stroke={accent} strokeWidth="1.2" />
              <circle cx={x + 5} cy="26" r="1.6" fill="none" stroke={accent} strokeWidth="1.2" />
              <circle cx={x + 1} cy="20" r="1.3" fill="none" stroke={accent} strokeWidth="1.2" />
            </g>
          ))}
        </svg>
      );
    case 'crReduction':
      return (
        <svg viewBox="0 0 92 52">
          <path d="M28 10 v30 q0 6 6 6 h24 q6 0 6 -6 v-30" {...common} />
          <path d="M46 2 v30 M38 32 h16" {...common} />
          <rect x="29" y="22" width="34" height="23" fill="#3fa34d" opacity="0.25" />
          <circle cx="77" cy="18" r="8" {...common} />
          <text x="77" y="21" textAnchor="middle" fontSize="7" fontFamily="var(--mono)" fill={INK}>ORP</text>
          <text x="14" y="30" textAnchor="middle" fontSize="8" fontFamily="var(--mono)" fill={INK}>Cr⁶</text>
        </svg>
      );
    case 'carbon':
      return (
        <svg viewBox="0 0 92 52">
          <rect x="30" y="4" width="32" height="44" rx="10" {...common} />
          <rect x="31" y="14" width="30" height="26" fill="#222" opacity="0.75" />
          <path d="M18 10 h12 M62 42 h12" {...common} />
        </svg>
      );
    case 'sandFilter':
      return (
        <svg viewBox="0 0 92 52">
          <rect x="22" y="6" width="48" height="40" rx="3" {...common} />
          <rect x="23" y="22" width="46" height="18" fill="#d9c79a" opacity="0.55" />
          {Array.from({ length: 18 }).map((_, i) => (
            <circle key={i} cx={27 + (i % 9) * 5} cy={i < 9 ? 27 : 34} r="1" fill={INK} />
          ))}
          <path d="M23 14 h46" stroke={accent} strokeWidth="1.2" strokeDasharray="3 3" />
        </svg>
      );
  }
}

export function NavIcon({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, JSX.Element> = {
    hq: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" {...p} />,
    enquiries: <path d="M4 4h16v12H8l-4 4zM8 9h8M8 12h5" {...p} />,
    lab: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9" {...p} />,
    studio: <path d="M3 6h5v5H3zM16 13h5v5h-5zM8 8.5h4v7h4M3 17h5" {...p} />,
    commission: <path d="M4 12l5 5L20 6" {...p} />,
    book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16" {...p} />,
    scada: <path d="M3 4h18v12H3zM8 20h8M7 12l3-3 3 2 4-4" {...p} />,
    tree: <path d="M12 3v18M12 8l-5 3M12 12l5 3M7 11v4M17 15v4" {...p} />,
    map: <path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" {...p} />,
    finance: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} />,
    staff: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6" {...p} />,
  };
  return <svg viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24">
      <path d="M12 2c4 5 6 8.5 6 11.5A6 6 0 0 1 6 13.5C6 10.5 8 7 12 2z" fill="none" stroke="var(--flow)" strokeWidth="1.8" />
      <path d="M8.5 14.5a3.5 3.5 0 0 0 3.5 3" fill="none" stroke="var(--flow)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
