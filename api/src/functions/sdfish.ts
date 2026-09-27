import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { MAX_PDF_BYTES, parseReportLinks, parseSurvey, pdfLines, pickSurvey, reportListUrl, reportPdfUrl, waterNameVariants, type ReportLink } from '../lib/sdFishReports';

const json = (status: number, body: unknown, cache = 'no-store'): HttpResponseInit => ({ status, jsonBody: body, headers: { 'cache-control': cache } });
const UA = { 'user-agent': 'CampPlanner/1.0 (family trip planner; reads public GFP lake survey reports)' };

/**
 * GET /api/sdfish?water=<lake name>[&report=<ReportID>] — the newest South Dakota
 * GFP lake survey summary for a lake, read from its official PDF (family only).
 */
export async function sdFish(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const water = (req.query.get('water') ?? '').trim();
  const report = req.query.get('report');
  if (!/^[\w .'()-]{2,60}$/.test(water)) return json(400, { error: 'Give a lake name.' });
  if (report !== null && !/^\d{1,8}$/.test(report)) return json(400, { error: 'Bad report id.' });

  try {
    let surveys: ReportLink[] = [];
    let listUrl = reportListUrl(water);
    let chosen: string | null = report;
    if (!chosen) {
      for (const name of waterNameVariants(water)) {
        listUrl = reportListUrl(name);
        const res = await fetch(listUrl, { signal: AbortSignal.timeout(20_000), headers: UA });
        if (!res.ok) continue;
        const html = (await res.text()).slice(0, 3_000_000);
        const links = parseReportLinks(html);
        surveys = links.filter((l) => /survey/i.test(l.text) && !/creel|stocking|map/i.test(l.text));
        const pick = pickSurvey(links);
        if (pick) {
          chosen = pick.id;
          break;
        }
      }
    }
    if (!chosen) return json(404, { error: `No lake survey report for “${water}” on GFP Fishery Reports.`, listUrl });

    const url = reportPdfUrl(chosen);
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: UA });
    if (!res.ok) return json(502, { error: `GFP answered ${res.status} for the report PDF.`, url });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) return json(502, { error: 'The report PDF is too large to read here.', url });
    const survey = parseSurvey(await pdfLines(buf));
    return json(
      200,
      { water, reportId: chosen, url, listUrl, ...survey, surveys: surveys.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 12) },
      'private, max-age=86400',
    );
  } catch (e) {
    ctx.warn('sdfish failed', e);
    const why = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown';
    return json(502, { error: `Couldn’t read the GFP report (${why}).` });
  }
}

app.http('sdfish', { route: 'sdfish', methods: ['GET'], authLevel: 'anonymous', handler: sdFish });
