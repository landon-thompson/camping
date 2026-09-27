import { describe, expect, it } from 'vitest';
import { bestUsfsMatch, coreName, findCampgroundLocation, matchPark, searchPhrases, withFoundLocation } from './campgroundLocation';
import { findBoatLaunches, parseLaunches } from './waterAccess';
import type { Campground } from '../../model/schemas';

const cg = (over: Partial<Campground>): Campground => ({
  name: 'X',
  agency: 'usfs',
  bookingSystem: 'recreation-gov',
  unit: '',
  location: null,
  bookingUrl: '',
  ridbFacilityId: null,
  windowDaysOverride: null,
  electric: null,
  boatLaunch: null,
  rules: [],
  verify: '',
  source: '',
  notes: '',
  ...over,
});

describe('campground names', () => {
  it('keeps the distinctive words', () => {
    expect(coreName('Baker Lake Rustic Campground')).toBe('baker lake');
    expect(searchPhrases(cg({ name: 'Chippewa Loop — Norway Beach Recreation Area' }))).toEqual(['norway beach', 'chippewa']);
  });

  it('matches a state park campground to its park', () => {
    const parks = [
      { name: 'Bear Head Lake State Park', lat: 47.79, lng: -92.08 },
      { name: 'McCarthy Beach State Park', lat: 47.67, lng: -93.03 },
    ];
    expect(matchPark(cg({ name: 'Bear Head Lake State Park Campground', unit: 'Bear Head Lake State Park' }), parks)?.lat).toBe(47.79);
    expect(matchPark(cg({ name: 'McCarthy Beach State Park — Beatrice Lake Campground', unit: '' }), parks)?.lng).toBe(-93.03);
    expect(matchPark(cg({ name: 'Nowhere', unit: 'Nowhere' }), parks)).toBeNull();
  });

  it('picks the Forest Service campground over other sites with the same words', () => {
    const features = [
      { attributes: { RECAREANAME: 'Baker Lake Boat Launch', MARKERACTIVITY: 'Boating' }, geometry: { x: -90.8, y: 47.8 } },
      { attributes: { RECAREANAME: 'Baker Lake Campground', MARKERACTIVITY: 'Campground Camping', FORESTNAME: 'Superior National Forest' }, geometry: { x: -90.81, y: 47.84 } },
      { attributes: { RECAREANAME: 'Lake Road', MARKERACTIVITY: 'Campground Camping' }, geometry: { x: -91, y: 47 } },
    ];
    expect(bestUsfsMatch(cg({ name: 'Baker Lake Rustic Campground', unit: 'Superior National Forest' }), features)?.name).toBe('Baker Lake Campground');
    expect(bestUsfsMatch(cg({ name: 'Wilson Lake Rustic Campground' }), features)).toBeNull();
  });

  it('looks up a USFS campground through the service and notes the source', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.endsWith('/layers?f=json')) {
        return Response.json({ layers: [{ id: 0, name: 'Recreation Opportunities', geometryType: 'esriGeometryPoint', fields: [{ name: 'RECAREANAME' }] }] });
      }
      return Response.json({
        features: [{ attributes: { RECAREANAME: 'Winnie Campground', MARKERACTIVITY: 'Campground Camping' }, geometry: { x: -94.33, y: 47.42 } }],
      });
    }) as typeof fetch;
    const c = cg({ name: 'Winnie Campground', unit: 'Chippewa National Forest', verify: 'Check fees.' });
    const r = await findCampgroundLocation(c, fake);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.found.location).toEqual({ lat: 47.42, lng: -94.33 });
    expect(decodeURIComponent(urls[1]!.replace(/\+/g, ' '))).toContain("UPPER(RECAREANAME) LIKE '%WINNIE%'");
    const updated = withFoundLocation(c, r.found);
    expect(updated.verify).toMatch(/^Check fees\. Location from Forest Service/);
    expect(updated.source).toContain('USFS recreation sites: Winnie Campground');
  });

  it('says so when there is no source for the agency', async () => {
    const r = await findCampgroundLocation(cg({ agency: 'other' }), fetch);
    expect(r.ok).toBe(false);
  });
});

