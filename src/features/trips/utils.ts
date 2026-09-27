import type { Trip, TripKind } from '../../model/schemas';

/** Nights derived from start/end dates. Null if either date is missing or invalid. */
export function tripNights(trip: Pick<Trip, 'startDate' | 'endDate'>): number | null {
  if (!trip.startDate || !trip.endDate) return null;
  const start = Date.parse(`${trip.startDate}T00:00:00Z`);
  const end = Date.parse(`${trip.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Trip ordering used for "earlier trip" comparisons and default sort order:
 * by startDate when both have one (earliest first), a dated trip before an
 * undated one, otherwise by level.
 */
export function compareTripOrder(a: Trip, b: Trip): number {
  if (a.startDate && b.startDate) return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  if (a.startDate && !b.startDate) return -1;
  if (!a.startDate && b.startDate) return 1;
  return a.level - b.level;
}

/** True if `a` happened (or is planned) before `b` — earlier startDate, else a lower level. */
export function isEarlierTrip(a: Trip, b: Trip): boolean {
  return compareTripOrder(a, b) < 0;
}

/** Gear that would be suggested by default: packFor includes 'all' or one of the trip's kinds. */
export function defaultGearIds(trip: Pick<Trip, 'kinds'>, gear: { id: string; data: { packFor: TripKind[] } }[]): string[] {
  return gear.filter((g) => g.data.packFor.includes('all') || g.data.packFor.some((k) => trip.kinds.includes(k))).map((g) => g.id);
}

/**
 * Shared color scale for a 0–100 readiness (or part) score, used by the trip
 * cards' readiness bar, the trip page header chip and the readiness card.
 */
export function readinessTextColor(score: number): string {
  if (score >= 80) return 'text-ok';
  if (score >= 50) return 'text-warn';
  return 'text-bad';
}

export function readinessBarColor(score: number): string {
  if (score >= 80) return 'bg-ok';
  if (score >= 50) return 'bg-warn';
  return 'bg-bad';
}

export function readinessChipStyle(score: number): string {
  if (score >= 80) return 'bg-ok/10 text-ok';
  if (score >= 50) return 'bg-warn-bg text-warn';
  return 'bg-bad-bg text-bad';
}
