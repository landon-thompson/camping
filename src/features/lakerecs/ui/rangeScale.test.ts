import { describe, expect, it } from 'vitest';
import { fmtTimes, rangeGeometry, rangeLabel, scalePos } from './rangeScale';

describe('range bar scale', () => {
  it('puts typical in the middle and the ends at ¼× and 4×', () => {
    expect(scalePos(1)).toBeCloseTo(0.5);
    expect(scalePos(0.25)).toBeCloseTo(0);
    expect(scalePos(4)).toBeCloseTo(1);
    expect(scalePos(2)).toBeCloseTo(0.75);
    expect(scalePos(0.5)).toBeCloseTo(0.25);
  });

  it('clamps outside values and bad input', () => {
    expect(scalePos(10)).toBe(1);
    expect(scalePos(0.01)).toBe(0);
    expect(scalePos(0)).toBe(0);
    expect(scalePos(-1)).toBe(0);
    expect(scalePos(Number.NaN)).toBe(0);
  });

  it('flags ranges that run off either end', () => {
    const g = rangeGeometry({ p10: 0.1, med: 1, p90: 6 });
    expect(g.clipLow).toBe(true);
    expect(g.clipHigh).toBe(true);
    expect(g.lo).toBe(0);
    expect(g.hi).toBe(1);
    expect(g.typical).toBeCloseTo(0.5);
    const inside = rangeGeometry({ p10: 0.9, med: 1.7, p90: 3.1 });
    expect(inside.clipLow || inside.clipHigh).toBe(false);
    expect(inside.lo).toBeLessThan(inside.mid);
    expect(inside.mid).toBeLessThan(inside.hi);
  });

  it('sorts a range that arrives out of order', () => {
    const g = rangeGeometry({ p10: 3, med: 1, p90: 0.5 });
    expect(g.lo).toBeLessThanOrEqual(g.mid);
    expect(g.mid).toBeLessThanOrEqual(g.hi);
  });

  it('formats multiples and the accessible label', () => {
    expect(fmtTimes(0.25)).toBe('0.25');
    expect(fmtTimes(0.9)).toBe('0.9');
    expect(fmtTimes(1.74)).toBe('1.7');
    expect(fmtTimes(3.06)).toBe('3.1');
    expect(fmtTimes(12.4)).toBe('12');
    expect(rangeLabel({ p10: 0.9, med: 1.7, p90: 3.1 })).toBe('Expected 0.9 to 3.1 times a typical lake, middle guess 1.7');
  });
});
