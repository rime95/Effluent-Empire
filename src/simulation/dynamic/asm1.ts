/**
 * ASM1 (Henze et al. 1987, IAWPRC Activated Sludge Model No. 1) — dynamic activated-sludge reactor for SCADA.
 * Ref: knowledge/biological/asm1.md. Parameters: BSM1 benchmark set (Alex et al. 2008), temperature-corrected.
 *
 * States (mg/L): SS, XS (COD), XBH, XBA, XP, XI (COD), SNH, SNO (N), SO (O2), XM (mineral solids), Cb (eq/L).
 * Processes (ASM1 numbering): 1 aerobic heterotrophic growth, 2 anoxic heterotrophic growth, 3 aerobic autotrophic growth,
 * 4/5 decay (death–regeneration), 7 hydrolysis. Simplification (documented): organic N (SND, XND) is not tracked —
 * decay releases iXB − fP·iXP of N directly as NH4 (ammonification lumped), alkalinity via the charge balance (Cb).
 */
import { tempCorrect } from '../core/units';

export const ASM1 = {
  // stoichiometry
  YH: 0.67,
  YA: 0.24,
  fP: 0.08,
  iXB: 0.08,
  iXP: 0.06,
  // kinetics (BSM1 values, reference temperature below)
  muH: 4.0,
  KS: 10,
  KOH: 0.2,
  KNO: 0.5,
  bH: 0.3,
  etaG: 0.8,
  etaH: 0.8,
  kh: 3.0,
  KX: 0.1,
  muA: 0.5,
  KNH: 1.0,
  bA: 0.05,
  KOA: 0.4,
  /** ammonium nutrient half-saturation for heterotroph growth, mg N/L (ASM2d/ASM3 value 0.05; not in ASM1/BSM1) */
  KNH_H: 0.05,
  /** temperature at which the kinetic set is specified (°C) — see knowledge/biological/asm1.md */
  Tref: 15,
  // verify: θ from Henze et al. 1987 Table 6 (20/10 °C pairs): bH 0.62/0.20 → 1.12, kh 3.0/1.0 → 1.116; μH, μA, bA textbook
  theta: { muH: 1.072, bH: 1.12, muA: 1.103, bA: 1.04, kh: 1.116 },
  /** g COD per g VSS — converts ASM COD states to the game's VSS biomass pool */
  codPerVss: 1.42,
};

export interface AS1State {
  SS: number;
  XS: number;
  XBH: number;
  XBA: number;
  XP: number;
  XI: number;
  SNH: number;
  SNO: number;
  SO: number;
  XM: number;
  Cb: number;
}

export interface AS1Inputs {
  /** inflow, m³/d */
  Q: number;
  V: number;
  T: number;
  in: Omit<AS1State, 'SO'> & { SO: number };
  /** oxygen transfer coefficient, 1/d */
  kLa: number;
  SOsat: number;
  /** fraction of reactor solids leaving per day via waste sludge: Qw/V = 1/SRT (controller) */
  wasteRate: number;
  /** fraction of reactor particulate concentration leaving with the clarified effluent (carry-over / MLSS ratio) */
  effluentCarry: number;
  /** activity multipliers (pH, toxicity) */
  inhibH: number;
  inhibA: number;
}

/** Oxygen saturation in fresh water at 1 atm, mg/L — Benson & Krause (1984) as given in APHA Standard Methods 4500-O.
 * 20 °C → 9.09, 30 °C → 7.56 mg/L. */
export function oxygenSaturation(T: number): number {
  const K = T + 273.15;
  return Math.exp(-139.34411 + 1.575701e5 / K - 6.642308e7 / K ** 2 + 1.2438e10 / K ** 3 - 8.621949e11 / K ** 4);
}

export interface AS1Rates {
  rho1: number;
  rho2: number;
  rho3: number;
  OUR: number;
  nitrification: number;
}

const STATES: (keyof AS1State)[] = ['SS', 'XS', 'XBH', 'XBA', 'XP', 'XI', 'SNH', 'SNO', 'SO', 'XM', 'Cb'];
const N_EQ = 14_007; // mg N per mol → eq/L per mg/L of NH4+ or NO3−

