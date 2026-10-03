import { apiFetch } from '../../lib/apiFetch';
import type { SdLakeReport } from '../../model/schemas';

export const sdReportId = (water: string) => `sd_lake_report:${water.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
/** Selected-lake key for a South Dakota water (Minnesota lakes use their DOW number). */
export const sdLakeKey = (water: string) => `sd:${water}`;
export const sdWaterFromKey = (key: string) => (key.startsWith('sd:') ? key.slice(3) : null);

async function call(url: string, fetchFn: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await apiFetch(url, undefined, fetchFn);
  } catch {
    throw new Error('Couldn’t reach the app’s server (offline, or your sign-in expired — reload the app)');
  }
  if (res.status === 401) throw new Error('Your sign-in expired — tap “Sign in” at the top, then try again');
  if (res.status === 403) throw new Error('This account isn’t invited to the app’s server');
  return res;
}

async function errorOf(res: Response): Promise<Error> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return new Error(res.status === 404 ? 'The app’s server doesn’t have the South Dakota report reader yet' : `HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `HTTP ${res.status}`);
}

interface FoundSurveys {
  water?: string;
  reportId: string;
  url: string;
  listUrl: string;
  surveys: { id: string; text: string }[];
}

/**
 * A lake's newest GFP survey summary (or a given report). The server finds the
 * report and passes the official PDF along; the phone reads it.
 */
export async function fetchSdReport(water: string, reportId?: string, fetchFn: typeof fetch = fetch): Promise<SdLakeReport> {
  const listRes = await call(`/api/sdfish/list?${new URLSearchParams({ water })}`, fetchFn);
  if (!listRes.ok || !(listRes.headers.get('content-type') ?? '').includes('json')) throw await errorOf(listRes);
  const found = (await listRes.json()) as FoundSurveys;
  const id = reportId && /^\d{1,8}$/.test(reportId) ? reportId : found.reportId;

  const pdfRes = await call(`/api/sdfish/pdf?id=${id}`, fetchFn);
  if (!pdfRes.ok) throw await errorOf(pdfRes);
  const bytes = new Uint8Array(await pdfRes.arrayBuffer());
  const [{ pdfLines }, { parseSurvey }] = await Promise.all([import('./sdPdf'), import('./sdParse')]);
  let survey;
  try {
    survey = parseSurvey(await pdfLines(bytes));
  } catch {
    throw new Error('Couldn’t read that report PDF — open it from the link instead');
  }
  return {
    water: found.water ?? water,
    reportId: id,
    url: `https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx?ReportID=${id}`,
    listUrl: found.listUrl ?? '',
    title: survey.title,
    year: survey.year,
    summary: survey.summary,
    catches: survey.catches,
    surveys: found.surveys ?? [],
    fetchedAt: new Date().toISOString(),
  };
}
