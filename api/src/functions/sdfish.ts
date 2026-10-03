import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { fetchReportPdf, findSurveyReports } from '../lib/sdFishReports';

const json = (status: number, body: unknown, cache = 'no-store'): HttpResponseInit => ({ status, jsonBody: body, headers: { 'cache-control': cache } });

/**
 * South Dakota GFP lake survey reports (family only). The app reads the PDF
 * itself; the server finds the report and passes the official file along.
 *   GET /api/sdfish/list?water=<lake>  → newest survey + other surveys
 *   GET /api/sdfish/pdf?id=<ReportID>  → the PDF bytes
 */
export async function sdFishList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const water = (req.query.get('water') ?? '').trim();
  if (!/^[\w .'()-]{2,60}$/.test(water)) return json(400, { error: 'Give a lake name.' });
  try {
    const found = await findSurveyReports(water);
    if (!found) return json(404, { error: `No lake survey report for “${water}” on GFP Fishery Reports.` });
    return json(200, { water, ...found }, 'private, max-age=86400');
  } catch (e) {
    ctx.warn('sdfish list failed', e);
    return json(502, { error: `Couldn’t reach GFP Fishery Reports (${e instanceof Error ? e.message : 'unknown'}).` });
  }
}

export async function sdFishPdf(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const id = req.query.get('id') ?? '';
  if (!/^\d{1,8}$/.test(id)) return json(400, { error: 'Bad report id.' });
  try {
    const body = await fetchReportPdf(id);
    return { status: 200, body, headers: { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=86400' } };
  } catch (e) {
    ctx.warn('sdfish pdf failed', e);
    return json(502, { error: e instanceof Error ? e.message : 'Couldn’t fetch the report.' });
  }
}

app.http('sdfishList', { route: 'sdfish/list', methods: ['GET'], authLevel: 'anonymous', handler: sdFishList });
app.http('sdfishPdf', { route: 'sdfish/pdf', methods: ['GET'], authLevel: 'anonymous', handler: sdFishPdf });
