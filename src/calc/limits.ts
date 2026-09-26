/** How close a value is to a limit. "near" = within 10% of it. */
export type LimitStatus = 'ok' | 'near' | 'over' | 'unknown';

export const NEAR_FRACTION = 0.9;

export function limitStatus(used: number, limit: number | null | undefined): LimitStatus {
  if (limit === null || limit === undefined || !(limit > 0)) return 'unknown';
  if (used > limit) return 'over';
  if (used >= limit * NEAR_FRACTION) return 'near';
  return 'ok';
}

export function pctOf(used: number, limit: number | null | undefined): number | null {
  return limit && limit > 0 ? (used / limit) * 100 : null;
}

export function worst(...s: LimitStatus[]): LimitStatus {
  const rank: Record<LimitStatus, number> = { ok: 0, unknown: 1, near: 2, over: 3 };
  return s.reduce((a, b) => (rank[b] > rank[a] ? b : a), 'ok');
}
