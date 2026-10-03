/** A random 32-byte, base64url token. Long and random enough to be the whole secret. (Web Crypto: Node and Workers.) */
export function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TRIP_ID_RE = /^trip:[A-Za-z0-9_-]{1,120}$/;

/** True for a well-formed trip record id (never trust the request body's shape otherwise). */
export function isValidTripId(id: unknown): id is string {
  return typeof id === 'string' && TRIP_ID_RE.test(id);
}

/**
 * The public share payload never carries a confirmation number or cost —
 * only what's needed to find the site and get there.
 */
export interface PublicReservation {
  status: string;
  arrivalDate: string | null;
  nights: number | null;
  site: string;
}

export function redactReservation(r: unknown): PublicReservation | null {
  if (!r || typeof r !== 'object') return null;
  const rec = r as Record<string, unknown>;
  return {
    status: typeof rec.status === 'string' ? rec.status : 'planned',
    arrivalDate: typeof rec.arrivalDate === 'string' ? rec.arrivalDate : null,
    nights: typeof rec.nights === 'number' ? rec.nights : null,
    site: typeof rec.site === 'string' ? rec.site : '',
  };
}
