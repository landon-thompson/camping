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
