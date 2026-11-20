/**
 * Ideal (Hazen/Camp) discrete settling with a log-normal settling-velocity distribution.
 * Ref: knowledge/physical/sedimentation.md
 *
 * A particle with settling velocity v is removed with probability min(1, v / SOR).
 * For ln v ~ N(μ, σ²) with median v50 = e^μ:
 *   R = P(v ≥ SOR) + (1/SOR)·E[v · 1(v < SOR)]
 *     = 1 − Φ(z₀) + (e^(μ+σ²/2) / SOR) · Φ(z₀ − σ),   z₀ = (ln SOR − μ)/σ
 */


/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf, |ε| < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** GAME MODEL: geometric spread of settling velocities (ln units). */
export const SETTLING_SIGMA = 0.8;

export function hazenRemoval(v50_mh: number, SOR_mh: number, sigma = SETTLING_SIGMA): number {
  if (SOR_mh <= 0) return 1;
  if (v50_mh <= 0) return 0;
  const mu = Math.log(v50_mh);
  const z0 = (Math.log(SOR_mh) - mu) / sigma;
  const r = 1 - normalCdf(z0) + (Math.exp(mu + (sigma * sigma) / 2) / SOR_mh) * normalCdf(z0 - sigma);
  return Math.min(1, Math.max(0, r));
}

/** Dynamic viscosity of water, Pa·s (Vogel equation). 25 °C → 0.89e-3 */
export function waterViscosity(T_C: number): number {
  const T = T_C + 273.15;
  return 2.414e-5 * Math.pow(10, 247.8 / (T - 140));
}

/** Water density, kg/m³ (simple fit, 0–40 °C). */
export function waterDensity(T_C: number): number {
  return 1000 * (1 - ((T_C + 288.9414) / (508929.2 * (T_C + 68.12963))) * Math.pow(T_C - 3.9863, 2));
}

/**
 * Stokes' law terminal velocity, m/h (positive = settling, negative = rising).
 * v = g (ρp − ρw) d² / (18 μ). Valid for Re < ~1.
 */
export function stokesVelocity_mh(d_m: number, rhoParticle: number, T_C: number): number {
  const g = 9.81;
  const v = (g * (rhoParticle - waterDensity(T_C)) * d_m * d_m) / (18 * waterViscosity(T_C));
  return v * 3600;
}

/**
 * Vesilind zone-settling velocity of activated sludge, m/h: v = v0 · exp(−k·X), X in g/L.
 * Daigger & Roper (1985): ln v = 1.871 − (0.1646 + 0.001586·SVI)·X  ->  SVI ≈ 110 mL/g: v0 ≈ 6.5 m/h, k ≈ 0.34 L/g.
 */
export function vesilind_mh(mlss_mgL: number, v0 = 6.5, k = 0.34): number {
  return v0 * Math.exp(-k * (mlss_mgL / 1000));
}


