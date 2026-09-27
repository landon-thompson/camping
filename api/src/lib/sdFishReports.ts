/**
 * South Dakota GFP lake survey reports (apps.sd.gov/GF56FisheriesReports):
 * find a lake's newest "Survey Summary" PDF, read its text, and pull out the
 * summary sentences and fish caught per net by species. Official public
 * reports; the app shows what it could read and always links the PDF.
 */
export const SD_REPORTS_BASE = 'https://apps.sd.gov/GF56FisheriesReports/';
export const reportListUrl = (water: string) => `${SD_REPORTS_BASE}?Waterbody=${encodeURIComponent(water).replace(/%20/g, '+')}`;
export const reportPdfUrl = (id: string) => `${SD_REPORTS_BASE}ExportPDF.ashx?ReportID=${id}`;

export const MAX_PDF_BYTES = 12 * 1024 * 1024;

export interface ReportLink {
  id: string;
  text: string;
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Every report PDF linked on a Fishery Reports page, with the link text and a bit of its row for context. */
export function parseReportLinks(html: string): ReportLink[] {
  const out: ReportLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["'][^"']*ExportPDF\.ashx\?ReportID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const id = m[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    // The row before the link usually says what kind of report it is and the year.
    const rowStart = Math.max(html.lastIndexOf('<tr', m.index), html.lastIndexOf('<li', m.index), m.index - 400);
    out.push({ id, text: stripTags(`${html.slice(rowStart, m.index)} ${m[2]}`).slice(-200) });
  }
  return out;
}

/** The newest lake survey among the links (report ids grow over time); creel, stocking and map reports are skipped. */
export function pickSurvey(links: ReportLink[]): ReportLink | null {
  const surveys = links.filter((l) => /survey/i.test(l.text) && !/creel|stocking|map|angler|harvest/i.test(l.text));
  const pool = surveys.length ? surveys : links.filter((l) => !/creel|stocking|map/i.test(l.text));
  return pool.sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null;
}

// ------------------------------------------------------------------ PDF text

interface TextItem {
  str: string;
  transform: number[];
  width?: number;
}

/**
 * unpdf is ESM-only. In the compiled (CommonJS) API a plain import() would be
 * turned into require(), so load it through a real dynamic import; test runners
 * that can't do that get the normal import.
 */
async function loadUnpdf(): Promise<typeof import('unpdf')> {
  try {
    return (await new Function('s', 'return import(s)')('unpdf')) as typeof import('unpdf');
  } catch {
    return import('unpdf');
  }
}

/** PDF text as lines per page: items on the same baseline joined left to right; wide gaps become " | " (table columns). */
export async function pdfLines(data: Uint8Array): Promise<string[][]> {
  const { getDocumentProxy } = await loadUnpdf();
  const pdf = await getDocumentProxy(data);
  const pages: string[][] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) {
    const page = await pdf.getPage(p);
    const content = (await page.getTextContent()) as { items: TextItem[] };
    const rows = new Map<number, TextItem[]>();
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round((it.transform[5] ?? 0) / 2) * 2;
      rows.set(y, [...(rows.get(y) ?? []), it]);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => {
        items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
        let line = '';
        let end = -Infinity;
        for (const it of items) {
          const x = it.transform[4] ?? 0;
          if (line) line += x - end > 12 ? ' | ' : x - end > 1 ? ' ' : '';
          line += it.str.trim();
          end = x + (it.width ?? it.str.length * 5);
        }
        return line.replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean);
    pages.push(lines);
  }
  return pages;
}

// ------------------------------------------------------------------ parsing

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

/** Names to try on the report site: "Enemy Swim Lake" → "Enemy Swim Lake", "Enemy Swim". */
export function waterNameVariants(name: string): string[] {
  const n = name.trim().replace(/\s+/g, ' ');
  const bare = n.replace(/^lake\s+/i, '').replace(/\s+(lake|reservoir|dam)$/i, '');
  return [...new Set([n, bare])].filter((s) => s.length >= 2);
}
