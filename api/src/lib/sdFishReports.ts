/**
 * South Dakota GFP lake survey reports (apps.sd.gov/GF56FisheriesReports):
 * find a lake's newest "Survey Summary" PDF. The app reads the PDF itself
 * (see src/features/fishing/sdParse.ts); the server only finds and fetches it.
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

/** Names to try on the report site: "Enemy Swim Lake" → "Enemy Swim Lake", "Enemy Swim". */
export function waterNameVariants(name: string): string[] {
  const n = name.trim().replace(/\s+/g, ' ');
  const bare = n.replace(/^lake\s+/i, '').replace(/\s+(lake|reservoir|dam)$/i, '');
  return [...new Set([n, bare])].filter((s) => s.length >= 2);
}

export interface FoundSurveys {
  reportId: string;
  url: string;
  listUrl: string;
  /** Lake survey reports for the lake, newest first. */
  surveys: ReportLink[];
}

const UA = { 'user-agent': 'CampPlanner/1.0 (family trip planner; reads public GFP lake survey reports)' };

/** The lake's newest survey report on GFP Fishery Reports (trying "X Lake" and "X"), or null if none. */
export async function findSurveyReports(water: string, fetchFn: typeof fetch = fetch): Promise<FoundSurveys | null> {
  for (const name of waterNameVariants(water)) {
    const listUrl = reportListUrl(name);
    const res = await fetchFn(listUrl, { signal: AbortSignal.timeout(20_000), headers: UA });
    if (!res.ok) continue;
    const links = parseReportLinks((await res.text()).slice(0, 3_000_000));
    const pick = pickSurvey(links);
    if (!pick) continue;
    const surveys = links.filter((l) => /survey/i.test(l.text) && !/creel|stocking|map/i.test(l.text)).sort((a, b) => Number(b.id) - Number(a.id));
    return { reportId: pick.id, url: reportPdfUrl(pick.id), listUrl, surveys: surveys.slice(0, 12) };
  }
  return null;
}

/** Fetch a report PDF (official GFP file), size-capped. */
export async function fetchReportPdf(id: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchFn(reportPdfUrl(id), { signal: AbortSignal.timeout(25_000), headers: UA });
  if (!res.ok) throw new Error(`GFP answered ${res.status} for the report PDF`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) throw new Error('The report PDF is too large');
  return buf;
}
