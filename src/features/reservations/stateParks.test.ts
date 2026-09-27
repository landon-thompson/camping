import { describe, expect, it } from 'vitest';
import { fetchParksFromService, parkId, parseParks, parseParksDetailed, planImport, toLonLat } from './stateParks';
import type { Campground } from '../../model/schemas';
import { bookingLink, isGenericBookingUrl } from './shared';

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
      if (url.includes('arcgis.dnr.state.mn.us')) return new Response('nope', { status: 500 });
      if (url.includes('/sharing/rest/content/items/')) return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
      const body = url.includes('/layers') ? { layers: [{ id: 3, name: 'Trails' }, { id: 5, name: 'DNR State Parks' }] } : fc;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const r = await fetchParksFromService(fake);
    expect(r.parks).toHaveLength(3);
    expect(r.layerName).toBe('DNR State Parks');
    expect(r.source).toContain('metc'); // fell back from the DNR services
    expect(r.reports.map((x) => x.outcome)).toEqual([
      'item has no service address',
      'item has no service address',
      'HTTP 500',
      'HTTP 500',
      expect.stringMatching(/^3 parks from 6 areas/),
      expect.stringMatching(/^0 parks/), // PAD-US fallback (the fake answers with unrelated data)
    ]);
    expect(calls.some((c) => c.includes('/5/query?'))).toBe(true);
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

describe('statewide DNR data', () => {
  it('keeps parks, drops trails/forests, and links each park to its own DNR page', () => {
    const sq = (lng: number, lat: number) => [[[lng, lat], [lng + 0.1, lat], [lng + 0.1, lat + 0.1], [lng, lat + 0.1]]];
    const data = {
      features: [
        { properties: { altd_name: 'Itasca', unit_type: 'State Park', area_id: 'SPK00181' }, geometry: { type: 'Polygon', coordinates: sq(-95.2, 47.2) } },
        { properties: { altd_name: 'Gateway', unit_type: 'State Trail' }, geometry: { type: 'Polygon', coordinates: sq(-93, 45) } },
        { properties: { altd_name: 'Paul Bunyan', unit_type: 'State Forest' }, geometry: { type: 'Polygon', coordinates: sq(-94.9, 47.1) } },
        { properties: { altd_name: 'Afton', unit_type: 'State Park', area_id: 'spk00100' }, geometry: { type: 'Polygon', coordinates: sq(-92.8, 44.85) } },
      ],
    };
    const parks = parseParksDetailed(data, true).parks;
    expect(parks.map((p) => [p.name, p.unitId])).toEqual([
      ['Afton State Park', 'spk00100'],
      ['Itasca State Park', 'spk00181'],
    ]);
    const plan = planImport(parks, [{ id: 'campground:itasca', data: cg('Itasca State Park', { lat: 47.2, lng: -95.2 }) }], 'dnr');
    // Existing Itasca had a generic link (''), so it gets its park page; Afton is new.
    expect(plan.fill[0]?.data.bookingUrl).toBe('https://www.dnr.state.mn.us/state_parks/park.html?id=spk00181#reservations');
    expect(plan.add[0]?.data.bookingUrl).toBe('https://www.dnr.state.mn.us/state_parks/park.html?id=spk00100#reservations');
  });
});

describe('Esri JSON input', () => {
  it('reads attributes + rings, and reports service errors', () => {
    const esri = {
      features: [
        { attributes: { AREA_NAME: 'Itasca', UNIT_TYPE: 'State Park', AREA_ID: 'spk00181' }, geometry: { rings: [[[-95.2, 47.2], [-95.1, 47.2], [-95.1, 47.3], [-95.2, 47.3]]] } },
      ],
    };
    expect(parseParksDetailed(esri, true).parks).toEqual([{ name: 'Itasca State Park', lat: 47.25, lng: -95.15, unitId: 'spk00181' }]);
    expect(() => parseParksDetailed({ error: { code: 499, message: 'Token Required' } })).toThrow(/499 Token Required/);
  });
});

describe('official dataset item', () => {
  it('follows the catalog item to its layer and stops once a statewide list is found', async () => {
    const many = {
      features: Array.from({ length: 45 }, (_, i) => ({
        attributes: { AREA_NAME: `Park ${i} State Park` },
        geometry: { rings: [[[-94 + i * 0.01, 46], [-93.9 + i * 0.01, 46], [-93.9 + i * 0.01, 46.1]]] },
      })),
    };
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.includes('/sharing/rest/content/items/')) {
        return new Response(JSON.stringify({ url: 'https://services1.arcgis.com/Org/arcgis/rest/services/Parks/FeatureServer/0' }));
      }
      return new Response(JSON.stringify(many));
    }) as typeof fetch;
    const r = await fetchParksFromService(fake);
    expect(r.parks).toHaveLength(45);
    expect(r.source).toContain('services1.arcgis.com');
    expect(urls).toHaveLength(2); // item lookup + one query; other sources not needed
    expect(urls[1]).toContain('/FeatureServer/0/query?');
  });
});

describe('Book now link', () => {
  it('jumps to the Reservations section of a DNR park page', () => {
    expect(bookingLink('https://www.dnr.state.mn.us/state_parks/park.html?id=spk00100')).toBe(
      'https://www.dnr.state.mn.us/state_parks/park.html?id=spk00100#reservations',
    );
    expect(bookingLink('https://www.dnr.state.mn.us/state_parks/park.html?id=spk00100#reservations')).toBe(
      'https://www.dnr.state.mn.us/state_parks/park.html?id=spk00100#reservations',
    );
    expect(bookingLink('https://www.recreation.gov/camping/campgrounds/233144')).toBe('https://www.recreation.gov/camping/campgrounds/233144');
  });
});

