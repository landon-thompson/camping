import { describe, expect, it } from 'vitest';
import type { FishingLog } from '../../model/lakerecs';
import { applyFamilyLog, gammaFromSummary, gammaP, gammaQuantile, lnGamma, momentMatchGamma, normalQuantile, outingEvidence } from './familyLog';

describe('special functions', () => {
  it('lnGamma matches known values', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(lnGamma(100)).toBeCloseTo(359.13420536957540, 9);
  });

  it('gammaP matches closed forms', () => {
    for (const x of [0.01, 0.5, 1, 3, 10, 40]) expect(gammaP(1, x)).toBeCloseTo(1 - Math.exp(-x), 13);
    // P(2, x) = 1 − e^−x (1 + x)
    for (const x of [0.2, 2, 7]) expect(gammaP(2, x)).toBeCloseTo(1 - Math.exp(-x) * (1 + x), 13);
    expect(gammaP(3, 0)).toBe(0);
  });

  it('normalQuantile matches known values', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.9)).toBeCloseTo(1.2815515655446, 8);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540, 8);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306168, 7);
  });

  it('gammaQuantile matches reference values (chi-square tables / closed forms)', () => {
    const cases: [p: number, a: number, expected: number][] = [
      [0.5, 1, Math.LN2],
      [0.1, 1, -Math.log(0.9)],
      [0.9, 1, Math.log(10)],
      [0.5, 2, 1.6783469900166608],
      [0.5, 0.5, 0.4549364231195724 / 2], // χ²(1) median ÷ 2
      [0.9, 0.5, 2.705543454095404 / 2], // χ²(1) 90th ÷ 2
      [0.5, 5, 9.341817765591966 / 2], // χ²(10) median ÷ 2
      [0.9, 10, 28.411980584305635 / 2], // χ²(20) 90th ÷ 2
      [0.1, 3, 2.204130656498 / 2], // χ²(6) 10th ÷ 2
    ];
    for (const [p, a, expected] of cases) expect(gammaQuantile(p, a)).toBeCloseTo(expected, 9);
    // Rate scales the quantile.
    expect(gammaQuantile(0.5, 2, 4)).toBeCloseTo(1.6783469900166608 / 4, 10);
  });

  it('gammaQuantile inverts gammaP across shapes, including tiny and huge ones', () => {
    for (const a of [0.05, 0.1, 0.3, 0.9, 1.5, 4, 25, 300, 5000]) {
      for (const p of [0.001, 0.1, 0.5, 0.9, 0.999]) {
        const x = gammaQuantile(p, a);
        expect(x).toBeGreaterThan(0);
        expect(gammaP(a, x)).toBeCloseTo(p, 8);
      }
    }
    // Beyond 1e5 Wilson–Hilferty alone: median ≈ a − 1/3.
    expect(gammaQuantile(0.5, 1e6) / (1e6 - 1 / 3)).toBeCloseTo(1, 8);
    expect(gammaQuantile(0, 2)).toBe(0);
    expect(gammaQuantile(1, 2)).toBe(Infinity);
    expect(gammaQuantile(0.5, 0)).toBeNaN();
  });
});

describe('Gamma fits', () => {
  it('moment-matches exp(θ)', () => {
    const g = momentMatchGamma([0, 0, Math.log(2), Math.log(2)])!;
    // λ = 1,1,2,2: mean 1.5, sample var 1/3 → a = 6.75, b = 4.5
    expect(g.shape).toBeCloseTo(6.75, 10);
    expect(g.rate).toBeCloseTo(4.5, 10);
    expect(momentMatchGamma([])).toBeNull();
    // Identical samples cap the shape instead of dividing by zero.
    expect(momentMatchGamma([0.3, 0.3, 0.3])!.shape).toBeCloseTo(10_000, 6);
  });

  it('builds a Gamma from summaries when samples are missing', () => {
    const g = gammaFromSummary({ med: 0, p10: -0.5, p90: 0.5 })!;
    expect(g.shape / g.rate).toBeCloseTo(Math.exp(((0.5 / 1.2815515655446004) ** 2) / 2), 10);
    expect(gammaFromSummary({ med: Number.NaN, p10: 0, p90: 1 })).toBeNull();
  });
});

const LAKE = 'mn:99000001';
const log = (over: Partial<FishingLog>): FishingLog => ({
  lakeKey: LAKE,
  lakeName: 'Fixture Lake Alpha',
  tripId: null,
  date: '2027-06-10',
  hours: 4,
  anglers: 2,
  catches: [],
  targetSpecies: ['WAE'],
  rating: null,
  notes: '',
  ...over,
});

