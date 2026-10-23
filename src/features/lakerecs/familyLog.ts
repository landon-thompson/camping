import type { FishingLog } from '../../model/lakerecs';
import type { LakeKey, SpeciesCode } from './types';

/**
 * Family-log update (docs/LAKE_RECS_PLAN.md §4). The lake's quality index
 * λ = exp(θ) gets a Gamma(shape a, rate b) matched to the model's samples;
 * each outing is `count ~ Poisson(hours · r_s · λ)`, so the update is
 * conjugate: a += w·Σcount, b += w·Σ(hours·r_s), with tempering w.
 *
 * Summaries: the model's own p10/med/p90 are moved by the same amount the
 * Gamma quantiles move (ln Q_post(p) − ln Q_prior(p)). With no outings (or
 * w = 0) that is exactly the model's numbers; otherwise it is the Gamma
 * update applied to the model's shape. Samples get importance weights
 * ∝ likelihood^w for Thompson draws.
 */

// ------------------------------------------------------------ special functions

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x), x > 0 (Lanczos, g = 7; ~15 significant digits). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let s = LANCZOS[0]!;
  for (let i = 1; i < 9; i++) s += LANCZOS[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s);
}

const EPS = 1e-15;
const FPMIN = 1e-300;
const MAX_ITER = 100_000;

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || Number.isNaN(x)) return Number.NaN;
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  const front = -x + a * Math.log(x) - lnGamma(a);
  if (x < a + 1) {
    // Series.
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < MAX_ITER; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return Math.min(1, sum * Math.exp(front));
  }
  // Continued fraction for Q (modified Lentz).
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.max(0, 1 - Math.exp(front) * h);
}

/** Standard normal quantile (Acklam's rational approximation, |rel err| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function wilsonHilferty(p: number, a: number): number {
  const z = normalQuantile(p);
  const k = 1 / (9 * a);
  return a * Math.max(1e-12, 1 - k + z * Math.sqrt(k)) ** 3;
}

/**
 * Quantile of Gamma(shape a, rate b): Wilson–Hilferty (or a small-shape
 * power-law) start, then Halley-corrected Newton steps on P(a, x) − p.
 */
