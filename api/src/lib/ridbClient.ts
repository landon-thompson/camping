/**
 * A thin, defensive client for the documented RIDB (Recreation Information
 * Database) Facilities endpoint — https://ridb.recreation.gov/api/v1/facilities
 * (see https://ridb.recreation.gov/docs). We only ever read facilities, never
 * write, book or scrape availability: this is the same public search RIDB
 * publishes for exactly this purpose.
 */

export const RIDB_BASE_URL = 'https://ridb.recreation.gov/api/v1';

export interface RidbFacility {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  description: string;
  reservationUrl: string;
}

export class RidbConfigError extends Error {}
export class RidbUpstreamError extends Error {}

export interface FetchFacilitiesOptions {
  apiKey: string;
  query: string;
  state: string;
  limit: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** GET /facilities?query=&state=&limit= with the documented `apikey` header, trimmed to what the UI needs. */
export async function fetchFacilities(opts: FetchFacilitiesOptions): Promise<RidbFacility[]> {
  if (!opts.apiKey) throw new RidbConfigError('RIDB_API_KEY is not set.');

  const url = new URL(`${RIDB_BASE_URL}/facilities`);
  if (opts.query) url.searchParams.set('query', opts.query);
  if (opts.state) url.searchParams.set('state', opts.state);
  url.searchParams.set('limit', String(opts.limit));

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), { headers: { apikey: opts.apiKey, accept: 'application/json' } });
  } catch (e) {
    throw new RidbUpstreamError(`Could not reach Recreation.gov: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    throw new RidbUpstreamError(`Recreation.gov (RIDB) returned ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new RidbUpstreamError('Recreation.gov (RIDB) returned an unreadable response.');
  }

  const items = isRecord(body) && Array.isArray(body.RECDATA) ? body.RECDATA : [];
  const out: RidbFacility[] = [];
  for (const item of items) {
    const f = toFacility(item);
    if (f) out.push(f);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toFacility(raw: unknown): RidbFacility | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.FacilityID === 'string' || typeof raw.FacilityID === 'number' ? String(raw.FacilityID) : null;
  const name = typeof raw.FacilityName === 'string' ? raw.FacilityName.trim() : '';
  if (!id || !name) return null;
  const lat = typeof raw.FacilityLatitude === 'number' && Number.isFinite(raw.FacilityLatitude) ? raw.FacilityLatitude : null;
  const lng = typeof raw.FacilityLongitude === 'number' && Number.isFinite(raw.FacilityLongitude) ? raw.FacilityLongitude : null;
  const description = typeof raw.FacilityDescription === 'string' ? stripHtml(raw.FacilityDescription).slice(0, 400) : '';
  const reservationUrl =
    typeof raw.FacilityReservationURL === 'string' && raw.FacilityReservationURL
      ? raw.FacilityReservationURL
      : `https://www.recreation.gov/camping/campgrounds/${id}`;
  return { id, name, lat, lng, description, reservationUrl };
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}
