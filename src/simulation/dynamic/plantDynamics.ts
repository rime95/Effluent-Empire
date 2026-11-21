/**
 * Dynamic plant simulation for SCADA (Phase 3). Ref: knowledge/operations/scada.md
 *
 * Time step 15 min (BSM1 evaluation interval); biology sub-stepped at 20 s (asm1.ts), pH loops at 1 min.
 *   EQ tank            — variable level, pumped outflow set-point, overflow BYPASSES to discharge (untreated)
 *   pH / precipitation — stirred tank (CSTR) with PI pH control on a dosing pump of limited capacity, pH probe offset
 *   activated sludge   — ASM1 reactor (asm1.ts), PI DO control on kLa (BSM1 tuning K = 25 d⁻¹·(mg/L)⁻¹, Ti = 0.002 d),
 *                        wasting from the SRT set-point, secondary-clarifier carry-over from zone settling (Vesilind)
 *   every other unit   — quasi-steady: the Phase 1 process model on each step's inlet
 */
import { Stream, blend, cloneStream, emptyStream, tss, METALS, MetalMap, poolMass } from '../core/stream';
import { unaidedPrecipitateV50 } from '../chemistry/neutralisation';
import { effectiveParams, hasInst } from '../treatment/instrumentation';
import { equilibrate, aerationCarbonate } from '../chemistry/acidBase';
import { AERATION, airForO2_mold, mixingAir_mold } from '../biological/aeration';
import { vesilind_mh } from '../physical/settling';
import { CATALOGUE, UnitType } from '../treatment/catalogue';
import { ProcessGraph, simulate, PNode } from '../treatment/graph';
import { evaluate, measure, StandardId } from '../treatment/compliance';
import { ASM1, ASM1_SUBSTEP, AS1State, step as asmStep, mlss as mlssOf, oxygenSaturation } from './asm1';
import { metalInhibition, pHInhibition, pHInhibitionNitrifier, KINETICS } from '../biological/activatedSludge';

export type Disturbance =
  | { kind: 'flowSurge'; factor: number; fromH: number; toH: number }
  | { kind: 'toxicSlug'; metal: 'Cu' | 'Ni' | 'Zn'; mgL: number; fromH: number; toH: number }
  | { kind: 'blowerTrip'; unitId: string; capacity: number }
  | { kind: 'pumpTrip'; unitId: string }
  | { kind: 'probeOffset'; unitId: string; offset: number }
  | { kind: 'bulking'; unitId: string; settleFactor: number };

export interface DynamicOptions {
  hours: number;
  disturbances: Disturbance[];
  /** EQ outflow set-point override, fraction of average flow (e.g. 0.6 = hold back) */
  eqOutflowFraction?: Record<string, number>;
  /** stream used for the warm start (defaults to base). Pass the plant's design stream so weekly influent variations reuse one cached warm state. */
  warmBase?: Stream;
}

export interface TrendPoint {
  t: number;
  Qin: number;
  effluent: Record<string, number>;
  pass: boolean;
  failed: string[];
  units: Record<string, Record<string, number>>;
}

export interface DynamicResult {
  points: TrendPoint[];
  compliantFraction: number;
  worst: { param: string; value: number; limit: number } | null;
  overflowM3: number;
  energy_kWh: number;
  reagent_kg: number;
}

const STEP_H = 0.25;
const DOSING: UnitType[] = ['neutralisation', 'precipitation'];

interface DosingState {
  contents: Stream;
  integral: number;
  /** pump capacity, eq/d (positive = base dosing, negative = acid dosing) */
  capacity: number;
}
interface EQState {
  level: number; // m³
  contents: Stream;
}
interface ASState {
  x: AS1State;
  integral: number;
  kLaMax: number;
  /** aeration air at the design oxygen demand (kLa = kLaMax / 1.6), mol/d */
  airDesign_mold?: number;
  clarifierArea: number;
  inert: Stream;
  /** dissolved metals in the mixed liquor (CSTR dilution of slugs), mg/L — drives inhibition */
  metals: MetalMap;
  /** effective sludge age from the steady design solution, d */
  srtEff?: number;
}

/** Diurnal production pattern: flow multiplier for hour t. Peak factor sets the amplitude. */
export function diurnal(tH: number, peakFactor: number): number {
  const a = Math.min(0.8, Math.max(0, peakFactor - 1));
  return 1 + a * Math.sin((2 * Math.PI * (tH - 8)) / 24);
}