describe('boat launches', () => {
  const at = { lat: 47.8, lng: -92.08 };
  const features = [
    { attributes: { FAC_NAME: 'Far Access', LAKE_NAME: 'Far Lake' }, geometry: { x: -91.0, y: 47.8 } },
    { attributes: { FAC_NAME: 'Bear Head Lake Access', LAKE_NAME: 'Bear Head', DOWLKNUM: '69025400', RAMP_TYPE: 'Concrete', ADMIN: 'DNR Parks and Trails' }, geometry: { x: -92.07, y: 47.79 } },
    { attributes: { FAC_NAME: 'Eagles Nest Access', LAKE_NAME: 'Eagles Nest #1', DOWLKNUM: 690285, RAMP_TYPE: 'Gravel' }, geometry: { x: -92.1, y: 47.83 } },
  ];

  it('keeps launches in range, nearest first, with lake ids', () => {
    const l = parseLaunches(features, at, 10);
    expect(l.map((x) => x.name)).toEqual(['Bear Head Lake Access', 'Eagles Nest Access']);
    expect(l[0]).toMatchObject({ water: 'Bear Head', dow: '69025400', ramp: 'Concrete', manager: 'DNR Parks and Trails' });
    expect(l[1]!.dow).toBe('69028500');
  });

  it('reports each source it tried', async () => {
    const fake = (async (url: string) => {
      if (url.includes('struc_water_access_sites/FeatureServer')) return new Response('{"error":"nope"}', { status: 502 });
      if (url.endsWith('/layers?f=json')) return Response.json({ layers: [{ id: 2, name: 'Water Access Sites', geometryType: 'esriGeometryPoint' }] });
      return Response.json({ features });
    }) as typeof fetch;
    const r = await findBoatLaunches(at, fake);
    expect(r.launches).toHaveLength(2); // the far one is ~50 mi away
    expect(r.report).toEqual(['DNR public water accesses: HTTP 502 — nope', 'DNR public water accesses (map service): 2 within 25 mi']);
  });
});

describe('South Dakota boat ramps', () => {
  it('finds GFP’s ramp layer by name and never invents Minnesota lake numbers', async () => {
    const { findBoatLaunches } = await import('./waterAccess');
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.endsWith('/Parks?f=json')) return Response.json({ services: [{ name: 'Parks/ParkBoundaries', type: 'MapServer' }, { name: 'Parks/PublicWaterAccess', type: 'FeatureServer' }] });
      if (url.includes('/Fisheries?f=json') || url.includes('/Public_Lands?f=json')) return Response.json({ services: [] });
      if (url.includes('PublicWaterAccess/FeatureServer/layers')) return Response.json({ layers: [{ id: 3, name: 'Boat Ramps', geometryType: 'esriGeometryPoint' }] });
      if (url.includes('PublicWaterAccess/FeatureServer/3/query')) {
        return Response.json({ features: [{ attributes: { SiteName: 'Angostura Marina Ramp', LakeName: 'Angostura Reservoir', LakeID: 123456 }, geometry: { x: -103.43, y: 43.33 } }] });
      }
      return new Response('{"error":"unexpected"}', { status: 404 });
    }) as typeof fetch;
    const r = await findBoatLaunches({ lat: 43.34, lng: -103.44 }, fake);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0]).toMatchObject({ name: 'Angostura Marina Ramp', water: 'Angostura Reservoir', dow: null });
    expect(r.report[0]).toMatch(/^SD GFP boat ramps: 1 within 25 mi \(Parks\/PublicWaterAccess › Boat Ramps\)$/);
    expect(urls.some((u) => u.includes('mn.gov'))).toBe(false); // far from Minnesota
  });

  it('asks both states near the border', async () => {
    const { findBoatLaunches } = await import('./waterAccess');
    const hosts = new Set<string>();
    const fake = (async (url: string) => {
      hosts.add(new URL(url).hostname);
      return new Response('{"error":"x"}', { status: 502 });
    }) as typeof fetch;
    const r = await findBoatLaunches({ lat: 45.3, lng: -96.5 }, fake); // Big Stone Lake
    expect([...hosts].sort()).toEqual(['enterprise.gisdata.mn.gov', 'gfpgis.sd.gov']);
    expect(r.report.some((l) => l.startsWith('SD GFP boat ramps:'))).toBe(true);
  });
});
