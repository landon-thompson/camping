import { describe, expect, it } from 'vitest';
import { catchShares, fetchLakeSurveyOrWholeLake, groupByGear, latestWithCatch, parseDowInput, parseJsonLoose, parseLakeSurvey, parseNearbyLakes, rate } from './lakeSurvey';

const sample = {
  result: {
    lakeName: 'Bear Head',
    surveys: [
      {
        surveyDate: '2015-07-20',
        surveyType: 'Standard Survey',
        fishCatchSummaries: [{ species: 'WAE', gear: 'Standard gill nets', gearCount: 6, totalCatch: 20, CPUE: '3.33', quartileCount: '2.0-8.0', averageWeight: '1.10' }],
      },
      {
        surveyDate: '2021-07-12',
        surveyType: 'Population Assessment',
        fishCatchSummaries: [
          { species: 'WAE', gear: 'Standard gill nets', gearCount: 6, totalCatch: 54, CPUE: '9.00', quartileCount: '3.3-10.5', averageWeight: '1.35' },
          { species: 'NOP', gear: 'Standard gill nets', gearCount: 6, totalCatch: 12, CPUE: '2.00', quartileCount: '2.5-7.2', averageWeight: '2.9' },
          { species: 'YEP', gear: 'Standard gill nets', gearCount: 6, totalCatch: 96, CPUE: '16.00', quartileCount: '6.0-30.0', averageWeight: '0.12' },
          { species: 'YEP', gear: 'Shallow gill nets', gearCount: 2, totalCatch: 30, CPUE: '15.00', quartileCount: 'N/A', averageWeight: '0.1' },
          { species: 'BLG', gear: 'Standard trap nets', gearCount: 9, totalCatch: 270, CPUE: '30.00', quartileCount: '10.0-60.0', averageWeight: '0.20' },
          { species: 'SMB', gear: 'Standard trap nets', gearCount: 9, totalCatch: 3, CPUE: '0.33', quartileCount: '', averageWeight: '' },
        ],
      },
      { surveyDate: '2023-06-01', surveyType: 'Special Assessment', fishCatchSummaries: [] },
    ],
  },
};

describe('LakeFinder lake survey', () => {
  it('reads surveys newest first with catch rows', () => {
    const s = parseLakeSurvey(sample, '69025400', new Date('2026-09-27T00:00:00Z'));
    expect(s.lakeName).toBe('Bear Head');
    expect(s.surveys.map((x) => x.date)).toEqual(['2023-06-01', '2021-07-12', '2015-07-20']);
    const latest = latestWithCatch(s)!;
    expect(latest.date).toBe('2021-07-12');
    expect(latest.catches[0]).toEqual({
      species: 'WAE',
      gear: 'Standard gill nets',
      gearCount: 6,
      totalCatch: 54,
      cpue: 9,
      normalLow: 3.3,
      normalHigh: 10.5,
      avgWeightLb: 1.35,
    });
  });

  it('groups by net, prefers standard nets, and rates against the typical range', () => {
    const latest = latestWithCatch(parseLakeSurvey(sample, '69025400'))!;
    const groups = groupByGear(latest.catches);
    expect(groups.map((g) => g.family)).toEqual(['Gill nets', 'Trap nets']);
    expect(groups[0]!.rows.map((r) => [r.species, r.gear])).toEqual([
      ['YEP', 'Standard gill nets'],
      ['WAE', 'Standard gill nets'],
      ['NOP', 'Standard gill nets'],
    ]);
    expect(groups[0]!.maxCpue).toBe(30); // top of perch's typical range
    expect(rate(groups[0]!.rows[1]!)).toBe('typical');
    expect(rate(groups[0]!.rows[2]!)).toBe('below');
    expect(rate(groups[1]!.rows[1]!)).toBeNull();
  });

  it('shares of all fish caught', () => {
    const latest = latestWithCatch(parseLakeSurvey(sample, '69025400'))!;
    const shares = catchShares(latest.catches);
    expect(shares[0]).toMatchObject({ species: 'BLG', count: 270 });
    expect(shares.find((x) => x.species === 'YEP')?.count).toBe(126);
    expect(shares.reduce((a, b) => a + b.pct, 0)).toBeCloseTo(100);
  });

  it('explains when there is no survey', () => {
    expect(() => parseLakeSurvey({ status: 'ERROR', message: 'No lake survey found' }, '12345678')).toThrow(/No lake survey found/);
  });

  it('reads JSONP and pasted lake ids', () => {
    expect(parseJsonLoose('cb({"a":1})')).toEqual({ a: 1 });
    expect(parseDowInput('https://www.dnr.state.mn.us/lakefind/lake.html?id=69025400')).toBe('69025400');
    expect(parseDowInput('69-0254-00')).toBe('69025400');
    expect(parseDowInput('Bear Head')).toBeNull();
  });

  it('finds lakes in a by-point answer', () => {
    const data = { status: 'OK', results: [{ name: 'Bear Head', id: '69025400', county: 'St. Louis', point: { 'epsg:4326': [-92.0, 47.8] } }, { name: 'Eagles Nest #4', id: '69028500', county: 'St. Louis' }] };
    expect(parseNearbyLakes(data)).toEqual([
      { dow: '69025400', name: 'Bear Head', county: 'St. Louis' },
      { dow: '69028500', name: 'Eagles Nest #4', county: 'St. Louis' },
    ]);
  });
});

describe('trip lake choices', async () => {
  const { lakesFrom, defaultLakes } = await import('./TripLakeSection');
  const launch = (over: object) => ({ name: 'A', water: 'Bear Head', dow: null, ramp: '', manager: '', lat: 0, lng: 0, distanceKm: 1, ...over });
  it('adds the lakes launches go into and defaults to the nearest launch’s lake', () => {
    const lakes = lakesFrom([{ dow: '69028500', name: 'Eagles Nest #4', county: '' }], [launch({ dow: '69025400' }), launch({ dow: '69028500' })]);
    expect(lakes.map((l) => l.dow)).toEqual(['69028500', '69025400']);
    expect(defaultLakes(lakes, [launch({}), launch({ dow: '69025400' })])).toEqual(['69025400']);
    expect(defaultLakes(lakes, [])).toEqual(['69028500']);
  });
});

describe('sub-basins', () => {
  it('falls back to the whole lake when a bay has no survey of its own', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.includes('id=69037801&')) return new Response(JSON.stringify({ status: 'ERROR', message: 'The requested lake survey data is not available.' }));
      return new Response(JSON.stringify(sample));
    }) as typeof fetch;
    const s = await fetchLakeSurveyOrWholeLake('69037801', fake);
    expect(s.dow).toBe('69037800');
    expect(urls.map((u) => /id=(\d{8})/.exec(u)?.[1])).toEqual(['69037801', '69037800']);
    expect(urls[0]).toContain('type=lake_survey&callback=&id=');
    await expect(fetchLakeSurveyOrWholeLake('69037800', (async () => new Response('{"message":"none"}')) as typeof fetch)).rejects.toThrow('69-0378-00: none');
  });
});
