import { describe, expect, it } from 'vitest';
import type { Evidence } from '../types';
import { joinAnd, rangeWidth, uncertaintySentence } from './uncertainty';

const ev = (o: Partial<Evidence>): Evidence => ({ surveys: 3, latestYear: 2022, ownWeight: 0.7, sources: [], ...o });
const opts = { speciesName: 'Walleye', usedFamilyLog: false, nowYear: 2026 };

describe('uncertainty sentence', () => {
  it('joins reasons in plain English', () => {
    expect(joinAnd([])).toBe('');
    expect(joinAnd(['a'])).toBe('a');
    expect(joinAnd(['a', 'b'])).toBe('a and b');
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('classifies width by high ÷ low', () => {
    expect(rangeWidth({ p10: 1, p90: 2 })).toBe('narrow');
    expect(rangeWidth({ p10: 1, p90: 4 })).toBe('medium');
    expect(rangeWidth({ p10: 0.5, p90: 4 })).toBe('wide');
    expect(rangeWidth({ p10: 0, p90: 4 })).toBe('wide');
  });

  it('explains a wide range from an old, single, pooled survey', () => {
    const s = uncertaintySentence({ p10: 0.6, med: 1.7, p90: 4.2 }, ev({ surveys: 1, latestYear: 2014, ownWeight: 0.2 }), opts);
    expect(s).toContain('We’d expect 0.6 to 4.2× the walleye of a typical lake; middle guess 1.7×.');
    expect(s).toContain('Wide because the last survey was 2014, there’s only one survey and it’s mostly based on similar lakes.');
  });

  it('describes a narrow range by its surveys', () => {
    const s = uncertaintySentence({ p10: 1.2, med: 1.6, p90: 2.1 }, ev({ surveys: 4, latestYear: 2023 }), opts);
    expect(s).toContain('Fairly narrow: 4 surveys, the latest in 2023.');
    expect(uncertaintySentence({ p10: 1.2, med: 1.6, p90: 2.1 }, ev({ surveys: 1, latestYear: 2023 }), opts)).toContain('one survey, the latest in 2023');
  });

  it('says when there is no survey of the lake at all', () => {
    const s = uncertaintySentence({ p10: 0.3, med: 0.9, p90: 2.5 }, ev({ surveys: 0, latestYear: null, ownWeight: 0 }), opts);
    expect(s).toContain('no survey of this lake for walleye');
    expect(uncertaintySentence({ p10: 0.3, med: 0.9, p90: 2.5 }, null, opts)).toContain('comes from similar lakes');
  });

  it('falls back to year-to-year variation, and mentions the family log', () => {
    const s = uncertaintySentence({ p10: 0.9, med: 1.7, p90: 3.1 }, ev({}), { ...opts, usedFamilyLog: true });
    expect(s).toContain('Medium-wide: catches in lake surveys vary a lot from year to year.');
    expect(s.endsWith('Your own catch log is included.')).toBe(true);
    expect(s).not.toMatch(/posterior/i);
  });
});
