import { describe, expect, it } from 'vitest';
import {
  estimateDriveTimeMin,
  haversineMiles,
  lineDistanceMi,
  multiLineDistanceMi,
  simplifyDouglasPeucker,
  simplifyMultiToByteBudget,
  simplifyToByteBudget,
} from './geo';

describe('haversineMiles', () => {
  it('is zero for the same point', () => {
    expect(haversineMiles([-93.2, 46.4], [-93.2, 46.4])).toBe(0);
  });

  it('matches a known distance (Duluth to Grand Marais, MN, ~picnic-table accuracy)', () => {
    // Duluth ~ -92.1005, 46.7867; Grand Marais ~ -90.3341, 47.7503
    const mi = haversineMiles([-92.1005, 46.7867], [-90.3341, 47.7503]);
    expect(mi).toBeGreaterThan(100);
    expect(mi).toBeLessThan(120);
  });
});

describe('lineDistanceMi / multiLineDistanceMi', () => {
  it('sums consecutive segments', () => {
    const a: [number, number] = [-93.0, 46.0];
    const b: [number, number] = [-93.0, 46.1];
    const c: [number, number] = [-93.0, 46.2];
    const total = lineDistanceMi([a, b, c]);
    expect(total).toBeCloseTo(haversineMiles(a, b) + haversineMiles(b, c), 6);
  });

  it('handles a single point or empty line as zero', () => {
    expect(lineDistanceMi([[-93, 46]])).toBe(0);
    expect(lineDistanceMi([])).toBe(0);
  });

  it('sums every part of a MultiLineString', () => {
    const partA: [number, number][] = [
      [-93.0, 46.0],
      [-93.0, 46.05],
    ];
    const partB: [number, number][] = [
      [-92.0, 46.0],
      [-92.0, 46.05],
    ];
    const total = multiLineDistanceMi([partA, partB]);
    expect(total).toBeCloseTo(lineDistanceMi(partA) + lineDistanceMi(partB), 6);
  });
});

describe('estimateDriveTimeMin', () => {
  it('divides distance by speed, in minutes', () => {
    expect(estimateDriveTimeMin(15, 15)).toBe(60);
    expect(estimateDriveTimeMin(3.75, 15)).toBe(15);
  });

  it('is null for non-positive speed or distance', () => {
    expect(estimateDriveTimeMin(10, 0)).toBeNull();
    expect(estimateDriveTimeMin(-1, 15)).toBeNull();
  });
});

describe('simplifyDouglasPeucker', () => {
  it('keeps a nearly-straight line down to its endpoints', () => {
    const points: number[][] = [];
    for (let i = 0; i <= 20; i++) {
      // tiny wiggle well under a 1-mile tolerance
      points.push([-93.0 + i * 0.001, 46.0 + (i % 2 === 0 ? 0 : 0.00001)]);
    }
    const out = simplifyDouglasPeucker(points, 1);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
  });

  it('keeps a real corner when the tolerance is small', () => {
    const points: number[][] = [
      [-93.0, 46.0],
      [-93.0, 46.5], // sharp turn here
      [-92.0, 46.5],
    ];
    const out = simplifyDouglasPeucker(points, 0.01);
    expect(out).toEqual(points);
  });

  it('passes short lines through unchanged', () => {
    const points: number[][] = [
      [-93.0, 46.0],
      [-93.0, 46.1],
    ];
    expect(simplifyDouglasPeucker(points, 5)).toEqual(points);
  });

  it('never grows the point count', () => {
    const points: number[][] = Array.from({ length: 50 }, (_, i) => [-93 + i * 0.0007, 46 + Math.sin(i / 3) * 0.0005]);
    const out = simplifyDouglasPeucker(points, 0.02);
    expect(out.length).toBeLessThanOrEqual(points.length);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});

describe('simplifyToByteBudget', () => {
  it('shrinks a long noisy track under the byte budget', () => {
    const points: number[][] = Array.from({ length: 3000 }, (_, i) => [
      -91.5 + i * 0.0003,
      47.8 + Math.sin(i / 17) * 0.01,
    ]);
    const before = JSON.stringify(points).length;
    const out = simplifyToByteBudget(points, 4000);
    expect(before).toBeGreaterThan(4000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(4000);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
  });

  it('leaves a line alone if it already fits', () => {
    const points: number[][] = [
      [-93, 46],
      [-93.01, 46.01],
      [-93.02, 46.02],
    ];
    expect(simplifyToByteBudget(points, 100_000)).toEqual(points);
  });
});

describe('simplifyMultiToByteBudget', () => {
  it('shrinks every part under a combined byte budget', () => {
    const part = (offset: number): number[][] =>
      Array.from({ length: 1200 }, (_, i) => [-92 + offset + i * 0.0004, 47 + Math.cos(i / 11) * 0.01]);
    const parts = [part(0), part(1)];
    const out = simplifyMultiToByteBudget(parts, 5000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(5000);
    expect(out.length).toBe(2);
    for (const p of out) expect(p.length).toBeGreaterThanOrEqual(2);
  });
});