/**
 * Process rates ρj (mg COD/L/d) and the Petersen stoichiometric matrix ν (rows = processes, BSM1 §2.2.3).
 * Process order: 0 aerobic het. growth, 1 anoxic het. growth, 2 autotroph growth, 3 het. decay, 4 aut. decay, 5 hydrolysis.
 * Heterotroph growth carries an ammonium nutrient switch SNH/(K_NH,H + SNH) (ASM2d/ASM3 practice, Henze et al. 2000)
 * so N-deficient industrial feeds cannot create biomass N from nothing.
 */
export function processes(x: AS1State, u: Pick<AS1Inputs, 'T' | 'inhibH' | 'inhibA'>): { rho: number[]; nu: Partial<AS1State>[] } {
  const p = ASM1;
  const dT = (k: number, th: number) => tempCorrect(k, th, u.T + (20 - p.Tref)); // θ^(T − Tref)
  const muH = dT(p.muH, p.theta.muH) * u.inhibH;
  const bH = dT(p.bH, p.theta.bH);
  const muA = dT(p.muA, p.theta.muA) * u.inhibA;
  const bA = dT(p.bA, p.theta.bA);
  const kh = dT(p.kh, p.theta.kh);
  const SO = Math.max(0, x.SO);
  const SS = Math.max(0, x.SS);
  const SNH = Math.max(0, x.SNH);
  const SNO = Math.max(0, x.SNO);
  const XBH = Math.max(0, x.XBH);
  const XBA = Math.max(0, x.XBA);
  const mO = SO / (p.KOH + SO);
  const mOff = p.KOH / (p.KOH + SO);
  const mNO = SNO / (p.KNO + SNO);
  const mNH = SNH / (p.KNH_H + SNH);
  const ratio = XBH > 1e-9 ? Math.max(0, x.XS) / XBH : 0;
  const rho = [
    muH * (SS / (p.KS + SS)) * mO * mNH * XBH,
    muH * (SS / (p.KS + SS)) * mOff * mNO * mNH * p.etaG * XBH,
    muA * (SNH / (p.KNH + SNH)) * (SO / (p.KOA + SO)) * XBA,
    bH * XBH,
    bA * XBA,
    kh * (ratio / (p.KX + ratio)) * (mO + p.etaH * mOff * mNO) * XBH,
  ];
  const decayN = p.iXB - p.fP * p.iXP; // organic N of decayed biomass released straight to NH4 (ammonification lumped)
  const withCb = (v: Partial<AS1State>): Partial<AS1State> => ({ ...v, Cb: ((v.SNH ?? 0) - (v.SNO ?? 0)) / N_EQ });
  const nu: Partial<AS1State>[] = [
    withCb({ SS: -1 / p.YH, XBH: 1, SO: -(1 - p.YH) / p.YH, SNH: -p.iXB }),
    withCb({ SS: -1 / p.YH, XBH: 1, SNO: -(1 - p.YH) / (2.86 * p.YH), SNH: -p.iXB }),
    withCb({ XBA: 1, SO: -(4.57 - p.YA) / p.YA, SNH: -p.iXB - 1 / p.YA, SNO: 1 / p.YA }),
    withCb({ XBH: -1, XS: 1 - p.fP, XP: p.fP, SNH: decayN }),
    withCb({ XBA: -1, XS: 1 - p.fP, XP: p.fP, SNH: decayN }),
    { XS: -1, SS: 1 },
  ];
  return { rho, nu };
}

/** Transport terms (per day): dilution, particulate loss (wasting + carry-over), aeration. */
function transport(x: AS1State, u: AS1Inputs): AS1State {
  const D = u.Q / u.V;
  const lossX = u.wasteRate + D * u.effluentCarry;
  const sol = (k: keyof AS1State) => D * (u.in[k] - x[k]);
  const part = (k: keyof AS1State) => D * u.in[k] - lossX * x[k];
  return {
    SS: sol('SS'), SNH: sol('SNH'), SNO: sol('SNO'), Cb: sol('Cb'),
    SO: sol('SO') + u.kLa * (u.SOsat - x.SO),
    XS: part('XS'), XBH: part('XBH'), XBA: part('XBA'), XP: part('XP'), XI: part('XI'), XM: part('XM'),
  };
}

