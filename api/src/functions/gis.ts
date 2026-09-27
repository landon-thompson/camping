import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { allowedGisUrl, MAX_GIS_BYTES } from '../lib/gisProxy';

const json = (status: number, body: unknown): HttpResponseInit => ({ status, jsonBody: body, headers: { 'cache-control': 'no-store' } });

/** GET /api/gis?url=<allowlisted state GIS URL> — fetches official park data for the app (family only). */
export async function gisProxy(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const target = allowedGisUrl(req.query.get('url'));
  if (!target) return json(400, { error: 'That map service address isn’t allowed.' });
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json', 'user-agent': 'CampPlanner/1.0 (family trip planner; reads public park, lake and boat launch data)' } });
    const text = await res.text();
    if (text.length > MAX_GIS_BYTES) return json(502, { error: 'The map service sent too much data.' });
    return {
      status: res.ok ? 200 : 502,
      body: res.ok ? text : JSON.stringify({ error: `The map service answered ${res.status} ${res.statusText}`.trim() }),
      headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' },
    };
  } catch (e) {
    ctx.warn('gis fetch failed', e);
    const why = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown';
    return json(502, { error: `Server couldn’t reach it (${why}).` });
  }
}

app.http('gis', { route: 'gis', methods: ['GET'], authLevel: 'anonymous', handler: gisProxy });