function influentAt(base: Stream, tH: number, d: Disturbance[]): Stream {
  const s = cloneStream(base);
  s.Q = base.Q * diurnal(tH, base.peakFactor);
  s.peakFactor = 1; // instantaneous flow: no extra peak factor
  for (const x of d) {
    if (x.kind === 'flowSurge' && tH >= x.fromH && tH < x.toH) s.Q *= x.factor;
    if (x.kind === 'toxicSlug' && tH >= x.fromH && tH < x.toH) s.dissolved[x.metal] += x.mgL;
  }
  return s;
}

/** ASM1 states from a Phase 1 stream (COD fractions, VSS biomass → COD, mineral solids lumped). */
function toASM(s: Stream): AS1State {
  return {
    SS: s.SS,
    XS: s.XS,
    XBH: s.biomass * ASM1.codPerVss,
    XBA: 0,
    XP: 0,
    XI: s.XI,
    SNH: s.NH4N,
    SNO: s.NO3N,
    SO: 0,
    XM: s.grit + s.inert + s.colloid + s.floc,
    Cb: s.Cb,
  };
}

function clarifierCarry(mlss: number, Q: number, area: number, settleFactor: number): number {
  if (area <= 0 || mlss <= 0) return 1;
  const sor = Q / area / 24;
  const vs = vesilind_mh(mlss) * settleFactor;
  const f = sor / Math.max(vs, 1e-6);
  return Math.min(1, 0.004 + 0.2 * Math.pow(Math.max(0, f - 0.7), 2));
}

function nextIsClarifier(g: ProcessGraph, id: string): PNode | null {
  const outs = g.edges.filter((e) => e.from === id);
  if (outs.length !== 1) return null;
  const n = g.nodes.find((x) => x.id === outs[0].to);
  return n && n.kind === 'clarifier' ? n : null;
}

