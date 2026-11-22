/**
 * Side-view cross-section tanks for the SCADA live view: the water inside takes the live quality colour, EQ fills to its
 * live level, mixers turn while dosing, aeration basins bubble with the blower. 2D SVG, restrained motion (CSS classes in
 * theme.css honour prefers-reduced-motion).
 */
import type { UnitType } from '../../simulation/treatment/catalogue';

/** tank drawing box (px); readout panel goes underneath */
export const TANK_W = 130;
export const TANK_H = 92;
/** inlet / outlet nozzle heights (y in the tank box) */
export const TANK_NOZZLE = { in: 34, out: 34 };

/** display index 0 (meets limits) … 1 (raw) → water colour: clean blue → teal → olive → brown */
const STOPS: [number, [number, number, number]][] = [
  [0, [47, 143, 232]],
  [0.3, [61, 147, 184]],
  [0.55, [79, 138, 124]],
  [0.75, [111, 122, 69]],
  [0.9, [125, 107, 58]],
  [1, [122, 90, 54]],
];
export function waterColor(wq: number): string {
  const x = Math.max(0, Math.min(1, wq));
  for (let i = 1; i < STOPS.length; i++) {
    const [x1, c1] = STOPS[i];
    const [x0, c0] = STOPS[i - 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(122,90,54)';
}

export type TankShape = 'stirred' | 'aerated' | 'clarifier' | 'bed' | 'vessel' | 'evaporator' | 'press' | 'junction' | 'eq' | 'separator';

export function tankShape(kind: UnitType): TankShape {
  switch (kind) {
    case 'eq':
      return 'eq';
    case 'neutralisation':
    case 'precipitation':
    case 'coagulation':
    case 'crReduction':
    case 'sulfide':
    case 'aop':
    case 'electrowinning':
      return 'stirred';
    case 'activatedSludge':
    case 'mbr':
    case 'uasb':
      return 'aerated';
    case 'clarifier':
    case 'thickener':
      return 'clarifier';
    case 'sandFilter':
    case 'carbon':
      return 'bed';
    case 'uf':
    case 'ro':
    case 'ionExchange':
      return 'vessel';
    case 'evaporator':
      return 'evaporator';
    case 'filterPress':
    case 'dryer':
      return 'press';
    case 'mixer':
    case 'splitter':
      return 'junction';
    case 'oilSep':
    case 'daf':
      return 'separator';
    default:
      return 'stirred';
  }
}

const WALL = '#9fb4c8';
const SLUDGE = '#6b4a2a';

/**
 * @param water   water colour (waterColor)
 * @param level   fill 0–1 (EQ live level; others ~0.85)
 * @param active  0–1 activity (mixer speed / bubble density); 0 = still
 * @param empty   no flow through the unit this hour
 */
export function Tank({ kind, water, level = 0.85, active = 0, empty = false }: { kind: UnitType; water: string; level?: number; active?: number; empty?: boolean }) {
  const shape = tankShape(kind);
  const lv = Math.max(0.04, Math.min(1, level));
  const fill = empty ? '#3a4b5c' : water;
  // open tank body: x 14–116, y 14–86
  const top = 18;
  const bottom = 86;
  const surf = bottom - (bottom - top) * lv;
  const body = (
    <>
      <rect x={16} y={surf} width={98} height={bottom - surf} fill={fill} opacity={0.92} />
      <path d={`M14 ${top - 6} V${bottom + 2} H116 V${top - 6}`} fill="none" stroke={WALL} strokeWidth={2} />
    </>
  );
  const mixer = active > 0.02 && !empty && (
    <g className="tank-mixer" style={{ transformOrigin: '65px 58px', animationDuration: `${Math.max(1.2, 4 - 3 * active)}s` }}>
      <line x1={65} y1={6} x2={65} y2={58} stroke={WALL} strokeWidth={1.6} />
      <path d="M53 58 H77 M65 52 V64" stroke={WALL} strokeWidth={2.4} strokeLinecap="round" />
    </g>
  );
  switch (shape) {
    case 'eq':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          {body}
          {lv > 0.95 && <rect x={14} y={top - 8} width={102} height={4} fill="var(--alarm)" className="tank-blink" />}
          <line x1={110} y1={top} x2={110} y2={bottom} stroke={WALL} strokeWidth={0.8} strokeDasharray="2 3" />
        </svg>
      );
    case 'stirred':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          {body}
          <rect x={56} y={0} width={18} height={6} rx={1} fill={WALL} />
          {mixer}
        </svg>
      );
    case 'aerated':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          {body}
          <line x1={22} y1={82} x2={108} y2={82} stroke={WALL} strokeWidth={1.4} strokeDasharray="3 3" />
          {!empty &&
            active > 0.02 &&
            Array.from({ length: Math.round(3 + 7 * active) }, (_, i) => (
              <circle key={i} className="tank-bubble" cx={24 + ((i * 37) % 84)} cy={80} r={1.8} fill="#e6f3ff" style={{ animationDelay: `${(i * 0.37) % 2}s` }} />
            ))}
        </svg>
      );
    case 'clarifier':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          <path d={`M16 ${surf} H114 V60 L65 88 L16 60 Z`} fill={fill} opacity={0.92} />
          <path d="M26 66 L65 86 L104 66 Z" fill={SLUDGE} opacity={empty ? 0.4 : 0.9} />
          <path d={`M14 ${top - 6} V60 L65 90 L116 60 V${top - 6}`} fill="none" stroke={WALL} strokeWidth={2} />
          <line x1={65} y1={4} x2={65} y2={40} stroke={WALL} strokeWidth={1.4} />
        </svg>
      );
    case 'bed':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          <rect x={16} y={surf} width={98} height={56 - surf > 0 ? 56 - surf : 0} fill={fill} opacity={0.92} />
          <rect x={16} y={56} width={98} height={30} fill={kind === 'carbon' ? '#2b2f33' : '#c9b98f'} />
          {Array.from({ length: 22 }, (_, i) => (
            <circle key={i} cx={20 + ((i * 23) % 92)} cy={60 + ((i * 7) % 22)} r={1.3} fill={kind === 'carbon' ? '#555' : '#a8976d'} />
          ))}
          <path d={`M14 ${top - 6} V${bottom + 2} H116 V${top - 6}`} fill="none" stroke={WALL} strokeWidth={2} />
        </svg>
      );
    case 'vessel':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          {[24, 50, 76].map((y) => (
            <g key={y}>
              <rect x={14} y={y - 9} width={102} height={18} rx={9} fill={fill} opacity={0.85} stroke={WALL} strokeWidth={1.6} />
              <line x1={24} y1={y} x2={106} y2={y} stroke="#e6f3ff" strokeWidth={0.8} strokeDasharray={kind === 'ionExchange' ? '1 2' : '6 2'} />
            </g>
          ))}
        </svg>
      );
    case 'evaporator':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          <path d="M40 20 Q40 6 65 6 Q90 6 90 20 V80 Q90 88 65 88 Q40 88 40 80 Z" fill="none" stroke={WALL} strokeWidth={2} />
          <path d={`M42 ${50} H88 V80 Q88 86 65 86 Q42 86 42 80 Z`} fill={fill} opacity={0.92} />
          {!empty && <path className="tank-vapour" d="M58 40 q4 -6 0 -12 q-4 -6 0 -12 M72 40 q4 -6 0 -12 q-4 -6 0 -12" fill="none" stroke="#cfe3f7" strokeWidth={1.4} />}
        </svg>
      );
    case 'press':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          <rect x={14} y={20} width={102} height={46} fill="none" stroke={WALL} strokeWidth={2} />
          {Array.from({ length: 9 }, (_, i) => (
            <rect key={i} x={20 + i * 10.5} y={24} width={7} height={38} fill={SLUDGE} opacity={empty ? 0.35 : 0.85} />
          ))}
          <path d="M30 70 L40 86 H90 L100 70" fill="none" stroke={WALL} strokeWidth={1.6} />
        </svg>
      );
    case 'junction':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          <rect x={45} y={20} width={40} height={30} rx={3} fill={fill} opacity={0.85} stroke={WALL} strokeWidth={1.6} />
        </svg>
      );
    case 'separator':
      return (
        <svg width={TANK_W} height={TANK_H} viewBox={`0 0 ${TANK_W} ${TANK_H}`}>
          {body}
          <rect x={16} y={surf} width={98} height={5} fill="#d9b64a" opacity={empty ? 0.3 : 0.9} />
          {kind === 'daf' &&
            !empty &&
            Array.from({ length: 8 }, (_, i) => <circle key={i} className="tank-bubble" cx={24 + ((i * 41) % 84)} cy={80} r={1.4} fill="#ffffff" style={{ animationDelay: `${(i * 0.29) % 2}s` }} />)}
        </svg>
      );
  }
}
