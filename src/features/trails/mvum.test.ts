import { describe, expect, it } from 'vitest';
import { MVUM_LAYER_IDS, MVUM_SERVICE_URL, mvumRasterSource, mvumTileUrlTemplate } from './mvum';

describe('mvumTileUrlTemplate', () => {
  it('points at the EDW MVUM export endpoint with the bbox-epsg-3857 token', () => {
    const url = mvumTileUrlTemplate();
    expect(url.startsWith(`${MVUM_SERVICE_URL}/export?`)).toBe(true);
    expect(url).toContain('{bbox-epsg-3857}');
    expect(url).toContain('f=image');
    expect(url).toContain(`layers=show:${MVUM_LAYER_IDS.roads},${MVUM_LAYER_IDS.trails}`);
  });

  it('accepts a custom layer subset', () => {
    const url = mvumTileUrlTemplate([MVUM_LAYER_IDS.trails]);
    expect(url).toContain(`layers=show:${MVUM_LAYER_IDS.trails}`);
  });
});

describe('mvumRasterSource', () => {
  it('builds a raster source spec with an attribution string', () => {
    const spec = mvumRasterSource();
    expect(spec.type).toBe('raster');
    expect(spec.tiles).toHaveLength(1);
    expect(spec.tiles[0]).toContain('{bbox-epsg-3857}');
    expect(spec.attribution.length).toBeGreaterThan(0);
  });
});
