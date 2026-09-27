import { describe, expect, it } from 'vitest';
import { fetchParksFromService, parkId, parseParks, parseParksDetailed, planImport, toLonLat } from './stateParks';
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
    { type: 'Feature', properties: { AREA_NAME: 'Bad Projection State Park' }, geometry: { type: 'Polygon', coordinates: square(50000000, 50000000) } },
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
    const r = await fetchParksFromService(fake);
    expect(r.parks).toHaveLength(3);
    expect(r.layerName).toBe('DNR State Parks');
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

describe('real-world data shapes', () => {
  it('converts UTM zone 15N and Web Mercator to lon/lat', () => {
    // Minneapolis-ish: UTM 15N (478000, 4980000) ≈ (-93.28, 44.98)
    const [lng, lat] = toLonLat(478000, 4980000);
    expect(lng).toBeCloseTo(-93.28, 1);
    expect(lat).toBeCloseTo(44.98, 1);
    const [lng2, lat2] = toLonLat(-10383845, 5618718); // ≈ (-93.28, 45.0)
    expect(lng2).toBeCloseTo(-93.28, 1);
    expect(lat2).toBeCloseTo(45.0, 0);
  });

  it('reads plain park names from a parks-only layer and uses a type field when present', () => {
    const utmSquare = (e: number, n: number) => [[[e, n], [e + 3000, n], [e + 3000, n + 3000], [e, n + 3000]]];
    const data = {
      features: [
        { properties: { PARK_NAME: 'Afton', UNIT_TYPE: 'State Park' }, geometry: { type: 'Polygon', coordinates: utmSquare(520000, 4965000) } },
        { properties: { PARK_NAME: 'Cuyuna Country', UNIT_TYPE: 'State Recreation Area' }, geometry: { type: 'Polygon', coordinates: utmSquare(422000, 5147000) } },
        { properties: { PARK_NAME: 'Lake Bronson', UNIT_TYPE: 'State Wayside' }, geometry: { type: 'Polygon', coordinates: utmSquare(300000, 5400000) } },
        { properties: { NAME: 'Itasca' }, geometry: { type: 'Polygon', coordinates: utmSquare(340000, 5230000) } },
      ],
    };
    // Plain file: only rows whose fields say park / recreation area.
    expect(parseParks(data).map((p) => p.name)).toEqual(['Afton State Park', 'Cuyuna Country State Recreation Area']);
    // Known parks layer: plain names accepted too; waysides still skipped.
    const r = parseParksDetailed(data, true);
    expect(r.parks.map((p) => p.name)).toEqual(['Afton State Park', 'Cuyuna Country State Recreation Area', 'Itasca State Park']);
    expect(r.featureCount).toBe(4);
    expect(r.sampleFields).toEqual(['PARK_NAME', 'UNIT_TYPE']);
  });
});
