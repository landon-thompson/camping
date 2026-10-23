import { describe, expect, it } from 'vitest';
import { FIXTURE_ORIGIN, fixtureManifest, fixtureTiles } from './fixtures/load';
import { confidenceFor, driveText, familyText, fishText, fmtPoints, launchText, reasonsFor, rangeText, sourceLinks, vsNextText, weakSpotsFor } from './explain';
import { recommendLakes } from './rank';
import type { Evidence, Factor, LakeRec, RankMode, RecContext } from './types';
import { DEFAULT_WEIGHTS } from './weights';

const NOW = new Date('2026-10-01T12:00:00Z');
const run = (over: Partial<RecContext> = {}) =>
  recommendLakes(
    { origin: FIXTURE_ORIGIN, species: 'WAE', mode: 'expected', startDate: '2027-06-05', endDate: '2027-06-09', towing: true, seed: 1, ...over },
    { tiles: fixtureTiles(), logs: [], manifest: fixtureManifest() },
    { now: NOW },
  );
const rec = (name: string, over: Partial<RecContext> = {}) => run(over).recs.find((r) => r.lake.name === `Fixture Lake ${name}`)!;

const factors = (fish: number, drive: number, launch = 0, season = 0, family = 0): Factor[] => [
  { key: 'fish', points: fish, text: `fish ${fish}` },
  { key: 'drive', points: drive, text: `drive ${drive}` },
  { key: 'launch', points: launch, text: `launch ${launch}` },
  { key: 'season', points: season, text: `season ${season}` },
  { key: 'family', points: family, text: `family ${family}` },
];

describe('sentences', () => {
  it('fish index in words', () => {
    expect(fishText(1.8, 'walleye', 'expected')).toBe('About 1.8× the walleye of a typical lake');
    expect(fishText(1.02, 'walleye', 'expected')).toBe('About as much walleye as a typical lake');
    expect(fishText(0.62, 'bluegill', 'expected')).toBe('Fewer bluegill than a typical lake (about 0.6×)');
    expect(fishText(12.4, 'walleye', 'expected')).toBe('About 12× the walleye of a typical lake');
    expect(fishText(1.3, 'walleye', 'safe')).toBe('Cautious guess: about 1.3× the walleye of a typical lake');
    expect(fishText(2.4, 'walleye', 'adventurous')).toBe('This roll: about 2.4× the walleye of a typical lake');
  });

  it('drive, launch, family and points', () => {
    expect(driveText(3)).toBe('Under 5 min away');
    expect(driveText(7.4)).toBe('About 7 min away');
    expect(driveText(23)).toBe('About 25 min away');
    expect(launchText({ name: 'x', lat: 0, lng: 0, ramp: 'Gravel', rampClass: 'gravel', source: '' }, true)).toBe('Gravel ramp');
    expect(launchText({ name: 'x', lat: 0, lng: 0, ramp: 'Gravel', rampClass: 'gravel', source: '' }, false)).toBe("Gravel ramp (doesn't count: not towing)");
    expect(familyText({ points: 0, ratings: [], average: null })).toBe('No family ratings here yet');
    expect(familyText({ points: 4, ratings: [5, 4, 4], average: 13 / 3 })).toBe("You've rated it 4.3/5 on average (3 trips)");
    expect(fmtPoints(6.2)).toBe('+6 pts');
    expect(fmtPoints(-1.5)).toBe('−1.5 pts');
    expect(fmtPoints(1)).toBe('+1 pt');
    expect(fmtPoints(0)).toBe('0 pts');
  });
});

describe('confidence', () => {
  const ev = (over: Partial<Evidence>): Evidence => ({ surveys: 3, latestYear: 2024, ownWeight: 0.7, sources: [], ...over });
  const tight = { p10: 1.2, p90: 2.4 };
  const conf = (e: Partial<Evidence>, range = tight) => confidenceFor(ev(e), range, 2026, DEFAULT_WEIGHTS).confidence;

  it('high needs own weight ≥ 0.6, ≥ 2 surveys, ≤ 6 years, p90/p10 ≤ 4', () => {
    expect(conf({})).toBe('high');
    expect(conf({ ownWeight: 0.6, surveys: 2, latestYear: 2020 }, { p10: 1, p90: 4 })).toBe('high');
    expect(conf({ ownWeight: 0.59 })).toBe('medium');
    expect(conf({ surveys: 1 })).toBe('medium');
    expect(conf({ latestYear: 2019 })).toBe('medium');
    expect(conf({}, { p10: 1, p90: 4.01 })).toBe('medium');
  });

  it('medium needs own weight ≥ 0.3 and ≤ 12 years; otherwise low', () => {
    expect(conf({ ownWeight: 0.3, latestYear: 2014 })).toBe('medium');
    expect(conf({ ownWeight: 0.29 })).toBe('low');
    expect(conf({ latestYear: 2013 })).toBe('low');
    expect(conf({ latestYear: null })).toBe('low');
    expect(confidenceFor(ev({ ownWeight: 0.1 }), tight, 2026, DEFAULT_WEIGHTS).text).toBe('Low confidence: mostly based on similar lakes.');
  });

  it('fixture lakes land where expected', () => {
    expect(rec('Alpha').confidence).toBe('high');
    expect(rec('Golf').confidence).toBe('high');
    expect(rec('Foxtrot').confidence).toBe('medium');
    expect(rec('Bravo').confidence).toBe('low');
  });
});

