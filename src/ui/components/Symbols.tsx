/** Simplified 2D process-flow-diagram symbols (line art in the spirit of ISO 10628 / ISA-5.1). */
import { UnitType } from '../../simulation/treatment/catalogue';

const INK = 'var(--ink)';

/** Equipment symbols for the PFD (line art in the spirit of ISO 10628-2). viewBox 120×80; nozzles at x=0 / x=120, y=44. */
export function UnitSymbol({ type, accent }: { type: UnitType; accent: string }) {
  const L = { fill: 'none', stroke: INK, strokeWidth: 1.7, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const thin = { ...L, strokeWidth: 1.1 };
  const liquid = (d: string) => <path d={d} fill={accent} opacity={0.13} stroke="none" />;
  const level = (x1: number, x2: number, y: number) => <path d={`M${x1} ${y} h${x2 - x1}`} stroke={accent} strokeWidth={1.1} strokeDasharray="5 3" />;
  // top-entry agitator: motor box, shaft, impeller
  const agitator = (x: number, top: number, bottom: number, kind: 'hydrofoil' | 'paddle' = 'hydrofoil') => (
    <g>
      <rect x={x - 6} y={top - 9} width={12} height={8} {...L} />
      <path d={`M${x} ${top - 1} V${bottom}`} {...L} />
      {kind === 'hydrofoil' ? <path d={`M${x - 9} ${bottom + 3} L${x} ${bottom} L${x + 9} ${bottom - 3}`} {...L} /> : <path d={`M${x - 10} ${bottom} h20 M${x - 10} ${bottom - 6} v12 M${x + 10} ${bottom - 6} v12`} {...L} />}
    </g>
  );
  const nozzles = <path d="M0 44 h8 M112 44 h8" {...L} />;
  switch (type) {
    case 'eq':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M14 28 H106 V70 H14 Z')}
          <path d="M14 14 V70 H106 V14" {...L} />
          {level(14, 106, 28)}
          {agitator(60, 12, 56)}
          <path d="M8 44 h6 M106 60 h6 V44 h8 M0 44 h8" {...L} />
          <text x="98" y="24" fontSize="8" fontFamily="var(--mono)" fill={INK}>LT</text>
        </svg>
      );
    case 'oilSep':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M10 30 H110 V66 H10 Z')}
          <rect x="11" y="30" width="98" height="6" fill="#6b4f2a" opacity="0.35" />
          <path d="M10 22 V66 H110 V22" {...L} />
          {level(10, 110, 30)}
          <path d="M38 22 V54 M78 36 V66" {...L} />
          <circle cx="94" cy="31" r="4" {...L} />
          <path d="M94 27 V14 h16" {...thin} />
          <path d="M0 44 h10 M110 44 h10" {...L} />
        </svg>
      );
    case 'daf':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M10 30 H110 V64 H10 Z')}
          <rect x="11" y="30" width="98" height="5" fill="#6b4f2a" opacity="0.4" />
          <path d="M10 20 V64 H110 V20" {...L} />
          {level(10, 110, 30)}
          {[22, 34, 46, 58, 70, 82].map((x) => (
            <g key={x}>
              <circle cx={x} cy={56} r={1.6} {...thin} />
              <circle cx={x + 4} cy={47} r={1.3} {...thin} />
              <circle cx={x + 1} cy={39} r={1.1} {...thin} />
            </g>
          ))}
          <path d="M16 26 h70" {...thin} />
          <path d="M20 22 l6 4 l-6 4 M44 22 l6 4 l-6 4 M68 22 l6 4 l-6 4" {...thin} />
          <rect x="88" y="66" width="18" height="10" rx="2" {...thin} />
          <path d="M97 66 V60" {...thin} />
          <text x="88" y="16" fontSize="7" fontFamily="var(--mono)" fill={INK}>AIR</text>
          <path d="M0 44 h10 M110 44 h10" {...L} />
        </svg>
      );
    case 'neutralisation':
    case 'precipitation':
    case 'sulfide':
    case 'aop':
    case 'crReduction':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M38 26 H82 V64 Q82 72 74 72 H46 Q38 72 38 64 Z')}
          <path d="M38 16 V64 Q38 72 46 72 H74 Q82 72 82 64 V16 Z" {...L} />
          {level(38, 82, 26)}
          {agitator(60, 14, 58)}
          <path d="M42 30 V62 M78 30 V62" {...thin} />
          <path d="M0 44 h38 M82 44 h38" {...L} />
          <circle cx="96" cy="22" r="7" {...thin} />
          <text x="96" y="25" textAnchor="middle" fontSize="7" fontFamily="var(--mono)" fill={INK}>{type === 'crReduction' ? 'ORP' : 'pH'}</text>
          <path d="M89 22 H82" {...thin} strokeDasharray="2 2" />
        </svg>
      );
    case 'coagulation':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M10 28 H48 V70 H10 Z')}
          {liquid('M52 28 H110 V70 H52 Z')}
          <path d="M10 16 V70 H48 V16 M52 16 V70 H110 V16" {...L} />
          {level(10, 48, 28)}
          {level(52, 110, 28)}
          {agitator(29, 14, 56)}
          {agitator(81, 14, 52, 'paddle')}
          <circle cx="70" cy="64" r="2" fill={accent} />
          <circle cx="92" cy="62" r="3" fill={accent} />
          <path d="M0 44 h10 M110 44 h10" {...L} />
        </svg>
      );
    case 'clarifier':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M12 24 H108 V48 L66 70 H54 L12 48 Z')}
          <path d="M12 16 V48 L54 70 H66 L108 48 V16" {...L} />
          <path d="M12 22 h8 v4 M108 22 h-8 v4" {...thin} />
          <path d="M50 20 h20 v14 h-20 z" {...thin} />
          <path d="M60 8 V64" {...L} />
          <path d="M22 50 L60 62 L98 50" {...thin} />
          <path d="M54 70 v6 h12 v-6" fill="var(--sludge)" opacity="0.45" stroke={INK} strokeWidth={1.1} />
          <path d="M0 44 h12 M108 30 h12" {...L} />
        </svg>
      );
    case 'activatedSludge':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M8 26 H112 V70 H8 Z')}
          <path d="M8 16 V70 H112 V16" {...L} />
          {level(8, 112, 26)}
          <path d="M16 64 H104" {...L} />
          {[22, 38, 54, 70, 86, 100].map((x) => (
            <g key={x}>
              <path d={`M${x - 4} 64 h8`} stroke={INK} strokeWidth={3} />
              <circle cx={x} cy="56" r="1.8" {...thin} stroke={accent} />
              <circle cx={x + 2} cy="46" r="1.5" {...thin} stroke={accent} />
              <circle cx={x - 1} cy="36" r="1.2" {...thin} stroke={accent} />
            </g>
          ))}
          <path d="M60 6 V16 M54 6 h12" {...L} />
          <path d="M0 44 h8 M112 44 h8" {...L} />
        </svg>
      );
    case 'sandFilter':
      return (
        <svg viewBox="0 0 120 80">
          <path d="M26 12 V70 H94 V12" {...L} />
          {liquid('M27 20 H93 V36 H27 Z')}
          {level(26, 94, 20)}
          <rect x="27" y="36" width="66" height="18" fill="#d9c79a" opacity="0.6" />
          <rect x="27" y="54" width="66" height="8" fill="#9aa1a8" opacity="0.5" />
          {Array.from({ length: 22 }).map((_, i) => (
            <circle key={i} cx={31 + (i % 11) * 6} cy={i < 11 ? 41 : 49} r="1" fill={INK} />
          ))}
          <path d="M30 66 H90" {...thin} strokeDasharray="3 2" />
          <path d="M0 26 h26 M94 66 h12 V44 h14" {...L} />
        </svg>
      );
    case 'carbon':
      return (
        <svg viewBox="0 0 120 80">
          <path d="M44 16 Q44 6 60 6 Q76 6 76 16 V64 Q76 74 60 74 Q44 74 44 64 Z" {...L} />
          <rect x="45" y="22" width="30" height="38" fill="#2b2b2b" opacity="0.7" />
          <path d="M45 22 h30 M45 60 h30" {...thin} />
          <path d="M0 44 h20 V10 h40 v-4 M60 74 v4 h40 V44 h20" {...L} />
        </svg>
      );
    case 'thickener':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M24 22 H96 V46 L66 70 H54 L24 46 Z')}
          <path d="M24 14 V46 L54 70 H66 L96 46 V14" {...L} />
          {level(24, 96, 22)}
          <path d="M60 6 V62" {...L} />
          {[40, 50, 70, 80].map((x) => (
            <path key={x} d={`M${x} 34 V50`} {...thin} />
          ))}
          <path d="M34 50 L60 60 L86 50" {...thin} />
          <rect x="54" y="2" width="12" height="6" {...L} />
          <path d="M54 70 v6 h12 v-6" fill="var(--sludge)" opacity="0.6" stroke={INK} strokeWidth={1.1} />
          <path d="M0 30 h24 M96 26 h24" {...L} />
        </svg>
      );
    case 'filterPress':
      return (
        <svg viewBox="0 0 120 80">
          <rect x="10" y="20" width="10" height="38" {...L} />
          <rect x="100" y="20" width="10" height="38" {...L} />
          <path d="M20 24 H100 M20 54 H100" {...thin} />
          {Array.from({ length: 13 }).map((_, i) => (
            <rect key={i} x={24 + i * 5.8} y="26" width="4" height="26" fill="#8b5a2b" opacity={0.25 + (i % 2) * 0.2} stroke={INK} strokeWidth={0.6} />
          ))}
          <path d="M14 58 V68 M106 58 V68 M8 68 H112" {...L} />
          <path d="M44 62 l6 8 h20 l6 -8" fill="var(--sludge)" opacity="0.55" stroke={INK} strokeWidth={1} />
          <path d="M0 40 h10 M110 40 h10" {...L} />
        </svg>
      );
    case 'dryer':
      return (
        <svg viewBox="0 0 120 80">
          <rect x="14" y="30" width="92" height="30" rx="15" {...L} />
          {liquid('M18 48 Q60 40 102 48 V54 Q60 60 18 54 Z')}
          <path d="M22 45 h76" {...thin} />
          {[30, 46, 62, 78, 94].map((x) => (
            <path key={x} d={`M${x} 38 v14`} {...thin} />
          ))}
          <path d="M40 30 C38 22 44 20 42 12 M60 30 C58 22 64 20 62 12 M80 30 C78 22 84 20 82 12" {...thin} />
          <path d="M26 66 l6 -6 l6 6 Z" fill={accent} opacity={0.6} />
          <path d="M0 44 h14 M106 44 h14" {...L} />
        </svg>
      );
    case 'uf':
    case 'ro':
      // pressure vessels (RO: two in series) with the membrane drawn as a dashed line
      return (
        <svg viewBox="0 0 120 80">
          {[type === 'ro' ? 30 : 36, type === 'ro' ? 52 : 52].slice(0, type === 'ro' ? 2 : 1).map((y) => (
            <g key={y}>
              <rect x="16" y={y - 8} width="88" height="16" rx="8" {...L} />
              <path d={`M22 ${y} h76`} stroke={accent} strokeWidth={1.2} strokeDasharray="4 3" />
            </g>
          ))}
          {type === 'ro' && <path d="M8 44 l6 -5 v10 z" fill={INK} />}
          <path d="M0 44 h16 M104 44 h16" {...L} />
          <text x="48" y="74" fontSize="8" fontFamily="var(--mono)" fill={INK}>{type === 'ro' ? 'RO' : 'UF'}</text>
        </svg>
      );
    case 'mbr':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M12 26 H108 V68 H12 Z')}
          <path d="M12 16 V68 H108 V16" {...L} />
          {level(12, 108, 26)}
          <rect x="56" y="32" width="36" height="26" {...thin} />
          {[62, 68, 74, 80, 86].map((x) => <path key={x} d={`M${x} 34 v22`} stroke={accent} strokeWidth={1} />)}
          {[20, 30, 40].map((x) => <circle key={x} cx={x} cy={62} r={1.6} {...thin} />)}
          <path d="M0 44 h12 M92 40 h28" {...L} />
        </svg>
      );
    case 'ionExchange':
      return (
        <svg viewBox="0 0 120 80">
          {[32, 76].map((x) => (
            <g key={x}>
              <rect x={x - 12} y="12" width="24" height="58" rx="10" {...L} />
              <rect x={x - 10} y="30" width="20" height="32" fill={accent} opacity={0.25} stroke="none" />
            </g>
          ))}
          <path d="M0 44 h20 M44 20 h20 M88 44 h32" {...L} />
          <text x="50" y="76" fontSize="8" fontFamily="var(--mono)" fill={INK}>IX</text>
        </svg>
      );
    case 'evaporator':
      return (
        <svg viewBox="0 0 120 80">
          <rect x="22" y="10" width="34" height="58" rx="12" {...L} />
          {liquid('M24 50 H54 V64 Q39 70 24 64 Z')}
          {[30, 38, 46].map((x) => <path key={x} d={`M${x} 22 v24`} {...thin} />)}
          <circle cx="84" cy="26" r="11" {...L} />
          <path d="M77 20 l14 12 M77 32 l14 -12" {...thin} />
          <path d="M56 18 H73 M95 26 h8 V44 H120 M0 44 h22" {...L} />
          <text x="78" y="56" fontSize="8" fontFamily="var(--mono)" fill={INK}>MVR</text>
        </svg>
      );
    case 'electrowinning':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M14 30 H106 V66 H14 Z')}
          <path d="M14 22 V66 H106 V22" {...L} />
          {[30, 46, 62, 78, 94].map((x, i) => <path key={x} d={`M${x} 18 v40`} stroke={i % 2 ? '#b87333' : INK} strokeWidth={2.2} />)}
          <text x="24" y="14" fontSize="9" fontFamily="var(--mono)" fill={INK}>+ −</text>
          <path d="M0 44 h14 M106 44 h14" {...L} />
        </svg>
      );
    case 'uasb':
      return (
        <svg viewBox="0 0 120 80">
          {liquid('M36 22 H84 V72 H36 Z')}
          <rect x="36" y="58" width="48" height="14" fill="#6b4f2a" opacity="0.35" />
          <path d="M36 10 V72 H84 V10" {...L} />
          <path d="M42 34 L60 24 L78 34" {...L} />
          <path d="M60 24 V4 h20" {...thin} />
          <text x="84" y="8" fontSize="7" fontFamily="var(--mono)" fill={INK}>CH₄</text>
          <path d="M0 66 h36 M84 30 h20 V44 h16" {...L} />
        </svg>
      );
    case 'splitter':
      return (
        <svg viewBox="0 0 120 80">
          <rect x="34" y="22" width="52" height="44" {...L} />
          {liquid('M35 34 H85 V65 H35 Z')}
          <path d="M60 22 V50" {...L} />
          <path d="M40 34 h16 M64 34 h16" stroke={accent} strokeWidth={1.4} />
          <path d="M0 44 h34 M86 30 h34 M86 58 h34" {...L} />
          <text x="112" y="25" fontSize="9" fontFamily="var(--mono)" fill={INK}>a</text>
          <text x="112" y="70" fontSize="9" fontFamily="var(--mono)" fill={INK}>b</text>
        </svg>
      );
    case 'mixer':
      return (
        <svg viewBox="0 0 120 80">
          <rect x="40" y="24" width="40" height="40" {...L} />
          {liquid('M41 34 H79 V63 H41 Z')}
          <path d="M48 44 q12 -10 24 0 q-12 10 -24 0" {...thin} stroke={accent} />
          <path d="M0 44 h40 M20 70 h20 V58 M80 44 h40" {...L} />
        </svg>
      );
  }
  return nozzles;
}

