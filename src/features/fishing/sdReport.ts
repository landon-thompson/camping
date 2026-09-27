import type { SdLakeReport } from '../../model/schemas';

export const sdReportId = (water: string) => `sd_lake_report:${water.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
/** Selected-lake key for a South Dakota water (Minnesota lakes use their DOW number). */
export const sdLakeKey = (water: string) => `sd:${water}`;
export const sdWaterFromKey = (key: string) => (key.startsWith('sd:') ? key.slice(3) : null);

/** Ask the app's server for a lake's newest GFP survey summary (or a given report). */
export async function fetchSdReport(water: string, reportId?: string, fetchFn: typeof fetch = fetch): Promise<SdLakeReport> {
  const q = new URLSearchParams({ water });
  if (reportId) q.set('report', reportId);
  let res: Response;
  try {
    res = await fetchFn(`/api/sdfish?${q}`, { credentials: 'same-origin' });
  } catch {
    throw new Error('Couldn’t reach the app’s server (offline?)');
  }
  if (res.status === 401) throw new Error('Your sign-in expired — tap “Sign in” at the top, then try again');
  if (res.status === 403) throw new Error('This account isn’t invited to the app’s server');
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error(res.status === 404 ? 'The app’s server doesn’t have the South Dakota report reader yet' : `HTTP ${res.status}`);
  const body = (await res.json()) as Partial<SdLakeReport> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return {
    water: body.water ?? water,
    reportId: String(body.reportId ?? ''),
    url: body.url ?? '',
    listUrl: body.listUrl ?? '',
    title: body.title ?? '',
    year: body.year ?? null,
    summary: body.summary ?? [],
    catches: body.catches ?? [],
    surveys: body.surveys ?? [],
    fetchedAt: new Date().toISOString(),
  };
}