describe('South Dakota parks', () => {
  it('keeps SD state parks and recreation areas, SD naming, Camp SD booking, Custer’s one-year window', () => {
    const sq = (lng: number, lat: number) => ({ rings: [[[lng, lat], [lng + 0.05, lat], [lng + 0.05, lat + 0.05], [lng, lat + 0.05]]] });
    const data = {
      features: [
        { attributes: { NAME: 'CUSTER STATE PARK', TYPE: 'State Park' }, geometry: sq(-103.45, 43.72) },
        { attributes: { NAME: 'Angostura', TYPE: 'Recreation Area' }, geometry: sq(-103.43, 43.3) },
        { attributes: { NAME: 'Lake Thompson Recreation Area', TYPE: 'Recreation Area' }, geometry: sq(-97.45, 44.3) },
        { attributes: { NAME: 'Mina Lake Lakeside Use Area', TYPE: 'Lakeside Use Area' }, geometry: sq(-98.72, 45.44) },
        { attributes: { NAME: 'Itasca', TYPE: 'State Park' }, geometry: sq(-95.2, 47.2) }, // Minnesota pin: dropped
      ],
    };
    const parks = parseParksDetailed(data, true, 'sd').parks;
    expect(parks.map((p) => p.name)).toEqual(['Angostura Recreation Area', 'Custer State Park', 'Lake Thompson Recreation Area']);
    const plan = planImport(parks, [], 'sd-open-data', 'sd');
    const custer = plan.add.find((a) => a.data.name === 'Custer State Park')!;
    expect(custer.id).toBe('campground:sd-sp-custer');
    expect(custer.data).toMatchObject({ agency: 'sd-state-park', bookingSystem: 'campsd', bookingUrl: 'https://www.campsd.com' });
    expect(custer.data.windowMonthsOverride?.value).toBe(12);
    expect(plan.add.find((a) => a.data.name === 'Angostura Recreation Area')?.data.windowMonthsOverride).toBeUndefined();
    expect(isGenericBookingUrl('https://www.campsd.com/')).toBe(true);
  });
});

describe('South Dakota parks from the GFP map server', () => {
  it('finds the park boundary layer in the Parks folder and imports from it', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url === 'https://gfpgis.sd.gov/arcgis/rest/services/Parks?f=json') {
        return Response.json({ services: [{ name: 'Parks/BoatRamps', type: 'FeatureServer' }, { name: 'Parks/ParkBoundaries', type: 'MapServer' }] });
      }
      if (url.includes('Parks/ParkBoundaries/MapServer/layers')) {
        return Response.json({ layers: [{ id: 0, name: 'Campsites', geometryType: 'esriGeometryPoint' }, { id: 2, name: 'State Park Boundaries', geometryType: 'esriGeometryPolygon' }] });
      }
      if (url.includes('Parks/ParkBoundaries/MapServer/2/query')) {
        return Response.json({
          features: Array.from({ length: 45 }, (_, i) => ({
            attributes: { ParkName: `Park ${i}`, Type: i % 2 ? 'Recreation Area' : 'State Park' },
            geometry: { rings: [[[-100 + i * 0.05, 44], [-99.95 + i * 0.05, 44], [-99.95 + i * 0.05, 44.05]]] },
          })),
        });
      }
      return new Response('{"error":{"message":"Item does not exist or is inaccessible."}}', { status: 400 });
    }) as typeof fetch;
    const r = await fetchParksFromService(fake, 'sd');
    expect(r.parks).toHaveLength(45);
    expect(r.parks.some((p) => p.name === 'Park 1 Recreation Area')).toBe(true);
    expect(r.source).toBe('https://gfpgis.sd.gov/arcgis/rest/services/Parks/ParkBoundaries/MapServer/2');
    expect(urls.some((u) => u.includes('BoatRamps'))).toBe(false);
    expect(r.reports[0]?.label).toMatch(/PAD-US/); // tried first, failed in this fake
    expect(r.reports[1]?.outcome).toMatch(/^45 parks/);
  });
});

describe('PAD-US (national protected areas)', () => {
  it('queries one state’s parks and recreation areas and maps the fields', async () => {
    const { padusQueryUrl, fromPadus } = await import('./stateParks');
    const url = new URL(padusQueryUrl('sd'));
    expect(url.searchParams.get('where')).toBe("State_Nm = 'SD' AND Des_Tp IN ('SP','SREC')");
    const parsed = parseParksDetailed(
      fromPadus({
        features: [
          { attributes: { Unit_Nm: 'Custer State Park', Des_Tp: 'SP', Loc_Ds: 'State Park' }, geometry: { rings: [[[-103.45, 43.72], [-103.4, 43.72], [-103.4, 43.77]]] } },
          { attributes: { Unit_Nm: 'Angostura', Des_Tp: 'SREC', Loc_Ds: '' }, geometry: { rings: [[[-103.43, 43.3], [-103.4, 43.3], [-103.4, 43.33]]] } },
        ],
      }),
      true,
      'sd',
    );
    expect(parsed.parks.map((p) => p.name)).toEqual(['Angostura Recreation Area', 'Custer State Park']);
  });

  it('is tried first for South Dakota', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return Response.json({
        features: Array.from({ length: 50 }, (_, i) => ({
          attributes: { Unit_Nm: `Park ${i}`, Des_Tp: i % 2 ? 'SREC' : 'SP' },
          geometry: { rings: [[[-100 + i * 0.05, 44], [-99.95 + i * 0.05, 44], [-99.95 + i * 0.05, 44.05]]] },
        })),
      });
    }) as typeof fetch;
    const r = await fetchParksFromService(fake, 'sd');
    expect(r.parks).toHaveLength(50);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('USA_Protected_Areas_State/FeatureServer/0/query');
  });
});
