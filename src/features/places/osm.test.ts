import { describe, expect, it } from 'vitest';
import { fetchOsmWaters, overpassQuery, parseOverpass } from './osm';

const at = { lat: 44.53, lng: -97.08 };
const data = {
  elements: [
    { type: 'way', id: 1, tags: { natural: 'water', water: 'lake', name: 'Lake Poinsett' }, center: { lat: 44.55, lon: -97.08 }, bounds: { minlat: 44.5, minlon: -97.13, maxlat: 44.6, maxlon: -97.03 } },
    { type: 'way', id: 2, tags: { natural: 'water', water: 'river', name: 'Big Sioux River' }, center: { lat: 44.5, lon: -97.0 } },
    { type: 'node', id: 3, lat: 44.598, lon: -97.08, tags: { leisure: 'slipway', surface: 'concrete' } },
    { type: 'way', id: 4, center: { lat: 44.52, lon: -97.09 }, tags: { leisure: 'slipway', name: 'Poinsett SRA ramp', operator: 'SD GFP' } },
    { type: 'node', id: 5, lat: 44.4, lon: -97.3, tags: { leisure: 'slipway' } },
  ],
};

describe('OpenStreetMap ramps and lakes', () => {
  it('keeps named lakes (not rivers) and puts each ramp on the lake it touches', () => {
    const r = parseOverpass(data, at, 40.2);
    expect(r.waters.map((w) => [w.name, w.distanceKm])).toEqual([['Lake Poinsett', 0]]);
    expect(r.launches.map((l) => [l.name, l.water, l.manager, l.ramp])).toEqual([
      ['Poinsett SRA ramp', 'Lake Poinsett', 'SD GFP', ''],
      ['Lake Poinsett boat ramp', 'Lake Poinsett', '', 'concrete'],
      ['Boat ramp', '', '', ''],
    ]);
    expect(r.launches.every((l) => l.dow === null)).toBe(true);
  });

  it('builds one bounded query and reports what came back', async () => {
    expect(overpassQuery(at, 40.2)).toMatch(/^\[out:json\]\[timeout:25\];\(node\["leisure"="slipway"\]\(44\.\d+,-97\.\d+,44\.\d+,-96\.\d+\)/);
    const r = await fetchOsmWaters(at, 40.2, (async () => Response.json(data)) as typeof fetch);
    expect(r.report).toBe('OpenStreetMap (community map data): 3 ramps, 1 named lakes within 25 mi');
    const down = await fetchOsmWaters(at, 40.2, (async () => new Response('busy', { status: 429 })) as typeof fetch);
    expect(down.report).toMatch(/HTTP 429$/);
  });
});
