import type { Cost } from '../../calc/budget';
import type { GearLocation, GearStatus, TripKind } from '../../model/schemas';

/** Pure display/formatting helpers for the gear feature, kept separate so they're easy to test. */

export function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** How a price shows in a gear row: the actual price paid, a research range, or "no price yet". */
export function costLabel(cost: Cost): string {
  if (!cost.known) return 'no price yet';
  if (cost.actual) return formatUsd(cost.mid);
  if (cost.low === cost.high) return formatUsd(cost.low);
  return `$${Math.round(cost.low).toLocaleString('en-US')}–${Math.round(cost.high).toLocaleString('en-US')}`;
}

export function priorityLabel(priority: number | null): string {
  return priority === null ? '—' : `P${priority}`;
}

export const statusLabel: Record<GearStatus, string> = {
  own: 'Own',
  ordered: 'Ordered',
  wishlist: 'Wishlist',
};

export const locationLabel: Record<GearLocation, string> = {
  roof: 'Roof',
  cargo: 'Cargo area',
  cab: 'Cab',
  mounted: 'Mounted',
  boat: 'Boat',
  trailer: 'Trailer',
  home: 'Stays home',
};

export const tripKindLabel: Record<TripKind, string> = {
  all: 'All trips',
  boat: 'Boat',
  'no-hookup': 'No-hookup',
  electric: 'Electric site',
  'off-grid': 'Off-grid',
  toddler: 'Toddler',
  departure: 'Departure',
};

export interface LoadGearInput {
  id: string;
  name: string;
  quantity: number;
  weightLb: number | null;
  location: GearLocation | null;
  status: GearStatus;
}

/**
 * Which gear counts toward the load calculator: everything owned or ordered,
 * plus wishlist items when planning for the full setup.
 */
export function gearForLoad<T extends LoadGearInput>(items: T[], includeWishlist: boolean): T[] {
  return items.filter((g) => g.status === 'own' || g.status === 'ordered' || (includeWishlist && g.status === 'wishlist'));
}
