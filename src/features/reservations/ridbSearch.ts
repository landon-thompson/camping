/** Client for our own `/api/ridb/facilities` proxy — never calls Recreation.gov/RIDB directly from the browser. */

export interface RidbSearchResult {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  description: string;
  reservationUrl: string;
}

export type RidbSearchOutcome = { ok: true; results: RidbSearchResult[] } | { ok: false; error: string };

export async function searchRidbFacilities(query: string, state = 'MN'): Promise<RidbSearchOutcome> {
  const url = `/api/ridb/facilities?query=${encodeURIComponent(query)}&state=${encodeURIComponent(state)}&limit=20`;
  try {
    const res = await fetch(url);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Search failed (${res.status})`;
      return { ok: false, error: message };
    }
    const results = body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results) ? (body as { results: RidbSearchResult[] }).results : [];
    return { ok: true, results };
  } catch {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' };
  }
}
