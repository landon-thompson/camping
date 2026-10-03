/**
 * Pulls the summary sentences and fish caught per net out of a South Dakota GFP
 * lake survey summary (its text as lines per page). Official public reports;
 * the app shows what it could read and always links the PDF.
 */

export const SD_SPECIES = [
  'Tiger Muskellunge',
  'Muskellunge',
  'Walleye',
  'Sauger',
  'Saugeye',
  'Northern Pike',
  'Yellow Perch',
  'Black Crappie',
  'White Crappie',
  'Bluegill',
  'Pumpkinseed',
  'Green Sunfish',
  'Orangespotted Sunfish',
  'Hybrid Sunfish',
  'Rock Bass',
  'Largemouth Bass',
  'Smallmouth Bass',
  'White Bass',
  'Channel Catfish',
  'Flathead Catfish',
  'Black Bullhead',
  'Yellow Bullhead',
  'Brown Bullhead',
  'Common Carp',
  'White Sucker',
  'Bigmouth Buffalo',
  'Smallmouth Buffalo',
  'Freshwater Drum',
  'Shorthead Redhorse',
  'Rainbow Trout',
  'Brown Trout',
  'Brook Trout',
  'Lake Trout',
  'Cisco',
  'Lake Whitefish',
  'Rainbow Smelt',
  'Gizzard Shad',
  'Spottail Shiner',
  'Golden Shiner',
  'Goldeye',
  'Shortnose Gar',
  'Longnose Gar',
  'Bowfin',
  'Burbot',
];
const SPECIES_ALT = SD_SPECIES.map((s) => s.replace(/ /g, '\\s+')).join('|');
const SPECIES_RE = new RegExp(`\\b(${SPECIES_ALT})s?\\b`, 'i');
const canonical = (s: string) => SD_SPECIES.find((n) => n.toLowerCase() === s.toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '')) ?? s;

export interface SdCatch {
  species: string;
  gear: 'Gill nets' | 'Frame nets' | 'Electrofishing' | 'Other';
  /** Fish per net night (or per hour of electrofishing). */
  cpue: number;
  /** Where it was read: a summary sentence or a table row. */
  from: 'summary' | 'table';
}

export interface SdSurvey {
  title: string;
  year: number | null;
  summary: string[];
  catches: SdCatch[];
}

const gearOf = (s: string): SdCatch['gear'] | null =>
  /gill\s*net/i.test(s) ? 'Gill nets' : /(frame|trap)\s*net/i.test(s) ? 'Frame nets' : /electrofish|boat\s*shock/i.test(s) ? 'Electrofishing' : null;

/** "Walleye numbers were low (1.8/gill net)" → Walleye, Gill nets, 1.8 */
function catchesFromSentence(sentence: string): SdCatch[] {
  const out: SdCatch[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(gill|frame|trap)\s*net/gi;
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
    const before = sentence.slice(0, m.index);
    // The species named closest before the number.
    const names = [...before.matchAll(new RegExp(SPECIES_RE.source, 'gi'))];
    const sp = names.at(-1)?.[1];
    if (!sp) continue;
    out.push({ species: canonical(sp), gear: m[2]!.toLowerCase() === 'gill' ? 'Gill nets' : 'Frame nets', cpue: Number(m[1]), from: 'summary' });
  }
  return out;
}

export function parseSurvey(pages: string[][]): SdSurvey {
  const all = pages.flat();
  const titleLine = all.find((l) => /survey summary|statewide fisheries survey/i.test(l)) ?? all[0] ?? 'Lake survey';
  const yearMatch = all.slice(0, 15).join(' ').match(/\b(19[89]\d|20\d{2})\b/);

  // Summary: page-1 prose before the first table/figure, as sentences.
  const first = pages[0] ?? [];
  const stop = first.findIndex((l) => /^(table|figure)\s*\d/i.test(l));
  const prose = first
    .slice(0, stop >= 0 ? stop : first.length)
    // Prose only: no table columns, no title/heading lines (short and without a full stop).
    .filter((l) => !l.includes(' | ') && l.length > 25 && !/survey summary|statewide fisheries survey/i.test(l) && (l.length > 60 || /[.,;]/.test(l)))
    .join(' ')
    .replace(/\s+/g, ' ');
  const sentences = prose.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim());
  const summary = sentences.filter((s) => SPECIES_RE.test(s) && s.length < 400).slice(0, 10);

  const catches = new Map<string, SdCatch>();
  for (const s of sentences) for (const c of catchesFromSentence(s)) catches.set(`${c.species}|${c.gear}`, c);

  // Tables: a gear heading, then rows starting with a species name followed by numbers (first = CPUE).
  let gear: SdCatch['gear'] | null = null;
  for (const line of all) {
    const g = gearOf(line);
    // A net-type heading is a short line (or a table caption), not a prose sentence.
    if (g && !SPECIES_RE.test(line.split('|')[0] ?? '') && (line.length < 60 || /^table\s*\d/i.test(line))) {
      gear = g;
      continue;
    }
    // A table row: species name, then straight into numbers.
    const m = line.match(new RegExp(`^(${SPECIES_ALT})s?\\b[\\s|]*(-?\\d.*)$`, 'i'));
    if (!m || !gear) continue;
    const nums = (m[2] ?? '').match(/-?\d+(?:\.\d+)?/g);
    const cpue = nums ? Number(nums[0]) : NaN;
    if (!Number.isFinite(cpue) || cpue < 0 || cpue > 2000) continue;
    catches.set(`${canonical(m[1]!)}|${gear}`, { species: canonical(m[1]!), gear, cpue, from: 'table' });
  }

  return {
    title: titleLine.replace(/\s*\|\s*/g, ' ').slice(0, 120),
    year: yearMatch ? Number(yearMatch[1]) : null,
    summary,
    catches: [...catches.values()].sort((a, b) => a.gear.localeCompare(b.gear) || b.cpue - a.cpue),
  };
}

