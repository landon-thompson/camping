import { describe, expect, it } from 'vitest';
import { defaultLakes, lakeRows, lakesFrom } from './lakeList';

const launch = (over: object) => ({ name: 'A', water: 'Bear Head', dow: null, ramp: '', manager: '', lat: 47.8, lng: -92.08, distanceKm: 1, ...over });

describe('lakes near the launch', () => {
  it('adds lakes from launches and places lakes at their launches', () => {
    const lakes = lakesFrom([{ dow: '69028500', name: 'Eagles Nest #4', county: '' }], [launch({ dow: '69025400' }), launch({ dow: '69028500', lat: 47.83, lng: -92.1 })]);
    expect(lakes.map((l) => l.dow)).toEqual(['69028500', '69025400']);
    expect(lakes[0]).toMatchObject({ lat: 47.83, lng: -92.1 });
    expect(defaultLakes(lakes, [launch({}), launch({ dow: '69025400' })])).toEqual(['69025400']);
    expect(defaultLakes(lakes, [])).toEqual(['69028500']);
  });

  it('sorts by distance from the launch, keeps unknown positions last, drops lakes beyond the radius', () => {
    const origin = { lat: 47.8, lng: -92.08 };
    const lakes = [
      { dow: '11111100', name: 'Far', county: '', lat: 48.5, lng: -92.08 }, // ~78 km
      { dow: '22222200', name: 'Unknown spot', county: '' },
      { dow: '33333300', name: 'Near', county: '', lat: 47.85, lng: -92.08 }, // ~5.6 km
      { dow: '44444400', name: 'Launch lake', county: '' },
    ];
    const rows = lakeRows(lakes, [launch({ dow: '44444400', lat: 47.81, lng: -92.08 }), launch({ dow: '44444400', lat: 47.9, lng: -92.08 })], origin, 40.2);
    expect(rows.map((r) => r.lake.name)).toEqual(['Launch lake', 'Near', 'Unknown spot']);
    expect(rows[0]!.launches).toHaveLength(2);
    expect(rows[0]!.distanceKm).toBeCloseTo(1.1, 1);
  });
});

describe('South Dakota waters', () => {
  it('lists named lakes with the ramps on them, nearest first', async () => {
    const { sdWaterRows, inSouthDakota } = await import('./lakeList');
    const origin = { lat: 44.53, lng: -97.08 }; // Lake Poinsett
    const waters = [
      { name: 'Lake Poinsett', lat: 44.55, lng: -97.08, bounds: [44.5, -97.13, 44.6, -97.03] as [number, number, number, number], distanceKm: 0 },
      { name: 'Lake Albert', lat: 44.58, lng: -97.2, bounds: null, distanceKm: 0 },
      { name: 'Far Lake', lat: 45.2, lng: -97.08, bounds: null, distanceKm: 0 },
    ];
    const rows = sdWaterRows(waters, [launch({ water: 'Lake Poinsett', name: 'North Ramp', lat: 44.59, lng: -97.08 }), launch({ water: 'Lake Poinsett', name: 'South Ramp', lat: 44.52, lng: -97.09 })], origin, 40.2);
    expect(rows.map((r) => [r.water, r.distanceKm, r.launches.map((l) => l.name)])).toEqual([
      ['Lake Poinsett', 0, ['South Ramp', 'North Ramp']],
      ['Lake Albert', 11, []],
    ]);
    expect(inSouthDakota(origin)).toBe(true);
    expect(inSouthDakota({ lat: 47.8, lng: -92.1 })).toBe(false);
  });

  it('ignores an empty or far-away trip launch', async () => {
    const { usableLaunch } = await import('./lakeList');
    const near = { lat: 44.53, lng: -97.08 };
    expect(usableLaunch({ lat: 0, lng: 0, name: '' }, near)).toBeNull();
    expect(usableLaunch({ lat: 47.8, lng: -92.1, name: 'Bear Head' }, near)).toBeNull();
    expect(usableLaunch({ lat: 44.55, lng: -97.08, name: 'Ramp' }, near)?.name).toBe('Ramp');
  });
});
