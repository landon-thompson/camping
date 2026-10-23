import type { Evidence } from '../types';
import { fmtTimes } from './rangeScale';

/** "a", "a and b", "a, b and c". */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export type Width = 'narrow' | 'medium' | 'wide';

/** How wide the range is, by the ratio of the high end to the low end. */
export function rangeWidth(r: { p10: number; p90: number }): Width {
  const ratio = r.p10 > 0 ? r.p90 / r.p10 : Infinity;
  if (ratio <= 2.5) return 'narrow';
  if (ratio <= 5) return 'medium';
  return 'wide';
}

const WIDTH_WORD: Record<Width, string> = { narrow: 'Fairly narrow', medium: 'Medium-wide', wide: 'Wide' };

/**
 * Plain explanation of the range, e.g. "We'd expect 0.9 to 3.1× the walleye
 * of a typical lake; middle guess 1.7×. Wide because the last survey was 2014
 * and it's mostly based on similar lakes."
 */
export function uncertaintySentence(
  range: { p10: number; med: number; p90: number },
  evidence: Evidence | null,
  opts: { speciesName: string; usedFamilyLog: boolean; nowYear: number },
): string {
  const fish = opts.speciesName.toLowerCase();
  const first = `We’d expect ${fmtTimes(range.p10)} to ${fmtTimes(range.p90)}× the ${fish} of a typical lake; middle guess ${fmtTimes(range.med)}×.`;
  const width = rangeWidth(range);
  const n = evidence?.surveys ?? 0;
  const latest = evidence?.latestYear ?? null;

  let second: string;
  if (!evidence || n === 0) {
    second = `${WIDTH_WORD[width]} because there’s no survey of this lake for ${fish}, so it comes from similar lakes.`;
  } else if (width === 'narrow') {
    const count = n === 1 ? 'one survey' : `${n} surveys`;
    second = latest ? `${WIDTH_WORD[width]}: ${count}, the latest in ${latest}.` : `${WIDTH_WORD[width]}: ${count}.`;
  } else {
    const why: string[] = [];
    if (latest !== null && opts.nowYear - latest > 8) why.push(`the last survey was ${latest}`);
    if (n === 1) why.push('there’s only one survey');
    if (evidence.ownWeight < 0.3) why.push('it’s mostly based on similar lakes');
    second = why.length
      ? `${WIDTH_WORD[width]} because ${joinAnd(why)}.`
      : `${WIDTH_WORD[width]}: catches in lake surveys vary a lot from year to year.`;
  }
  const family = opts.usedFamilyLog ? ' Your own catch log is included.' : '';
  return `${first} ${second}${family}`;
}
