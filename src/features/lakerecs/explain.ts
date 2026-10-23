import { gearFamily, lakeFinderPage } from '../fishing/lakeSurvey';
import type { Confidence, Evidence, Factor, FactorKey, LakeRec, RankMode, SpeciesCode, TileLake, TileLaunch } from './types';
import type { LakeRecWeights } from './weights';

/**
 * Plain-language explanations for the lake recommender. Friendly words only:
 * no statistics jargon in anything a person reads.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MINUS = '−';

/** "1.8", "12", "0.6" */
function fmtIndex(x: number): string {
  return x >= 9.95 ? String(Math.round(x)) : x.toFixed(1);
}

/** "+6 pts", "−1.5 pts" */
export function fmtPoints(p: number, signed = true): string {
  const a = Math.abs(p);
  const n = a >= 2 ? String(Math.round(a)) : String(Math.round(a * 10) / 10);
  const sign = !signed ? '' : p > 0 ? '+' : p < 0 ? MINUS : '';
  return `${sign}${n} pt${n === '1' ? '' : 's'}`;
}

export const kmToMi = (km: number) => km / 1.609344;

function indexPhrase(index: number, sp: string): string {
  if (index >= 0.95 && index < 1.05) return `about as much ${sp} as a typical lake`;
  if (index < 0.95) return `fewer ${sp} than a typical lake (about ${fmtIndex(index)}×)`;
  return `about ${fmtIndex(index)}× the ${sp} of a typical lake`;
}

/** "About 1.8× the walleye of a typical lake" (the index the mode scored on). */
export function fishText(index: number, sp: string, mode: RankMode): string {
  const phrase = indexPhrase(index, sp);
  if (mode === 'safe') return `Cautious guess: ${phrase}`;
  if (mode === 'adventurous') return `This roll: ${phrase}`;
  return cap(phrase);
}

/** "About 25 min away" */
export function driveText(min: number): string {
  if (min < 5) return 'Under 5 min away';
  if (min < 10) return `About ${Math.round(min)} min away`;
  return `About ${Math.round(min / 5) * 5} min away`;
}

const RAMP: Record<TileLaunch['rampClass'], string> = {
  concrete: 'Concrete ramp',
  gravel: 'Gravel ramp',
  unknown: 'Ramp type not listed',
  'carry-in': 'Carry-in access only',
};