// Synthetic posterior: θ ~ N(0, 0.5) as sorted quantile points.
const SAMPLES = Float64Array.from({ length: 200 }, (_, i) => 0.5 * normalQuantile((i + 0.5) / 200));
const EST = { med: 0, p10: -0.5 * 1.2815515655446004, p90: 0.5 * 1.2815515655446004 };
const OPTS = { tempering: 0.5, ratePerHour: 0.3 };

describe('family log update', () => {
  it('collects evidence: zero for targets, skips other lakes, other species and zero hours', () => {
    const logs = [
      log({ catches: [{ species: 'WAE', count: 3 }] }),
      log({ catches: [{ species: 'NOP', count: 2 }] }), // walleye target, none caught → 0
      log({ catches: [{ species: 'NOP', count: 2 }], targetSpecies: ['NOP'] }), // says nothing about walleye
      log({ lakeKey: 'mn:99000002', catches: [{ species: 'WAE', count: 9 }] }),
      log({ hours: 0, catches: [{ species: 'WAE', count: 9 }] }),
    ];
    expect(outingEvidence(logs, LAKE, 'WAE', 0.3)).toEqual({ outings: 2, fish: 3, hours: 8, exposure: 8 * 0.3 });
  });

  it('a good catch raises the estimate; a skunk lowers it', () => {
    const up = applyFamilyLog(EST, SAMPLES, [log({ catches: [{ species: 'WAE', count: 5 }] })], LAKE, 'WAE', OPTS);
    expect(up.used).toBe(true);
    expect(up.med).toBeGreaterThan(EST.med + 0.1);
    expect(up.p10).toBeGreaterThan(EST.p10);
    expect(up.p90).toBeGreaterThan(EST.p90);
    const down = applyFamilyLog(EST, SAMPLES, [log({ hours: 8 })], LAKE, 'WAE', OPTS);
    expect(down.med).toBeLessThan(EST.med - 0.05);
    expect(down.p90).toBeLessThan(EST.p90);
  });

  it('tempering w = 0.5 equals half the data at w = 1 and roughly halves the effect', () => {
    const half = applyFamilyLog(EST, SAMPLES, [log({ hours: 4, catches: [{ species: 'WAE', count: 2 }] })], LAKE, 'WAE', OPTS);
    const fullHalfData = applyFamilyLog(EST, SAMPLES, [log({ hours: 2, catches: [{ species: 'WAE', count: 1 }] })], LAKE, 'WAE', { ...OPTS, tempering: 1 });
    expect(half.med).toBeCloseTo(fullHalfData.med, 12);
    const full = applyFamilyLog(EST, SAMPLES, [log({ hours: 4, catches: [{ species: 'WAE', count: 2 }] })], LAKE, 'WAE', { ...OPTS, tempering: 1 });
    const ratio = (half.med - EST.med) / (full.med - EST.med);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.75);
  });

  it('leaves the estimate alone with no usable outings', () => {
    const none = applyFamilyLog(EST, SAMPLES, [log({ hours: 0, catches: [{ species: 'WAE', count: 4 }] })], LAKE, 'WAE', OPTS);
    expect(none).toMatchObject({ used: false, med: EST.med, p10: EST.p10, p90: EST.p90, weights: null });
    expect(applyFamilyLog(EST, SAMPLES, [log({ catches: [{ species: 'WAE', count: 4 }] })], LAKE, 'WAE', { ...OPTS, tempering: 0 }).used).toBe(false);
  });

  it('works without samples (summary fallback) and with huge counts', () => {
    const noSamples = applyFamilyLog(EST, [], [log({ catches: [{ species: 'WAE', count: 5 }] })], LAKE, 'WAE', OPTS);
    expect(noSamples.used).toBe(true);
    expect(noSamples.weights).toBeNull();
    expect(noSamples.med).toBeGreaterThan(EST.med);
    const huge = applyFamilyLog(EST, SAMPLES, [log({ hours: 24, catches: [{ species: 'WAE', count: 999 }] }), ...Array.from({ length: 80 }, () => log({ hours: 24, catches: [{ species: 'WAE', count: 999 }] }))], LAKE, 'WAE', OPTS);
    expect(Number.isFinite(huge.med) && Number.isFinite(huge.p10) && Number.isFinite(huge.p90)).toBe(true);
    // Data dominate: rate ≈ 999 fish / (24 h × 0.3) ≈ 139× typical.
    expect(huge.med).toBeGreaterThan(Math.log(100));
    expect(huge.weights!.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
  });

  it('importance weights favour high samples after a good catch', () => {
    const up = applyFamilyLog(EST, SAMPLES, [log({ catches: [{ species: 'WAE', count: 5 }] })], LAKE, 'WAE', OPTS);
    const w = up.weights!;
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(w[199]!).toBeGreaterThan(w[0]!);
    const mean = w.reduce((s, v, i) => s + v * SAMPLES[i]!, 0);
    expect(mean).toBeGreaterThan(0.1);
  });
});