/** Run one ASM1 reactor over one 15-min step (20-s sub-steps) with the PI DO loop. kLa and OUR returned are step means. */
export function stepAS(st: ASState, inlet: Stream, p: { V: number; srt: number; doSP: number; blowerCap: number; settleFactor: number; manual?: boolean; mlssTarget?: number }, T: number) {
  const inA = toASM(inlet);
  const SOsat = oxygenSaturation(T);
  const dt = ASM1_SUBSTEP;
  const stepD = STEP_H / 24;
  let x = st.x;
  let integral = st.integral;
  // mixed-liquor dissolved metals: exact CSTR response over the step (a slug is diluted, then washes out)
  const D = inlet.Q / p.V;
  const metals = { ...st.metals };
  for (const m of METALS) metals[m] = inlet.dissolved[m] + (st.metals[m] - inlet.dissolved[m]) * Math.exp(-D * stepD);
  const ml = { ...inlet, dissolved: metals };
  const pH = st.inert.pH || 7.2; // reactor pH from the previous step's charge balance
  const inhibH = pHInhibition(pH) * metalInhibition(ml);
  const inhibA = pHInhibitionNitrifier(pH) * metalInhibition(ml, KINETICS.KI_N);
  const steps = Math.round(stepD / dt);
  let kLaSum = 0;
  let ourSum = 0;
  let heteroGrowth = 0; // ρ1 + ρ2 (aerobic + anoxic heterotroph growth), g COD/m³·d, step mean
  let nitGrowth = 0; // ρ3
  for (let i = 0; i < steps; i++) {
    const e = p.doSP - x.SO;
    // PI on kLa with conditional-integration anti-windup (BSM1: K = 25 d⁻¹ per g/m³, Ti = 0.002 d)
    const K = 25;
    const Ti = 0.002;
    const unclamped = K * (e + integral / Ti);
    // no DO loop: blower runs at the fixed design output (kLaMax was sized at 1.6 × design demand)
    const kLaNow = p.manual ? (st.kLaMax / 1.6) * p.blowerCap : Math.min(st.kLaMax * p.blowerCap, Math.max(0, unclamped));
    if (!p.manual && unclamped === kLaNow) integral += e * dt;
    const carry = clarifierCarry(mlssOf(x), inlet.Q, st.clarifierArea, p.settleFactor);
    // MLSS control: the operator raises wasting when MLSS is above set-point (proportional, GAME MODEL gain 2)
    // capped at 3× design wasting (WAS pump capacity) so a solids slug cannot wash out the nitrifiers; P-only → small offset
    const trim = p.mlssTarget ? Math.min(3, Math.max(0, 1 + 2 * (mlssOf(x) - p.mlssTarget) / p.mlssTarget)) : 1;
    const wasteRate = Math.max(0, trim / p.srt - D * carry);
    const r = asmStep(x, { Q: inlet.Q, V: p.V, T, in: inA, kLa: kLaNow, SOsat, wasteRate, effluentCarry: carry, inhibH, inhibA }, dt);
    x = r.x;
    kLaSum += kLaNow;
    ourSum += r.rates.OUR;
    heteroGrowth += (r.rates.rho1 + r.rates.rho2) / steps;
    nitGrowth += r.rates.rho3 / steps;
  }
  const kLa = kLaSum / steps;
  const OUR = ourSum / steps;
  const carry = clarifierCarry(mlssOf(x), inlet.Q, st.clarifierArea, p.settleFactor);
  // clarified effluent
  let out = cloneStream(inlet);
  out.SS = x.SS;
  out.XS = x.XS * carry;
  out.XI = (x.XI + x.XP) * carry; // decay products are inert particulate COD (not BOD, iXP not iXB)
  out.biomass = ((x.XBH + x.XBA) / ASM1.codPerVss) * carry;
  out.grit = 0;
  out.colloid = 0;
  out.floc = 0;
  out.inert = x.XM * carry;
  out.NH4N = x.SNH;
  out.NO3N = x.SNO;
  out.Cb = x.Cb;
  out.weakAcidT = inlet.SS > 0 ? inlet.weakAcidT * Math.min(1, x.SS / inlet.SS) : 0;
  out.OGfree *= 0.1;
  out.OGemulsified *= 0.1;
  for (const m of METALS) {
    out.precipitated[m] *= carry;
  }
  out.ml = undefined;
  // CO2 balance (knowledge/chemistry/acid_base_chemistry.md). Respiration CO2 from heterotroph growth only — aerobic and
  // anoxic, (1 − YH)/YH g COD oxidised per g COD grown, × RQ; nitrification releases none and nitrifier growth fixes
  // 1 mol C per 32 g COD (C5H7NO2: 160 g COD / 5 mol C).
  const co2P = (AERATION.RQ * ((1 - ASM1.YH) / ASM1.YH) * heteroGrowth * p.V) / 32 - (nitGrowth * p.V) / 32;
  // air follows the blower output: design air × kLa/kLa_design, with the mixing floor only while the blower runs
  const kLaDesign = st.kLaMax / 1.6;
  const airO2 = ((st.airDesign_mold ?? 0) * kLa) / Math.max(kLaDesign, 1e-9);
  const air = Math.max(airO2, mixingAir_mold(p.V, T) * Math.min(1, Math.max(0, p.blowerCap)));
  out = equilibrate(out, aerationCarbonate({ Q_m3d: inlet.Q, CTin: inlet.CT, T, co2Produced_mold: co2P, air_mold: air }));
  return { st: { ...st, x, integral, inert: out, metals }, out, kLa, OUR, mlss: mlssOf(x), carry };
}

/** Build the per-unit dynamic state from a steady-state solution of the design at average flow. */
function initialise(g: ProcessGraph, base: Stream) {
  const steady = simulate(g, base);
  const eq: Record<string, EQState> = {};
  const dos: Record<string, DosingState> = {};
  const as: Record<string, ASState> = {};
  for (const n of g.nodes) {
    const ns = steady.nodes[n.id];
    if (!ns) continue;
    if (n.kind === 'eq' && !n.bypass) eq[n.id] = { level: Number(n.params.volume) * 0.5, contents: cloneStream(ns.inlet) };
    if (DOSING.includes(n.kind as UnitType) && !n.bypass) {
      const demandEqPerL = (ns.result.calcs.demand?.value ?? 0) / 1000;
      const cap = 2.0 * demandEqPerL * ns.inlet.Q * 1000; // eq/d (eq/L × m³/d × 1000 L/m³), pump sized at 2× average demand
      dos[n.id] = { contents: cloneStream(ns.result.out), integral: 0.5, capacity: cap || 1e-6 };
    }
    if (n.kind === 'activatedSludge' && !n.bypass) {
      const V = Number(n.params.volume);
      const doSP = Number(n.params.do);
      const SOsat = oxygenSaturation(ns.inlet.T);
      const o2 = ns.result.calcs.o2?.value ?? 100; // kg/d
      const kLaMax = Math.min(360, (1.6 * o2 * 1000) / (V * Math.max(0.5, SOsat - doSP)));
      const clar = nextIsClarifier(g, n.id);
      // warm start: 4 × SRT of constant average loading so biomass reaches its operating state
      let st: ASState = {
        x: { ...toASM(ns.inlet), XBH: 1500, XBA: 80, XP: 200, SO: doSP, SNH: 1, SNO: 5 },
        integral: 0,
        kLaMax,
        airDesign_mold: airForO2_mold(o2 * 1000),
        clarifierArea: clar ? Number(clar.params.area) : 0,
        inert: cloneStream(ns.result.out),
        metals: { ...ns.inlet.dissolved },
      };
      // effective sludge age from the steady solution (MLSS control fixes it there); the replay then holds MLSS
      const srt = ns.result.calcs.control?.value ?? Number(n.params.srt);
      const mlssTarget = n.params.control === 'mlss' ? Number(n.params.mlss) || undefined : undefined;
      const warmSteps = Math.ceil((4 * srt * 24) / STEP_H);
      const manual = !hasInst(n, 'doLoop');
      for (let i = 0; i < warmSteps; i++) st = stepAS(st, ns.inlet, { V, srt, doSP, blowerCap: 1, settleFactor: 1, manual, mlssTarget }, ns.inlet.T).st;
      st.srtEff = srt;
      as[n.id] = st;
    }
  }
  return { steady, eq, dos, as };
}

