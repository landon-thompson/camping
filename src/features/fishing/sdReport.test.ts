import { describe, expect, it } from 'vitest';
import { fetchSdReport, sdLakeKey, sdReportId, sdWaterFromKey } from './sdReport';
import { codeForName } from './lakeSurvey';
import { makePdf } from './testPdf';

describe('South Dakota lake reports', () => {
  it('finds the report on the server, then reads the PDF on the phone', async () => {
    const urls: string[] = [];
    const pdf = makePdf([
      [72, 740, 'Enemy Swim Lake Survey Summary'],
      [72, 720, '2021'],
      [72, 690, 'Yellow perch were numerous, accounting for 65% of the sample.'],
      [72, 630, 'Table 1. Mean CPUE of fish captured in gill nets, Enemy Swim Lake, 2021.'],
      [72, 610, 'Gill nets'],
      [72, 596, 'Species'],
      [250, 596, 'CPUE'],
      [72, 582, 'Walleye'],
      [250, 582, '3.4'],
    ]);
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('/api/sdfish/pdf')) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
      return Response.json({
        water: 'Enemy Swim Lake',
        reportId: '28627',
        url: 'https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx?ReportID=28627',
        listUrl: 'https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim',
        surveys: [{ id: '28627', text: 'Lake Survey 2021 Enemy Swim (2021)' }],
      });
    }) as typeof fetch;
    const r = await fetchSdReport('Enemy Swim Lake', undefined, fake);
    expect(urls).toEqual(['/api/sdfish/list?water=Enemy+Swim+Lake', '/api/sdfish/pdf?id=28627']);
    expect(r).toMatchObject({ reportId: '28627', year: 2021, title: 'Enemy Swim Lake Survey Summary', catches: [{ species: 'Walleye', cpue: 3.4 }] });
    expect(r.summary[0]).toMatch(/^Yellow perch/);
    const older = await fetchSdReport('Enemy Swim Lake', '22891', fake);
    expect(urls.at(-1)).toBe('/api/sdfish/pdf?id=22891');
    expect(older.url).toMatch(/ReportID=22891$/);
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
