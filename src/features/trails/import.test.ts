import { describe, expect, it } from 'vitest';
import { featureCollectionToDrafts, MAX_ROUTE_RECORD_BYTES, type MinimalFeatureCollection } from './import';

// These fixtures are shaped exactly like what `@tmcw/togeojson`'s `gpx()`/`kml()`
// produce for small real GPX/KML files (a track with a name, and a waypoint).
// We can't parse actual XML in this Node test env (no DOMParser/jsdom — see
// gpxKml.ts), so we exercise the pure conversion logic directly against the
// GeoJSON shape a real GPX/KML import would yield.

const smallGpxTrack: MinimalFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Forest Rd 170 to campsite', _gpxType: 'trk' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-91.6, 47.9, 500],
          [-91.61, 47.905, 505],
          [-91.62, 47.91, 510],
          [-91.63, 47.915, 512],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Boat launch' },
      geometry: { type: 'Point', coordinates: [-91.598, 47.902] },
    },
  ],
};

describe('featureCollectionToDrafts', () => {
  it('turns a track into a route draft and a waypoint into a pin draft', () => {
    const result = featureCollectionToDrafts(smallGpxTrack, { avgMph: 15 });
    expect(result.issues).toEqual([]);
    expect(result.routes).toHaveLength(1);
    expect(result.pins).toHaveLength(1);

    const route = result.routes[0]!;
    expect(route.name).toBe('Forest Rd 170 to campsite');
    expect(route.geometry.type).toBe('LineString');
    expect(route.distanceMi).toBeGreaterThan(0);
    expect(route.estDriveMin).toBe(Math.round((route.distanceMi / 15) * 60));

    const pin = result.pins[0]!;
    expect(pin.name).toBe('Boat launch');
    expect(pin.position).toEqual({ lat: 47.902, lng: -91.598 });
  });

  it('falls back to a numbered name when a feature has none', () => {
    const fc: MinimalFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-93, 46],
              [-93.01, 46.01],
            ],
          },
        },
      ],
    };
    const result = featureCollectionToDrafts(fc);
    expect(result.routes[0]!.name).toBe('Imported route 1');
  });

  it('reports an issue and returns nothing for an empty file', () => {
    const result = featureCollectionToDrafts({ type: 'FeatureCollection', features: [] });
    expect(result.routes).toEqual([]);
    expect(result.pins).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });

  it('skips a too-short line with an issue instead of throwing', () => {
    const fc: MinimalFeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'stub' }, geometry: { type: 'LineString', coordinates: [[-93, 46]] } }],
    };
    const result = featureCollectionToDrafts(fc);
    expect(result.routes).toEqual([]);
    expect(result.issues[0]?.message).toContain('stub');
  });

  it('skips unsupported geometry types with an issue', () => {
    const fc: MinimalFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Dispersed area' },
          geometry: { type: 'Polygon', coordinates: [[[-93, 46], [-93, 46.1], [-92.9, 46.1], [-93, 46]]] },
        },
      ],
    };
    const result = featureCollectionToDrafts(fc);
    expect(result.routes).toEqual([]);
    expect(result.pins).toEqual([]);
    expect(result.issues[0]?.message).toMatch(/unsupported geometry/i);
  });

  it('keeps every route record under the byte budget for a large noisy track', () => {
    const coordinates = Array.from({ length: 4000 }, (_, i) => [-91.5 + i * 0.0002, 47.8 + Math.sin(i / 13) * 0.02, 480 + (i % 20)]);
    const fc: MinimalFeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Long MVUM loop' }, geometry: { type: 'LineString', coordinates } }],
    };
    const result = featureCollectionToDrafts(fc, { maxRouteBytes: 4000 });
    const route = result.routes[0]!;
    expect(JSON.stringify(route.geometry).length).toBeLessThanOrEqual(4000);
    expect(route.originalPoints).toBe(4000);
    expect(route.keptPoints).toBeLessThan(4000);
    expect(MAX_ROUTE_RECORD_BYTES).toBeGreaterThan(4000); // sanity: real default budget is much larger
  });

  it('handles a MultiLineString route (e.g. a route split by a gap)', () => {
    const fc: MinimalFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Split trail' },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [-93.0, 46.0],
                [-93.01, 46.01],
              ],
              [
                [-92.9, 46.2],
                [-92.91, 46.21],
                [-92.92, 46.22],
              ],
            ],
          },
        },
      ],
    };
    const result = featureCollectionToDrafts(fc);
    expect(result.routes).toHaveLength(1);
    const route = result.routes[0]!;
    expect(route.geometry.type).toBe('MultiLineString');
    expect(route.distanceMi).toBeGreaterThan(0);
  });

  it('drops points with non-finite coordinates rather than throwing', () => {
    const fc: MinimalFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Bad point' },
          geometry: { type: 'Point', coordinates: [Number.NaN, 46] },
        },
      ],
    };
    const result = featureCollectionToDrafts(fc);
    expect(result.pins).toEqual([]);
    expect(result.issues[0]?.message).toMatch(/invalid coordinates/);
  });
});
