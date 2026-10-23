/**
 * Scale math for the range bar: a log scale from ¼× to 4× a typical lake,
 * with "typical" (1×) in the middle. Values outside are clamped to the ends
 * and flagged so the bar can draw an arrow.
 */

export const RANGE_MIN = 0.25;
export const RANGE_MAX = 4;

/** Position 0–1 of an index multiple on the log scale (clamped). */
export function scalePos(x: number, min = RANGE_MIN, max = RANGE_MAX): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const p = (Math.log(x) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.min(1, Math.max(0, p));
}

export interface RangeGeometry {
  /** 0–1 positions of p10, median and p90. */
  lo: number;
  mid: number;
  hi: number;
  /** Where 1× (a typical lake) sits. */
  typical: number;
  /** The range runs past the left / right end of the bar. */
  clipLow: boolean;
  clipHigh: boolean;
}

export function rangeGeometry(r: { p10: number; med: number; p90: number }, min = RANGE_MIN, max = RANGE_MAX): RangeGeometry {
  // Guard against a range that arrives out of order.
  const [a, b, c] = [r.p10, r.med, r.p90].sort((x, y) => x - y) as [number, number, number];
  return {
    lo: scalePos(a, min, max),
    mid: scalePos(b, min, max),
    hi: scalePos(c, min, max),
    typical: scalePos(1, min, max),
    clipLow: a < min,
    clipHigh: c > max,
  };
}

/** "0.25", "0.9", "1.7", "12" — short, friendly multiples. */
export function fmtTimes(x: number): string {
  if (!Number.isFinite(x)) return '?';
  if (x >= 10) return String(Math.round(x));
  if (x >= 1) return String(Math.round(x * 10) / 10);
  return String(Number(x.toPrecision(2)));
}

/** Screen-reader label: "Expected 0.9 to 3.1 times a typical lake, middle guess 1.7". */
export function rangeLabel(r: { p10: number; med: number; p90: number }): string {
  return `Expected ${fmtTimes(r.p10)} to ${fmtTimes(r.p90)} times a typical lake, middle guess ${fmtTimes(r.med)}`;
}