describe('reasons', () => {
  it('strongest first, at most three', () => {
    const r = reasonsFor({ factors: factors(8, 0, 0, 3, 4), driveMin: 6, launch: { name: '', lat: 0, lng: 0, ramp: '', rampClass: 'concrete', source: '' }, towing: true });
    expect(r).toEqual(['fish 8', 'family 4', 'Close by: about 6 min away']);
  });

  it('falls back to the fish and drive sentences so there are always two', () => {
    const r = reasonsFor({ factors: factors(-3, -4), driveMin: 30, launch: null, towing: false });
    expect(r).toEqual(['fish -3', 'About 30 min away']);
  });

  it('fixture: Alpha is close, with plenty of walleye', () => {
    expect(rec('Alpha').reasons).toEqual(['About 1.8× the walleye of a typical lake', 'Close by: about 6 min away', 'Concrete ramp for the trailer']);
  });
});

describe('weak spots', () => {
  it('flags pooled, old, wide estimates and a gravel ramp', () => {
    expect(rec('Bravo').weakSpots).toEqual([
      "Mostly based on similar lakes, not this lake's own surveys",
      'Latest survey is from 2011 (15 years ago)',
      'Wide range: could be much better or much worse',
      'Gravel ramp',
    ]);
  });

  it('flags another gear, unknown ramp and special regulations', () => {
    expect(rec('Foxtrot').weakSpots).toEqual([
      'Latest survey is from 2016 (10 years ago)',
      'Based only on trap nets; walleye are usually counted with gill nets',
      'Ramp type not listed: check it before towing',
      'Special regulations apply: read them before fishing',
    ]);
    expect(rec('Alpha').weakSpots).toEqual([]);
  });

  it('flags a long drive and a lake-wide regulation', () => {
    const alpha = rec('Alpha');
    const spots = weakSpotsFor(
      {
        lake: { ...alpha.lake, regs: [{ species: null, text: 'x', url: 'u', fetchedAt: '2026-10-01' }] },
        species: 'WAE',
        speciesName: 'walleye',
        primaryGear: 'Gill net',
        evidence: alpha.lake.sp.WAE!.evidence,
        confidence: 'high',
        range: alpha.range,
        launch: alpha.launch,
        towing: true,
        driveMin: 41,
        year: 2026,
      },
      DEFAULT_WEIGHTS,
    );
    expect(spots).toEqual(['Longer drive (about 40 min away)', 'Special regulations apply: read them before fishing']);
  });
});

describe('vs. next lake', () => {
  it('names the biggest gain and the biggest cost', () => {
    const a = { score: 10, factors: factors(14, -4), driveMin: 22 };
    const b = { rank: 3, score: 8, factors: factors(8, 0), driveMin: 10 };
    expect(vsNextText(a, b, 'walleye')).toBe('Beats #3 mainly on walleye (+6 pts) despite 12 more minutes of driving.');
  });

  it('a shorter drive can be the main reason', () => {
    const a = { score: 5, factors: factors(5, 0), driveMin: 6 };
    const b = { rank: 2, score: 3, factors: factors(6, -3), driveMin: 25 };
    expect(vsNextText(a, b, 'walleye')).toBe('Beats #2 mainly on a shorter drive (19 min less) despite fewer walleye (−1 pt).');
  });

  it('near-ties say so', () => {
    const a = { score: 5, factors: factors(6, -1), driveMin: 15 };
    const b = { rank: 4, score: 5, factors: factors(5, 0), driveMin: 10 };
    expect(vsNextText(a, b, 'walleye')).toBe('About even with #4; edges ahead on walleye (+1 pt).');
  });

  it('fixture: every lake but the last compares with the next', () => {
    const r = run();
    expect(r.recs[0]!.vsNext).toBe('Beats #2 mainly on walleye (+6 pts) despite 15 more minutes of driving.');
    expect(r.recs[r.recs.length - 1]!.vsNext).toBeNull();
    for (const x of r.recs.slice(0, -1)) expect(x.vsNext).toMatch(/^(Beats|About even with|Slightly ahead of) #\d/);
  });
});

describe('plain language', () => {
  it('never uses statistics jargon in anything a person reads', () => {
    const jargon = /posterior|prior\b|theta|θ|sample|quantile|gamma|thompson|log-index|percentile|NaN|undefined|Infinity/i;
    for (const mode of ['safe', 'expected', 'adventurous'] as RankMode[]) {
      for (const towing of [true, false]) {
        const r = run({ mode, towing });
        const texts = [
          ...r.excluded.map((e) => e.why),
          ...r.recs.flatMap((x: LakeRec) => [...x.factors.map((f) => f.text), x.confidenceText, ...x.reasons, ...x.weakSpots, x.vsNext ?? '', rangeText(x, 'WAE', 2026)]),
        ];
        for (const t of texts) expect(t).not.toMatch(jargon);
      }
    }
  });

  it('explains the range and links the sources', () => {
    expect(rangeText(rec('Bravo'), 'WAE', 2026)).toBe("We'd expect 0.9–8.2× a typical lake; middle guess 2.7×. Wide because the last survey was 2011.");
    expect(rangeText(rec('Alpha'), 'WAE', 2026)).toBe("We'd expect 1.4–2.3× a typical lake; middle guess 1.8×.");
    const links = sourceLinks(rec('Alpha').lake, 'WAE');
    expect(links[0]).toEqual({ label: '2024 Standard Survey (standard gill nets)', url: 'https://www.dnr.state.mn.us/lakefind/lake.html?id=99000001' });
    expect(links).toHaveLength(3);
  });
});