const warmCache = new Map<string, ReturnType<typeof initialise>>();

export function runDynamic(g: ProcessGraph, base: Stream, standard: StandardId, opts: DynamicOptions): DynamicResult {
  const warm = opts.warmBase ?? base;
  // full design + full warm stream (incl. bypass flags, metals, T, Cb …) so no stale state can leak between plants or runs
  const key = JSON.stringify({ n: g.nodes.map((n) => [n.id, n.kind, n.params, !!n.bypass, n.inst ?? null]), e: g.edges, w: warm });
  if (!warmCache.has(key)) {
    if (warmCache.size > 20) warmCache.clear();
    warmCache.set(key, initialise(g, warm));
  }
  const init = warmCache.get(key)!;
  const eq = structuredClone(init.eq);
  const dos = structuredClone(init.dos);
  const as = structuredClone(init.as);
  const order = init.steady.order;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const points: TrendPoint[] = [];
  let compliant = 0;
  let worst: DynamicResult['worst'] = null;
  let worstRatio = 0;
  let overflowM3 = 0;
  let energy = 0;
  let reagent = 0;
  const dist = opts.disturbances;
  const pumpOff = new Set(dist.filter((d) => d.kind === 'pumpTrip').map((d) => (d as { unitId: string }).unitId));
  const probe = new Map(dist.filter((d) => d.kind === 'probeOffset').map((d) => [(d as { unitId: string }).unitId, (d as { offset: number }).offset]));
  const blower = new Map(dist.filter((d) => d.kind === 'blowerTrip').map((d) => [(d as { unitId: string }).unitId, (d as { capacity: number }).capacity]));
  const settle = new Map(dist.filter((d) => d.kind === 'bulking').map((d) => [(d as { unitId: string }).unitId, (d as { settleFactor: number }).settleFactor]));
  const dtD = STEP_H / 24;

  let prevEdge = new Map<string, Stream>();
  let lastEdge = new Map<string, Stream>();
  for (let k = 0; k <= opts.hours / STEP_H; k++) {
    const tH = k * STEP_H;
    const inf = influentAt(base, tH, dist);
    prevEdge = lastEdge;
    const edge = new Map<string, Stream>();
    lastEdge = edge;
    const units: Record<string, Record<string, number>> = {};
    let bypass: Stream | null = null;
    let effluent: Stream | null = null;
    for (const id of order) {
      const n = byId.get(id)!;
      // inlets: this step's value, or the previous step's for recycle (tear) pipes not yet computed this step
      const ins = g.edges.filter((e) => e.to === id).map((e) => edge.get(e.id) ?? prevEdge.get(e.id)).filter((x): x is Stream => !!x && x.Q > 1e-9);
      let inlet = n.kind === 'influent' ? inf : ins.length === 0 ? emptyStream(0) : ins.length === 1 ? ins[0] : equilibrate(blend(ins));
      if (n.kind === 'disposal') continue;
      if (n.kind === 'discharge') {
        effluent = bypass && bypass.Q > 0 ? equilibrate(blend([inlet, bypass])) : inlet;
        continue;
      }
      let outlet = inlet;
      if (n.bypass) {
        units[id] = { bypassed: 1 };
      } else if (n.kind !== 'influent' && inlet.Q <= 1e-9) {
        outlet = emptyStream(0); // nothing reaches this unit (e.g. the sludge line, quasi-static in the replay)
      } else if (n.kind !== 'influent') {
        const kind = n.kind as UnitType;
        if (kind === 'eq' && eq[id]) {
          const st = eq[id];
          const V = Number(n.params.volume);
          const target = base.Q * (opts.eqOutflowFraction?.[id] ?? 1);
          let qOut = target;
          const inVol = inlet.Q * dtD;
          const minLevel = 0.05 * V;
          // pump-down stops at the low-level cut-out: outflow is limited to what is above it (volume is conserved)
          qOut = Math.min(target, Math.max(0, (st.level + inVol - minLevel) / dtD));
          let level = st.level + inVol - qOut * dtD;
          let over = 0;
          if (level > V) {
            over = (level - V) / dtD;
            level = V;
          }
          // only the retained part of this step's inflow enters the tank; the overflow passes straight to drain
          const keep = cloneStream(st.contents);
          keep.Q = Math.max(1e-6, st.level);
          const add = cloneStream(inlet);
          add.Q = Math.max(0, inVol - over * dtD);
          st.contents = equilibrate(blend([keep, add]));
          st.level = level;
          outlet = cloneStream(st.contents);
          outlet.Q = qOut;
          outlet.peakFactor = 1;
          if (over > 0) {
            const b = cloneStream(inlet);
            b.Q = over;
            bypass = bypass ? blend([bypass, b]) : b;
            overflowM3 += over * dtD;
          }
          units[id] = { level: (100 * level) / V, outflow: qOut, overflow: over };
        } else if (DOSING.includes(kind) && dos[id]) {
          const st = dos[id];
          const V = Number(n.params.volume);
          const sp = Number(n.params.targetPH);
          // 1-min sub-steps: the loop (probe class A, T90 ≈ 1 min) must be sampled much faster than the tank HRT,
          // otherwise a 15-min step against a ~15-min HRT tank limit-cycles (bang-bang). Exact CSTR washout per sub-step.
          const sign = st.capacity >= 0 ? 1 : -1;
          const manualDose = !hasInst(n, 'pHLoop');
          const Kp = 0.4; // pump fraction per pH unit
          const Ti_h = 0.25;
          const sub = 15;
          const h = STEP_H / sub;
          const frac = 1 - Math.exp(-(inlet.Q * (h / 24)) / V);
          let measured = st.contents.pH;
          let uSum = 0;
          for (let j = 0; j < sub; j++) {
            measured = st.contents.pH + (probe.get(id) ?? 0);
            const err = sign * (sp - measured);
            const raw = Kp * err + st.integral;
            const uc = Math.min(1, Math.max(0, raw));
            if (raw === uc) st.integral += (Kp * err * h) / Ti_h; // conditional-integration anti-windup
            st.integral = Math.min(1, Math.max(0, st.integral));
            // no pH loop: the operator set the pump by hand at the design-average dose (half the pump capacity)
            const u = pumpOff.has(id) ? 0 : manualDose ? 0.5 : uc;
            uSum += u;
            const doseEq = u * Math.abs(st.capacity) * (h / 24);
            const keep = cloneStream(st.contents);
            keep.Q = 1 - frac;
            const add = cloneStream(inlet);
            add.Q = frac;
            const mixed = blend([keep, add]);
            if (sign > 0) mixed.Cb += doseEq / (V * 1000);
            else mixed.SO4T = (mixed.SO4T ?? 0) + doseEq / 2 / (V * 1000);
            st.contents = equilibrate(mixed);
            reagent += (doseEq * (sign > 0 ? 40 : 49)) / 1000;
          }
          const u = uSum / sub;
          st.contents.v50 = { ...st.contents.v50, precipitate: unaidedPrecipitateV50((V / Math.max(inlet.Q, 1)) * 1440, poolMass(st.contents, 'precipitate')) };
          outlet = cloneStream(st.contents);
          outlet.Q = inlet.Q;
          units[id] = { pH: st.contents.pH, pHmeasured: measured, pump: 100 * u, sp };
        } else if (kind === 'activatedSludge' && as[id]) {
          const V = Number(n.params.volume);
          const r = stepAS(as[id], inlet, { V, srt: as[id].srtEff ?? Number(n.params.srt), mlssTarget: n.params.control === 'mlss' ? Number(n.params.mlss) || undefined : undefined, doSP: Number(n.params.do), blowerCap: blower.get(id) ?? 1, settleFactor: settle.get(id) ?? 1, manual: !hasInst(n, 'doLoop') }, inlet.T);
          as[id] = r.st;
          outlet = r.out;
          energy += ((r.kLa * V * oxygenSaturation(inlet.T)) / 1000 / 1.8) * dtD; // BSM1 aeration-energy relation (kWh)
          units[id] = { DO: r.st.x.SO, MLSS: r.mlss, NH4: r.st.x.SNH, NO3: r.st.x.SNO, OUR: r.OUR / 24, blower: (100 * r.kLa) / Math.max(as[id].kLaMax, 1e-6), carry: r.carry * 100 };
        } else if (kind === 'clarifier' && g.edges.some((e) => e.to === id && byId.get(e.from)?.kind === 'activatedSludge')) {
          outlet = inlet; // secondary clarification is part of the dynamic AS reactor
          units[id] = { TSS: tss(inlet) };
        } else if (pumpOff.has(id)) {
          outlet = inlet; // quasi-steady dosing unit with its reagent pump down: no treatment
          units[id] = { pH: inlet.pH, pump: 0 };
        } else {
          // quasi-steady unit; a pH-probe offset makes its loop hold the TRUE pH at set-point − offset
          const base = effectiveParams(n);
          const params = probe.has(id) && base.targetPH !== undefined ? { ...base, targetPH: Number(base.targetPH) - probe.get(id)! } : base;
          const r = CATALOGUE[kind].run(inlet, params, { clarifierFollows: true });
          outlet = r.out;
          const c = r.calcs;
          units[id] = { pH: r.out.pH, TSS: tss(r.out), ...(c.sor ? { SOR: c.sor.value } : {}), ...(params.targetPH !== undefined ? { pHmeasured: r.out.pH + (probe.get(id) ?? 0), sp: Number(n.params.targetPH) } : {}) };
        }
      }
      // GAME MODEL: in the SCADA replay the sludge line is quasi-static — sludge pipes carry no flow (solids leave as in the
      // steady model) and splitters keep their set split.
      const outs = g.edges.filter((e) => e.from === id && e.fromPort !== 'sludge' && e.fromPort !== 'ras');
      for (const e of g.edges.filter((x) => x.from === id && (x.fromPort === 'sludge' || x.fromPort === 'ras'))) edge.set(e.id, emptyStream(0));
      const split = n.kind === 'splitter' ? Math.min(1, Math.max(0, Number(n.params.split ?? 50) / 100)) : null;
      const aN = outs.filter((e) => e.fromPort === 'a').length;
      const bN = outs.length - aN;
      for (const e of outs) {
        const s = cloneStream(outlet);
        s.Q = split !== null && aN && bN ? (outlet.Q * (e.fromPort === 'a' ? split : 1 - split)) / (e.fromPort === 'a' ? aN : bN) : outlet.Q / outs.length;
        edge.set(e.id, s);
      }
    }
    const eff = effluent ?? emptyStream(0);
    const rep = eff.Q > 1e-6 ? evaluate(eff, standard) : null; // no discharge at this instant: nothing to violate
    const m = measure(eff);
    const failed = rep ? rep.checks.filter((c) => !c.pass) : [];
    if (!rep || rep.pass) compliant++;
    for (const c of failed) {
      const lim = c.limit.max ?? c.limit.min ?? 0;
      const ratio = c.limit.max !== undefined ? c.value / Math.max(lim, 1e-9) : lim / Math.max(c.value, 1e-9);
      if (!worst || ratio > worstRatio) {
        worst = { param: c.param, value: c.value, limit: lim };
        worstRatio = ratio;
      }
    }
    points.push({
      t: tH,
      Qin: inf.Q,
      effluent: { pH: m.pH, COD: m.COD, BOD5: m.BOD5, TSS: m.TSS, NH3N: m.NH3N, Ni: m.Ni, Cu: m.Cu, Zn: m.Zn, CrVI: m.CrVI, OG: m.OG, Q: eff.Q },
      pass: !rep || rep.pass,
      failed: failed.map((c) => c.param),
      units,
    });
  }
  return { points, compliantFraction: compliant / points.length, worst, overflowM3, energy_kWh: energy, reagent_kg: reagent };
}