export function launchText(launch: TileLaunch | null, towing: boolean): string {
  if (!launch) return 'No launch listed';
  const base = RAMP[launch.rampClass] ?? RAMP.unknown;
  return towing ? base : `${base} (doesn't count: not towing)`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Early June" for 2027-06-08. */
export function partOfMonth(date: Date): string {
  const d = date.getUTCDate();
  const part = d <= 10 ? 'Early' : d <= 20 ? 'Mid' : 'Late';
  return `${part} ${MONTHS[date.getUTCMonth()]}`;
}

export function seasonText(points: number, when: string | null, sp: string, hasRow: boolean): string {
  if (!when) return "No trip dates, so season isn't counted";
  if (!hasRow) return `No season estimate for ${sp}`;
  if (points >= 1.5) return `${when} is usually a good time for ${sp} (estimate)`;
  if (points >= 0.5) return `${when} is often a fair time for ${sp} (estimate)`;
  if (points > -0.5) return `${when} is an average time for ${sp} (estimate)`;
  return `${when} is usually slower for ${sp} (estimate)`;
}

export interface FamilyHistory {
  points: number;
  /** Ratings at this lake, newest first. */
  ratings: number[];
  average: number | null;
}

export function familyText(f: FamilyHistory): string {
  if (!f.ratings.length) return 'No family ratings here yet';
  if (f.ratings.length === 1) return `You rated it ${f.ratings[0]}/5 last time`;
  return `You've rated it ${(Math.round(f.average! * 10) / 10).toString()}/5 on average (${f.ratings.length} trips)`;
}

// ------------------------------------------------------------ confidence

export function confidenceFor(
  ev: Evidence,
  range: { p10: number; p90: number },
  year: number,
  w: LakeRecWeights,
): { confidence: Confidence; text: string } {
  const c = w.confidence;
  const age = ev.latestYear == null ? Infinity : year - ev.latestYear;
  const spread = range.p10 > 0 ? range.p90 / range.p10 : Infinity;
  if (ev.ownWeight >= c.highOwnWeight && ev.surveys >= c.highMinSurveys && age <= c.highMaxAgeYears && spread <= c.highMaxSpread) {
    return { confidence: 'high', text: "High confidence: this lake's own recent surveys agree." };
  }
  if (ev.ownWeight >= c.mediumOwnWeight && age <= c.mediumMaxAgeYears) {
    return { confidence: 'medium', text: "Medium confidence: partly this lake's own surveys, partly similar lakes." };
  }
  return { confidence: 'low', text: 'Low confidence: mostly based on similar lakes.' };
}

// ------------------------------------------------------------ reasons and weak spots

export interface ExplainInput {
  factors: Factor[];
  driveMin: number;
  launch: TileLaunch | null;
  towing: boolean;
}

/** 2–3 plain reasons, strongest first. */
export function reasonsFor({ factors, driveMin, launch, towing }: ExplainInput): string[] {
  const by = (k: FactorKey) => factors.find((f) => f.key === k)!;
  const cands: { text: string; strength: number }[] = [];
  for (const k of ['fish', 'season', 'family'] as const) {
    const f = by(k);
    // Season is the same for every lake on a trip, so it ranks below lake-specific reasons.
    if (f && f.points >= 1) cands.push({ text: f.text, strength: k === 'season' ? f.points / 4 : f.points });
  }
  if (driveMin <= 15) cands.push({ text: driveMin < 10 ? `Close by: ${driveText(driveMin).toLowerCase()}` : driveText(driveMin), strength: driveMin < 10 ? 1.5 : 1 });
  if (towing && launch?.rampClass === 'concrete') cands.push({ text: 'Concrete ramp for the trailer', strength: 1 });
  cands.sort((a, b) => b.strength - a.strength);
  const out = cands.slice(0, 3).map((c) => c.text);
  for (const fallback of [by('fish')?.text, driveText(driveMin)]) {
    if (out.length >= 2) break;
    if (fallback && !out.includes(fallback)) out.push(fallback);
  }
  return out;
}

export interface WeakSpotInput {
  lake: TileLake;
  species: SpeciesCode;
  speciesName: string;
  primaryGear: string | null;
  evidence: Evidence;
  confidence: Confidence;
  range: { p10: number; p90: number };
  launch: TileLaunch | null;
  towing: boolean;
  driveMin: number;
  year: number;
}

export function weakSpotsFor(i: WeakSpotInput, w: LakeRecWeights): string[] {
  const out: string[] = [];
  const ev = i.evidence;
  const pooled = ev.ownWeight < w.weakSpots.pooledOwnWeight;
  if (ev.latestYear == null) out.push(`No ${i.speciesName} survey of this lake found, so it's based on similar lakes`);
  else if (pooled) out.push("Mostly based on similar lakes, not this lake's own surveys");
  if (ev.latestYear != null && i.year - ev.latestYear > w.weakSpots.oldSurveyYears) {
    out.push(`Latest survey is from ${ev.latestYear} (${i.year - ev.latestYear} years ago)`);
  }
  if (i.confidence === 'low' && ev.latestYear != null && !pooled && i.year - ev.latestYear <= w.weakSpots.oldSurveyYears) {
    out.push('Low confidence in this estimate');
  }
  if (i.range.p10 > 0 && i.range.p90 / i.range.p10 > w.weakSpots.wideSpread) out.push('Wide range: could be much better or much worse');
  const gear = otherGearOnly(ev, i.primaryGear);
  if (gear) out.push(`Based only on ${gear.toLowerCase()}; ${i.speciesName} are usually counted with ${gearFamily(i.primaryGear!).toLowerCase()}`);
  if (i.launch?.rampClass === 'carry-in') out.push('Carry-in access only');
  else if (i.launch?.rampClass === 'unknown') out.push(i.towing ? 'Ramp type not listed: check it before towing' : 'Ramp type not listed');
  else if (i.launch?.rampClass === 'gravel' && i.towing) out.push('Gravel ramp');
  if (i.driveMin >= w.weakSpots.longDriveMin) out.push(`Longer drive (${driveText(i.driveMin).toLowerCase()})`);
  if (i.lake.regs.some((r) => r.species == null || r.species === i.species)) out.push('Special regulations apply: read them before fishing');
  return out;
}

/** The gear family the estimate rests on when none of its surveys used the species' primary gear. */
function otherGearOnly(ev: Evidence, primaryGear: string | null): string | null {
  if (!primaryGear || !ev.sources.length) return null;
  const primary = gearFamily(primaryGear);
  const fams = new Set(ev.sources.map((s) => gearFamily(s.gear)));
  if (fams.has(primary)) return null;
  return [...fams][0] ?? null;
}

// ------------------------------------------------------------ comparison with the next lake

function plusPhrase(key: FactorKey, d: number, sp: string, minDiff: number): string {
  switch (key) {
    case 'fish':
      return `${sp} (${fmtPoints(d)})`;
    case 'drive':
      return `a shorter drive (${Math.max(1, Math.round(minDiff))} min less)`;
    case 'launch':
      return `the ramp (${fmtPoints(d)})`;
    case 'season':
      return `season timing (${fmtPoints(d)})`;
    case 'family':
      return `your past ratings (${fmtPoints(d)})`;
  }
}

function minusPhrase(key: FactorKey, d: number, sp: string, minDiff: number): string {
  switch (key) {
    case 'fish':
      return `fewer ${sp} (${fmtPoints(d)})`;
    case 'drive':
      return `${Math.max(1, Math.round(minDiff))} more minutes of driving`;
    case 'launch':
      return `a rougher ramp (${fmtPoints(d)})`;
    case 'season':
      return `season timing (${fmtPoints(d)})`;
    case 'family':
      return `lower past ratings (${fmtPoints(d)})`;
  }
}

/** "Beats #3 mainly on walleye (+6 pts) despite 12 more minutes of driving." */
export function vsNextText(a: Pick<LakeRec, 'score' | 'factors' | 'driveMin'>, b: Pick<LakeRec, 'rank' | 'score' | 'factors' | 'driveMin'>, sp: string): string {
  const diffs = a.factors
    .map((f) => ({ key: f.key, d: f.points - (b.factors.find((g) => g.key === f.key)?.points ?? 0) }))
    .filter((x) => Math.abs(x.d) >= 0.05);
  const minDiff = Math.abs(a.driveMin - b.driveMin);
  const best = [...diffs].sort((x, y) => y.d - x.d)[0];
  const worst = [...diffs].sort((x, y) => x.d - y.d)[0];
  if (Math.abs(a.score - b.score) < 0.05) {
    return best && best.d > 0 ? `About even with #${b.rank}; edges ahead on ${plusPhrase(best.key, best.d, sp, minDiff)}.` : `About even with #${b.rank}.`;
  }
  if (!best || best.d <= 0) return `Slightly ahead of #${b.rank}.`;
  const despite = worst && worst.d <= -0.5 ? ` despite ${minusPhrase(worst.key, worst.d, sp, minDiff)}` : '';
  return `Beats #${b.rank} mainly on ${plusPhrase(best.key, best.d, sp, minDiff)}${despite}.`;
}

// ------------------------------------------------------------ helpers for the UI

/** "We'd expect 0.9–3.1× a typical lake; middle guess 1.7×. Wide because the last survey was 2014." */
export function rangeText(rec: Pick<LakeRec, 'range' | 'lake'>, species: SpeciesCode, year = new Date().getFullYear()): string {
  const { p10, med, p90 } = rec.range;
  let s = `We'd expect ${fmtIndex(p10)}–${fmtIndex(p90)}× a typical lake; middle guess ${fmtIndex(med)}×.`;
  const ev = rec.lake.sp[species]?.evidence;
  if (p10 > 0 && p90 / p10 > 4 && ev) {
    if (ev.latestYear == null) s += ' Wide because this lake has no survey of its own.';
    else if (year - ev.latestYear > 8) s += ` Wide because the last survey was ${ev.latestYear}.`;
    else if (ev.ownWeight < 0.3) s += ' Wide because it leans on similar lakes.';
  }
  return s;
}

/** Links behind the estimate: each survey (newest first), then the lake's own page. */
export function sourceLinks(lake: TileLake, species: SpeciesCode): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const s of lake.sp[species]?.evidence.sources ?? []) {
    const label = `${s.date.slice(0, 4)} ${s.type || 'survey'}${s.gear ? ` (${s.gear.toLowerCase()})` : ''}`;
    const key = `${label}|${s.url}`;
    if (seen.has(key) || !s.url) continue;
    seen.add(key);
    out.push({ label, url: s.url });
  }
  const page = lake.sourceUrl || (lake.key.startsWith('mn:') ? lakeFinderPage(lake.key.slice(3)) : '');
  if (page && !out.some((o) => o.url === page)) out.push({ label: lake.state === 'MN' ? 'LakeFinder page' : 'GFP fishery reports', url: page });
  return out;
}