/** Sludge disposal point: skip / roll-off container (sludge or cake leaves site). */
export function DisposalSymbol() {
  const L = { fill: 'none', stroke: INK, strokeWidth: 1.7, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 120 80" width="120" height="80">
      <path d="M14 30 L24 64 H96 L106 30 Z" {...L} />
      <path d="M22 40 H98" stroke="var(--sludge)" strokeWidth="1.2" strokeDasharray="5 3" />
      <path d="M23 42 L27 62 H93 L97 42 Z" fill="var(--sludge)" opacity="0.45" />
      <circle cx="34" cy="70" r="5" {...L} />
      <circle cx="86" cy="70" r="5" {...L} />
      <path d="M0 30 h14" {...L} />
    </svg>
  );
}

/** Liquid scheduled-waste tanker (haulage of concentrated liquor). */
export function TankerSymbol() {
  const L = { fill: 'none', stroke: INK, strokeWidth: 1.7, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 120 80" width="120" height="80">
      <rect x="10" y="30" width="72" height="30" rx="14" {...L} />
      <path d="M18 50 Q46 44 74 50 V52 Q46 58 18 52 Z" fill="var(--chem)" opacity="0.45" />
      <path d="M82 38 H100 L108 48 V60 H82 Z" {...L} />
      <path d="M88 40 H99 L104 47 H88 Z" {...L} />
      <circle cx="28" cy="66" r="5" {...L} />
      <circle cx="64" cy="66" r="5" {...L} />
      <circle cx="98" cy="66" r="5" {...L} />
      <path d="M0 40 h10" {...L} />
      <text x="46" y="44" textAnchor="middle" fontSize="8" fontFamily="var(--mono)" fill={INK}>SW</text>
    </svg>
  );
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
    projects: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 13h8M8 16h5" {...p} />,
    plant: <path d="M3 21V11l5 3V11l5 3V7l4 2v12zM2 21h20M17 9V4h3v17" {...p} />,
    dev: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" {...p} />,
    collapse: <path d="M15 5l-7 7 7 7M20 5v14" {...p} />,
    expand: <path d="M9 5l7 7-7 7M4 5v14" {...p} />,
    focus: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...p} />,
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
