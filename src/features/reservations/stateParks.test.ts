import { describe, expect, it } from 'vitest';
import { fetchParksFromService, parkId, parseParks, planImport } from './stateParks';
import type { Campground } from '../../model/schemas';
import { isGenericBookingUrl } from './shared';

const square = (lng: number, lat: number) => [
  [
    [lng, lat],
    [lng + 0.1, lat],
    [lng + 0.1, lat + 0.1],
    [lng, lat + 0.1],
  ],
];

const fc = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { AREA_NAME: 'Afton State Park' }, geometry: { type: 'Polygon', coordinates: square(-92.8, 44.85) } },
    { type: 'Feature', properties: { AREA_NAME: 'Afton State Park' }, geometry: { type: 'Polygon', coordinates: square(-92.8, 44.85) } },
    { type: 'Feature', properties: { AREA_NAME: 'Lake Vermilion-Soudan Underground Mine State Park' }, geometry: { type: 'MultiPolygon', coordinates: [square(-92.2, 47.8)] } },
    { type: 'Feature', properties: { AREA_NAME: 'Cuyuna Country SRA' }, geometry: { type: 'Polygon', coordinates: square(-93.98, 46.47) } },
    { type: 'Feature', properties: { AREA_NAME: 'Some State Wayside' }, geometry: { type: 'Polygon', coordinates: square(-92, 47) } },
    { type: 'Feature', properties: { AREA_NAME: 'Bad Projection State Park' }, geometry: { type: 'Polygon', coordinates: square(500000, 5000000) } },
  ],
};

const cg = (name: string, location: Campground['location']): Campground => ({
  name,
  agency: 'mn-state-park',
  bookingSystem: 'reservemn',
  unit: name,
  location,
  bookingUrl: '',
  ridbFacilityId: null,
  windowDaysOverride: null,
  electric: true,
  boatLaunch: true,
  rules: [],
  verify: '',
  source: '',
  notes: '',
});

describe('state park import', () => {
  it('keeps parks and recreation areas with a Minnesota pin, dropping waysides, duplicates and bad coordinates', () => {
    const parks = parseParks(fc);
    expect(parks.map((p) => p.name)).toEqual([
      'Afton State Park',
      'Cuyuna Country State Recreation Area',
      'Lake Vermilion-Soudan Underground Mine State Park',
    ]);
    expect(parks[0]).toMatchObject({ lat: expect.closeTo(44.9, 1), lng: expect.closeTo(-92.75, 1) });
  });

  it('adds new parks and fills missing locations on existing ones without overwriting', () => {
    const parks = parseParks(fc);
    const plan = planImport(
      parks,
      [
        { id: 'campground:afton', data: cg('Afton State Park', null) },
        { id: 'campground:cuyuna', data: cg('Cuyuna Country State Recreation Area', { lat: 46.5, lng: -94 }) },
      ],
      'test',
    );
    expect(plan.fill.map((f) => f.id)).toEqual(['campground:afton']);
    expect(plan.fill[0]?.data.electric).toBe(true); // other fields kept
    expect(plan.add.map((a) => a.id)).toEqual([parkId('Lake Vermilion-Soudan Underground Mine State Park')]);
    expect(plan.add[0]?.data.verify).toMatch(/middle/);
  });

  it('rejects non-GeoJSON input', () => {
    expect(() => parseParks({ hello: 1 })).toThrow(/GeoJSON/);
  });

  it('finds the state-park layer in the service', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const body = url.includes('/layers') ? { layers: [{ id: 3, name: 'Trails' }, { id: 5, name: 'DNR State Parks' }] } : fc;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const parks = await fetchParksFromService(fake);
    expect(parks).toHaveLength(3);
    expect(calls[1]).toContain('/5/query?');
  });
});

describe('generic booking links', () => {
  it('spots agency front pages vs a campground’s own page', () => {
    expect(isGenericBookingUrl('https://www.mndnr.gov/reservations')).toBe(true);
    expect(isGenericBookingUrl('https://reservemn.usedirect.com/MinnesotaWeb/')).toBe(true);
    expect(isGenericBookingUrl('https://www.recreation.gov/')).toBe(true);
    expect(isGenericBookingUrl('https://www.recreation.gov/camping/campgrounds/233144')).toBe(false);
    expect(isGenericBookingUrl('https://reservemn.usedirect.com/MinnesotaWeb/Facilities/SearchViewUnitAvailabity.aspx')).toBe(false);
    expect(isGenericBookingUrl('not a url')).toBe(true);
  });
});
