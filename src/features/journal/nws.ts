/**
 * A minimal client for the National Weather Service's free forecast API
 * (api.weather.gov — no key, no cost). Kept pure/parse-only where possible so
 * it can be unit tested against fixture JSON.
 *
 * IMPORTANT — untested against the live API: api.weather.gov and weather.gov
 * were unreachable from the sandbox this was built in. The shapes below come
 * from NWS's published API docs / OpenAPI spec, not a live response. Try it
 * for real once deployed and adjust field names if anything doesn't match —
 * see docs/phase-5.md.
 *
 * IMPORTANT — User-Agent: NWS asks API callers to send an identifying
 * `User-Agent` header. Browsers refuse to let JavaScript set that header (it's
 * one of the "forbidden" fetch headers), so this client can't comply from a
 * phone's browser. This is a known, unavoidable limitation of calling NWS
 * directly from client-side code — documented rather than worked around.
 */

export interface NwsPeriod {
  name: string;
  startTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  /** 0–100, or null when NWS doesn't report a chance for this period. */
  probabilityOfPrecipitation: number | null;
}

export interface NwsForecast {
  periods: NwsPeriod[];
  /** ms since epoch, when this forecast was fetched (for cache "as of" display). */
  fetchedAt: number;
}

export type NwsErrorKind = 'no-coverage' | 'network' | 'bad-response';

export class NwsError extends Error {
  constructor(
    public kind: NwsErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'NwsError';
  }
}

const POINTS_BASE = 'https://api.weather.gov/points';

/** NWS wants 4 decimal places on point lookups; this also keeps URLs stable for caching. */
function roundCoord(n: number): string {
  return n.toFixed(4);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/** Parses one NWS `properties.periods[]` entry. Returns null for anything unrecognizable
 * rather than throwing, so one odd period can't break the whole forecast. */
export function parsePeriod(raw: unknown): NwsPeriod | null {
  const r = asRecord(raw);
  if (!r || typeof r.name !== 'string') return null;
  let precip: number | null = null;
  const pop = asRecord(r.probabilityOfPrecipitation);
  if (pop && typeof pop.value === 'number') precip = pop.value;
  return {
    name: r.name,
    startTime: typeof r.startTime === 'string' ? r.startTime : '',
    isDaytime: Boolean(r.isDaytime),
    temperature: typeof r.temperature === 'number' ? r.temperature : null,
    temperatureUnit: typeof r.temperatureUnit === 'string' ? r.temperatureUnit : 'F',
    windSpeed: typeof r.windSpeed === 'string' ? r.windSpeed : '',
    windDirection: typeof r.windDirection === 'string' ? r.windDirection : '',
    shortForecast: typeof r.shortForecast === 'string' ? r.shortForecast : '',
    probabilityOfPrecipitation: precip,
  };
}

/** Parses a `/gridpoints/.../forecast` response body into our period list. */
export function parseForecastResponse(body: unknown): NwsPeriod[] {
  const r = asRecord(body);
  const props = asRecord(r?.properties);
  const raw = props?.periods;
  if (!Array.isArray(raw)) throw new NwsError('bad-response', 'Unexpected response from NWS (forecast periods missing).');
  const periods = raw.map(parsePeriod).filter((p): p is NwsPeriod => p !== null);
  return periods;
}

/** Parses a `/points/{lat},{lon}` response body, returning the two forecast URLs it points to. */
export function parsePointsResponse(body: unknown): { forecast: string; forecastHourly: string | null } {
  const r = asRecord(body);
  const props = asRecord(r?.properties);
  const forecast = props?.forecast;
  if (typeof forecast !== 'string') {
    throw new NwsError('bad-response', 'Unexpected response from NWS (points).');
  }
  const forecastHourly = typeof props?.forecastHourly === 'string' ? props.forecastHourly : null;
  return { forecast, forecastHourly };
}

/**
 * Fetch the forecast for one point. Two requests, per the documented NWS flow:
 * `/points/{lat},{lon}` to find the local forecast office's grid endpoint, then
 * that endpoint for the actual periods. (`forecastHourly` is resolved too but
 * not fetched here — the trip page shows the compact multi-day forecast; a
 * future pass could add an hourly view using the same URL.)
 */
export async function fetchNwsForecast(lat: number, lng: number, fetchFn: typeof fetch = fetch): Promise<NwsForecast> {
  const pointsUrl = `${POINTS_BASE}/${roundCoord(lat)},${roundCoord(lng)}`;
  let pointsRes: Response;
  try {
    pointsRes = await fetchFn(pointsUrl, { headers: { accept: 'application/geo+json' } });
  } catch {
    throw new NwsError('network', 'Could not reach the National Weather Service.');
  }
  if (pointsRes.status === 404) {
    throw new NwsError('no-coverage', 'This location is outside NWS coverage (NWS only covers the United States).');
  }
  if (!pointsRes.ok) throw new NwsError('bad-response', `NWS returned an error (points, HTTP ${pointsRes.status}).`);
  const { forecast: forecastUrl } = parsePointsResponse(await pointsRes.json());

  let forecastRes: Response;
  try {
    forecastRes = await fetchFn(forecastUrl, { headers: { accept: 'application/geo+json' } });
  } catch {
    throw new NwsError('network', 'Could not reach the National Weather Service.');
  }
  if (!forecastRes.ok) throw new NwsError('bad-response', `NWS returned an error (forecast, HTTP ${forecastRes.status}).`);
  const periods = parseForecastResponse(await forecastRes.json());
  return { periods, fetchedAt: Date.now() };
}

/** Compact one-line summary for a period, e.g. "Tonight: 54°F, W 10 mph — Chance rain, 30% precip". */
export function formatPeriod(p: NwsPeriod): string {
  const details: string[] = [];
  if (p.temperature !== null) details.push(`${p.temperature}°${p.temperatureUnit}`);
  if (p.windSpeed) details.push(`${p.windDirection} ${p.windSpeed}`.trim());
  const head = details.length > 0 ? `${p.name}: ${details.join(', ')}` : `${p.name}:`;
  const tail = [p.shortForecast, p.probabilityOfPrecipitation !== null ? `${p.probabilityOfPrecipitation}% precip` : null].filter(
    Boolean,
  );
  return tail.length > 0 ? `${head} — ${tail.join(', ')}` : head;
}

/** How long ago a cached forecast was fetched, for the "as of …" note. */
export function formatAsOf(fetchedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - fetchedAt) / 60_000));
  if (minutes < 1) return 'as of just now';
  if (minutes < 60) return `as of ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `as of ${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `as of ${days} day${days === 1 ? '' : 's'} ago`;
}
