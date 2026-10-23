import type { RecContext } from './types';

/** Seeds for Adventurous mode: the same draw all day, a new one on "Roll again". */

/** 20270605 for 5 June 2027 (local time on the phone). */
export function localDayKey(d: Date): number {
  return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Mix the day and the roll counter into a 32-bit seed. */
export function seedFor(day: number, roll: number): number {
  let h = Math.imul(day ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(roll + 1, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Stable key for a context, so hooks don't recompute when the caller passes a fresh object each render. */
export function contextKey(ctx: Omit<RecContext, 'seed'> | null): string {
  if (!ctx) return '';
  return [ctx.origin.lat, ctx.origin.lng, ctx.species, ctx.mode, ctx.startDate, ctx.endDate, ctx.towing, ctx.radiusKm ?? ''].join('|');
}
