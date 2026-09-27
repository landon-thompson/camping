import { describe, expect, it } from 'vitest';
import { fetchSdReport, sdLakeKey, sdReportId, sdWaterFromKey } from './sdReport';
import { codeForName } from './lakeSurvey';

describe('South Dakota lake reports', () => {
  it('asks the app server and keeps what it read', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return Response.json({
        water: 'Enemy Swim Lake',
        reportId: '28627',
        url: 'https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx?ReportID=28627',
        listUrl: 'https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim',
        title: 'Enemy Swim Lake Survey Summary',
        year: 2021,
        summary: ['Yellow perch were numerous, accounting for 65% of the sample.'],
        catches: [{ species: 'Walleye', gear: 'Gill nets', cpue: 3.4, from: 'table' }],
        surveys: [{ id: '28627', text: 'Lake Survey 2021 Enemy Swim (2021)' }],
      });
    }) as typeof fetch;
    const r = await fetchSdReport('Enemy Swim Lake', undefined, fake);
    expect(urls[0]).toBe('/api/sdfish?water=Enemy+Swim+Lake');
    expect(r).toMatchObject({ reportId: '28627', year: 2021, catches: [{ species: 'Walleye', cpue: 3.4 }] });
    await fetchSdReport('Enemy Swim Lake', '22891', fake);
    expect(urls[1]).toBe('/api/sdfish?water=Enemy+Swim+Lake&report=22891');
  });

  it('explains failures', async () => {
    const notFound = (async () => Response.json({ error: 'No lake survey report for “X” on GFP Fishery Reports.' }, { status: 404 })) as typeof fetch;
    await expect(fetchSdReport('X', undefined, notFound)).rejects.toThrow(/No lake survey report/);
    const oldServer = (async () => new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    await expect(fetchSdReport('X', undefined, oldServer)).rejects.toThrow(/doesn’t have the South Dakota report reader/);
    const expired = (async () => new Response('', { status: 401 })) as typeof fetch;
    await expect(fetchSdReport('X', undefined, expired)).rejects.toThrow(/sign-in expired/);
  });

  it('keys and species icons', () => {
    expect(sdReportId('Enemy Swim Lake')).toBe('sd_lake_report:enemy-swim-lake');
    expect(sdWaterFromKey(sdLakeKey('Lake Poinsett'))).toBe('Lake Poinsett');
    expect(sdWaterFromKey('69037800')).toBeNull();
    expect(['Yellow Perch', 'Walleye', 'Cisco', 'Common Carp', 'Smallmouth Buffalo'].map(codeForName)).toEqual(['YEP', 'WAE', 'TLC', 'CAP', '']);
  });
});
