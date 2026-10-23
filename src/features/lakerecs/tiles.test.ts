import { describe, expect, it } from 'vitest';
import { decodeSamples, encodeSamples } from './decode';
import { FIXTURE_ORIGIN, FIXTURE_RAW, fixtureManifest, fixtureTiles } from './fixtures/load';
import { tilesFor } from './tiles';
import type { ModelManifest } from './types';

const grid = (ids: [south: number, west: number][]): ModelManifest => ({
  ...fixtureManifest(),
  tiles: ids.map(([s, w]) => ({ id: `t_${s}_${w}`, bbox: [w, s, w + 1, s + 0.5], url: `tiles/t_${s}_${w}.json`, bytes: 1, sha256: '', lakes: 0 })),
});

describe('tilesFor', () => {
  // 3 × 3 block of tiles around Ely (47.9, −91.87): lat 47–48.5, lng −93…−90.
  const m = grid([47, 47.5, 48].flatMap((s) => [-93, -92, -91].map((w) => [s, w] as [number, number])));

  it('a 25-mile circle near a tile corner touches its neighbours only', () => {
    // 40.2 km ≈ 0.36° lat and ≈ 0.54° lng here: reaches west (−92) and north (48) but not south (47.5) or east (−91).
    expect(tilesFor(FIXTURE_ORIGIN, 40.2, m).sort()).toEqual(['t_47.5_-92', 't_47.5_-93', 't_48_-92', 't_48_-93'].sort());
  });

  it('a small circle stays in its own tile', () => {
    expect(tilesFor({ lat: 47.75, lng: -91.5 }, 5, m)).toEqual(['t_47.5_-92']);
  });

  it('a big circle reaches further', () => {
    expect(tilesFor({ lat: 47.75, lng: -91.5 }, 60, m)).toHaveLength(9);
  });

  it('includes the tile containing the origin even at radius 0', () => {
    expect(tilesFor({ lat: 47.6, lng: -92.5 }, 0, m)).toEqual(['t_47.5_-93']);
  });

  it('copes with no manifest or a bad origin', () => {
    expect(tilesFor(FIXTURE_ORIGIN, 40, null)).toEqual([]);
    expect(tilesFor({ lat: Number.NaN, lng: 0 }, 40, m)).toEqual([]);
  });
});

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('fixtures', () => {
  it('manifest bytes and sha256 match the tile files', async () => {
    const m = fixtureManifest();
    for (const ref of m.tiles) {
      const raw = FIXTURE_RAW[ref.url];
      if (!raw) {
        expect(ref.id).toBe('t_48_-92'); // listed on purpose but not provided
        continue;
      }
      expect(new TextEncoder().encode(raw).length).toBe(ref.bytes);
      expect(await sha256Hex(raw)).toBe(ref.sha256);
    }
  });

  it('are synthetic: Fixture Lake names and 99xxxxxx keys only', () => {
    for (const t of fixtureTiles()) {
      for (const l of t.lakes) {
        expect(l.name).toMatch(/^Fixture Lake /);
        expect(l.key).toMatch(/^mn:99\d{6}$/);
      }
    }
  });

  it('generator encoding agrees with decode.ts (encode ∘ decode is the identity on q)', () => {
    for (const t of fixtureTiles()) {
      for (const l of t.lakes) {
        for (const [code, est] of Object.entries(l.sp)) {
          const scale = t.scale[code]!;
          const s = decodeSamples(est.q, scale);
          expect(s).toHaveLength(200);
          for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThanOrEqual(s[i - 1]!);
          expect(encodeSamples(s, scale)).toBe(est.q);
          // The middle sample sits near the published median.
          expect(Math.abs((s[99]! + s[100]!) / 2 - est.med)).toBeLessThan((scale.hi - scale.lo) / 255 + 0.01);
        }
      }
    }
  });
});
