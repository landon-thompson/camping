import { describe, expect, it } from 'vitest';
import { findSurveyReports, parseReportLinks, pickSurvey, reportListUrl, waterNameVariants } from './sdFishReports';

describe('SD GFP report list', () => {
  it('finds report links and picks the newest lake survey', () => {
    const html = `<table>
      <tr><td>Lake Survey</td><td>2020</td><td><a href="ExportPDF.ashx?ReportID=22891">Enemy Swim (2020)</a></td></tr>
      <tr><td>Creel Survey</td><td>2021</td><td><a href="ExportPDF.ashx?ReportID=23860">Creel and Lake Information</a></td></tr>
      <tr><td>Lake Survey</td><td>2021</td><td><a href='./ExportPDF.ashx?ReportID=28627&amp;x=1'>Enemy Swim (2021)</a></td></tr>
      <tr><td>Lake Map</td><td><a href="ExportPDF.ashx?ReportID=30000">Map</a></td></tr>
    </table>`;
    const links = parseReportLinks(html);
    expect(links.map((l) => l.id)).toEqual(['22891', '23860', '28627', '30000']);
    expect(pickSurvey(links)?.id).toBe('28627');
    expect(reportListUrl('Enemy Swim')).toBe('https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim');
    expect(waterNameVariants('Enemy Swim Lake')).toEqual(['Enemy Swim Lake', 'Enemy Swim']);
    expect(waterNameVariants('Lake Poinsett')).toEqual(['Lake Poinsett', 'Poinsett']);
  });
});


describe('finding a lake survey', () => {
  it('tries "X Lake" then "X" and returns the newest survey and the others', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.endsWith('Waterbody=Enemy+Swim+Lake')) return new Response('<p>No results</p>');
      return new Response('<tr><td>Lake Survey 2020</td><td><a href="ExportPDF.ashx?ReportID=22891">Enemy Swim (2020)</a></td></tr><tr><td>Lake Survey 2021</td><td><a href="ExportPDF.ashx?ReportID=28627">Enemy Swim (2021)</a></td></tr>');
    }) as typeof fetch;
    const r = await findSurveyReports('Enemy Swim Lake', fake);
    expect(urls).toEqual([
      'https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim+Lake',
      'https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim',
    ]);
    expect(r).toMatchObject({ reportId: '28627', listUrl: urls[1], url: 'https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx?ReportID=28627' });
    expect(r?.surveys.map((s) => s.id)).toEqual(['28627', '22891']);
    expect(await findSurveyReports('Nowhere', (async () => new Response('none')) as typeof fetch)).toBeNull();
  });
});