export function gammaQuantile(p: number, a: number, b = 1): number {
  if (!(a > 0) || !(b > 0) || Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  // Very large shapes: Wilson–Hilferty alone is accurate to ~1e-8 relative.
  if (a > 1e5) return wilsonHilferty(p, a) / b;
  const gln = lnGamma(a);
  const a1 = a - 1;
  let x: number;
  if (a > 1) {
    x = Math.max(1e-3, wilsonHilferty(p, a));
  } else {
    const t = 1 - a * (0.253 + a * 0.12);
    x = p < t ? (p / t) ** (1 / a) : 1 - Math.log(1 - (p - t) / (1 - t));
  }
  for (let j = 0; j < 100; j++) {
    if (x <= 0) return 0;
    const err = gammaP(a, x) - p;
    const pdf = Math.exp(-x + a1 * Math.log(x) - gln);
    if (!(pdf > 0)) break;
    const u = err / pdf;
    const step = u / (1 - 0.5 * Math.min(1, u * (a1 / x - 1)));
    let next = x - step;
    if (next <= 0) next = 0.5 * x;
    const done = Math.abs(next - x) < 1e-12 * next;
    x = next;
    if (done) break;
  }
  return x / b;
}

// ------------------------------------------------------------ Gamma fits

export interface GammaParams {
  shape: number;
  rate: number;
}

/** Moment-match Gamma(a, b) to exp(θ) for θ samples. Null when there are none. */
export function momentMatchGamma(theta: ArrayLike<number>): GammaParams | null {
  const n = theta.length;
  if (!n) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += Math.exp(theta[i]!);
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (Math.exp(theta[i]!) - mean) ** 2;
  v /= Math.max(1, n - 1);
  if (!(mean > 0) || !Number.isFinite(mean)) return null;
  // Identical samples (a coarse quantization) would give infinite shape; cap at a 1% sd.
  v = Math.max(v, (0.01 * mean) ** 2);
  return { shape: (mean * mean) / v, rate: mean / v };
}

/** Fallback when samples are missing: treat θ as normal from p10/p90 and match moments of exp(θ). */
export function gammaFromSummary(s: { med: number; p10: number; p90: number }): GammaParams | null {
  if (![s.med, s.p10, s.p90].every(Number.isFinite)) return null;
  const sigma = Math.max(0.01, (s.p90 - s.p10) / (2 * 1.2815515655446004));
  const mean = Math.exp(s.med + (sigma * sigma) / 2);
  const v = (Math.exp(sigma * sigma) - 1) * Math.exp(2 * s.med + sigma * sigma);
  return { shape: (mean * mean) / v, rate: mean / v };
}

// ------------------------------------------------------------ family log

export interface OutingEvidence {
  outings: number;
  fish: number;
  hours: number;
  /** Σ hours × r_s: expected fish at a typical lake. */
  exposure: number;
}

/**
 * Outings at this lake that say something about this species: it was caught,
 * or it was a target (a missing count then means zero). Zero-hour outings
 * carry no information and are skipped.
 */
export function outingEvidence(logs: FishingLog[], lakeKey: LakeKey, species: SpeciesCode, ratePerHour: number): OutingEvidence {
  const out: OutingEvidence = { outings: 0, fish: 0, hours: 0, exposure: 0 };
  for (const log of logs) {
    if (log.lakeKey !== lakeKey || !(log.hours > 0)) continue;
    const caught = log.catches.find((c) => c.species === species);
    if (!caught && !log.targetSpecies.includes(species)) continue;
    out.outings++;
    out.fish += Math.max(0, caught?.count ?? 0);
    out.hours += log.hours;
    out.exposure += log.hours * ratePerHour;
  }
  return out;
}

export interface FamilyUpdate {
  /** True when at least one outing moved the estimate. */
  used: boolean;
  evidence: OutingEvidence;
  /** Updated θ percentiles (log-index). */
  p10: number;
  med: number;
  p90: number;
  /** Importance weights for `samples` (sum 1), or null when unchanged / no samples. */
  weights: Float64Array | null;
}

export interface FamilyOptions {
  tempering: number;
  ratePerHour: number;
}

export function applyFamilyLog(
  est: { med: number; p10: number; p90: number },
  samples: ArrayLike<number>,
  logs: FishingLog[],
  lakeKey: LakeKey,
  species: SpeciesCode,
  opts: FamilyOptions,
): FamilyUpdate {
  const ev = outingEvidence(logs, lakeKey, species, opts.ratePerHour);
  const unchanged: FamilyUpdate = { used: false, evidence: ev, p10: est.p10, med: est.med, p90: est.p90, weights: null };
  const w = Math.max(0, opts.tempering);
  if (!ev.outings || !(ev.exposure > 0) || w === 0) return unchanged;
  const prior = momentMatchGamma(samples) ?? gammaFromSummary(est);
  if (!prior) return unchanged;
  const post: GammaParams = { shape: prior.shape + w * ev.fish, rate: prior.rate + w * ev.exposure };
  const shift = (p: number) => {
    const d = Math.log(gammaQuantile(p, post.shape, post.rate)) - Math.log(gammaQuantile(p, prior.shape, prior.rate));
    return Number.isFinite(d) ? d : 0;
  };
  let weights: Float64Array | null = null;
  const n = samples.length;
  if (n) {
    const logw = new Float64Array(n);
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const t = samples[i]!;
      logw[i] = w * (ev.fish * t - ev.exposure * Math.exp(t));
      if (logw[i]! > max) max = logw[i]!;
    }
    let sum = 0;
    weights = new Float64Array(n);
    for (let i = 0; i < n; i++) sum += weights[i] = Math.exp(logw[i]! - max);
    for (let i = 0; i < n; i++) weights[i] = weights[i]! / sum;
  }
  return { used: true, evidence: ev, p10: est.p10 + shift(0.1), med: est.med + shift(0.5), p90: est.p90 + shift(0.9), weights };
}