const rates = (rho: number[]): AS1Rates => {
  const p = ASM1;
  const our = ((1 - p.YH) / p.YH) * rho[0] + ((4.57 - p.YA) / p.YA) * rho[2];
  return { rho1: rho[0], rho2: rho[1], rho3: rho[2], OUR: our, nitrification: rho[2] / p.YA };
};

/** Derivatives (per day) of all states. Pure. */
export function derivatives(x: AS1State, u: AS1Inputs): { dx: AS1State; rates: AS1Rates } {
  const { rho, nu } = processes(x, u);
  const dx = transport(x, u);
  nu.forEach((row, j) => {
    for (const k of Object.keys(row) as (keyof AS1State)[]) dx[k] += (row[k] as number) * rho[j];
  });
  return { dx, rates: rates(rho) };
}

/** Recommended sub-step, d (20 s). SS/SO/SNH are stiff (∂r/∂x ≈ μH·XBH/(YH·KS) ≈ 10³–10⁴ d⁻¹ at MLSS 3–5 g/L). */
export const ASM1_SUBSTEP = 1 / 4320;

/**
 * One conservative, positivity-preserving step.
 * Reactions are applied as whole stoichiometric vectors (so every linear invariant — COD/electron and N balances — is
 * conserved exactly); a process whose reactants would be over-drawn in this step is scaled back to what is available
 * (process-limiting, in the spirit of modified-Patankar schemes, Burchard et al. 2003). Transport is explicit.
 */
export function step(x: AS1State, u: AS1Inputs, h: number): { x: AS1State; rates: AS1Rates } {
  const { rho, nu } = processes(x, u);
  const tr = transport(x, u);
  const avail = {} as AS1State;
  const demand = {} as AS1State;
  for (const k of STATES) {
    avail[k] = Math.max(0, x[k] + h * tr[k]);
    demand[k] = 0;
  }
  nu.forEach((row, j) => {
    for (const k of Object.keys(row) as (keyof AS1State)[]) if (k !== 'Cb' && (row[k] as number) < 0) demand[k] += -(row[k] as number) * rho[j] * h;
  });
  const scale = rho.map((_, j) => {
    let f = 1;
    for (const k of Object.keys(nu[j]) as (keyof AS1State)[]) {
      if (k === 'Cb' || (nu[j][k] as number) >= 0 || demand[k] <= avail[k]) continue;
      f = Math.min(f, avail[k] / demand[k]);
    }
    return f;
  });
  const nx = {} as AS1State;
  for (const k of STATES) nx[k] = x[k] + h * tr[k];
  nu.forEach((row, j) => {
    for (const k of Object.keys(row) as (keyof AS1State)[]) nx[k] += (row[k] as number) * rho[j] * scale[j] * h;
  });
  for (const k of STATES) if (k !== 'Cb' && nx[k] < 0) nx[k] = 0; // round-off only
  return { x: nx, rates: rates(rho.map((r, j) => r * scale[j])) };
}

/** Integrate over dtDays with fixed sub-steps; rates returned are averaged over the interval. */
export function integrate(x0: AS1State, u: AS1Inputs, dtDays: number, subStep = ASM1_SUBSTEP): { x: AS1State; rates: AS1Rates } {
  let x = { ...x0 };
  const n = Math.max(1, Math.ceil(dtDays / subStep));
  const h = dtDays / n;
  const acc: AS1Rates = { rho1: 0, rho2: 0, rho3: 0, OUR: 0, nitrification: 0 };
  for (let i = 0; i < n; i++) {
    const r = step(x, u, h);
    x = r.x;
    for (const k of Object.keys(acc) as (keyof AS1Rates)[]) acc[k] += r.rates[k] / n;
  }
  return { x, rates: acc };
}

/** Mixed-liquor suspended solids, mg/L (COD states → VSS via 1.42; mineral solids as-is). */
export function mlss(x: AS1State): number {
  return (x.XS + x.XBH + x.XBA + x.XP + x.XI) / ASM1.codPerVss + x.XM;
}
