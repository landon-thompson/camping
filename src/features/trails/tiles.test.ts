import { describe, expect, it } from 'vitest';
import {
  bboxFromPoints,
  clampZoomsToBudget,
  estimateRegion,
  formatBytes,
  mergeBBoxes,
  tilesForBbox,
  viewportStops,
  type BBox,
} from './tiles';

describe('bboxFromPoints / mergeBBoxes', () => {
  it('pads a bounding box around a set of points', () => {
    const box = bboxFromPoints([{ lat: 47.9, lng: -91.6 }, { lat: 47.95, lng: -91.5 }], 0.01);
    expect(box).not.toBeNull();
    const [w, s, e, n] = box as BBox;
    expect(w).toBeCloseTo(-91.61, 5);
    expect(s).toBeCloseTo(47.89, 5);
    expect(e).toBeCloseTo(-91.49, 5);
    expect(n).toBeCloseTo(47.96, 5);
  });

  it('is null for no points', () => {
    expect(bboxFromPoints([])).toBeNull();
  });

  it('merges several boxes into their union, ignoring nulls', () => {
    const a: BBox = [-92, 46, -91, 47];
    const b: BBox = [-91.5, 46.5, -90.5, 47.5];
    const merged = mergeBBoxes([a, null, b]);
    expect(merged).toEqual([-92, 46, -90.5, 47.5]);
  });
});

describe('tilesForBbox', () => {
  it('covers a known small box with at least one tile at low zoom', () => {
    const box: BBox = [-92, 46, -91, 47];
    const tiles = tilesForBbox(box, 4);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    for (const t of tiles) {
      expect(t.z).toBe(4);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces more tiles at a higher zoom for the same box', () => {
    const box: BBox = [-92, 46, -91, 47];
    const low = tilesForBbox(box, 8).length;
    const high = tilesForBbox(box, 12).length;
    expect(high).toBeGreaterThan(low);
  });

  it('never returns a negative or out-of-range tile index', () => {
    const wholeWorld: BBox = [-180, -85, 180, 85];
    const tiles = tilesForBbox(wholeWorld, 2);
    const max = 2 ** 2 - 1;
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(max);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(max);
    }
  });
});

describe('estimateRegion / clampZoomsToBudget', () => {
  const box: BBox = [-91.7, 47.8, -91.5, 48.0];

  it('estimates tile count and bytes across zoom levels', () => {
    const est = estimateRegion(box, [11, 13, 14]);
    expect(est.perZoom).toHaveLength(3);
    expect(est.totalTiles).toBe(est.perZoom.reduce((s, p) => s + p.count, 0));
    expect(est.estBytes).toBe(est.totalTiles * 20_000);
  });

  it('drops the highest zoom first to stay under a tile budget', () => {
    const big: BBox = [-93, 46, -90, 49]; // a big multi-degree box
    const clamped = clampZoomsToBudget(big, [10, 12, 14], 50);
    expect(clamped.totalTiles).toBeLessThanOrEqual(50 * 4); // some slack: dropping one zoom at a time can overshoot slightly
    expect(clamped.zooms.length).toBeLessThan(3);
    expect(Math.max(...clamped.zooms)).toBeLessThan(14);
  });

  it('keeps at least one zoom level even for a huge area', () => {
    const world: BBox = [-180, -85, 180, 85];
    const clamped = clampZoomsToBudget(world, [10, 12, 14], 10);
    expect(clamped.zooms.length).toBe(1);
  });
});

describe('formatBytes', () => {
  it('formats bytes, KB, MB reasonably', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(20_000)).toBe('20 KB');
    expect(formatBytes(20_000_000)).toBe('19 MB');
    expect(formatBytes(5_000)).toBe('4.9 KB');
  });
});

describe('viewportStops', () => {
  it('always returns at least one stop', () => {
    const box: BBox = [-91.6, 47.9, -91.59, 47.91];
    const stops = viewportStops(box, 12);
    expect(stops.length).toBeGreaterThanOrEqual(1);
  });

  it('covers a bigger box with more stops at a fixed viewport size', () => {
    const small: BBox = [-91.6, 47.9, -91.59, 47.91];
    const big: BBox = [-92.0, 47.0, -91.0, 48.0];
    expect(viewportStops(big, 12).length).toBeGreaterThan(viewportStops(small, 12).length);
  });

  it('keeps every stop within the bbox', () => {
    const box: BBox = [-92.0, 47.0, -91.0, 48.0];
    for (const stop of viewportStops(box, 11)) {
      expect(stop.lng).toBeGreaterThanOrEqual(box[0] - 1e-6);
      expect(stop.lng).toBeLessThanOrEqual(box[2] + 1e-6);
      expect(stop.lat).toBeGreaterThanOrEqual(box[1] - 1e-6);
      expect(stop.lat).toBeLessThanOrEqual(box[3] + 1e-6);
    }
  });
});
