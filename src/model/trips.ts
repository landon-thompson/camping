import { z } from 'zod';
import { isoDate, latLng, tripKind } from './core';

/** Phase 2 — trips and their checklists. Owned by the trips feature. */

export const tripStatus = z.enum(['idea', 'planned', 'booked', 'done', 'cancelled']);
export type TripStatus = z.infer<typeof tripStatus>;

export const tripSchema = z.object({
  name: z.string().min(1),
  /** Progression level 1 (shakedown) … 5 (off-grid finale). */
  level: z.number().int().min(1).max(5),
  status: tripStatus,
  /** Free-text target from the plan, e.g. "late May / early June". */
  targetWindow: z.string(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  /** Trip types — drive the generated checklist and readiness. */
  kinds: z.array(tripKind),
  towing: z.boolean(),
  /** A `campground:*` record (Phase 3 directory), if chosen. */
  campgroundId: z.string().nullable(),
  /** Where we'll actually be — map pin and weather lookup. */
  location: latLng.extend({ label: z.string() }).nullable(),
  boatLaunch: latLng.extend({ name: z.string() }).nullable(),
  /** `gear:*` records we plan to bring (defaults from kinds). */
  gearIds: z.array(z.string()),
  /** Trip-specific inputs for the power calculator. */
  peakSunHours: z.number().min(0).max(24).nullable(),
  notes: z.string(),
});
export type Trip = z.infer<typeof tripSchema>;

/** One checklist line on one trip — its own record so checking items never conflicts. */
export const tripChecklistItemSchema = z.object({
  tripId: z.string(),
  text: z.string().min(1),
  /** Where it came from: a template, a gear item, a past debrief's "forgot", or typed in. */
  source: z.enum(['template', 'gear', 'forgot', 'custom']),
  sourceId: z.string().nullable(),
  /** Section heading, e.g. the template name. */
  group: z.string(),
  checked: z.boolean(),
  checkedBy: z.string().nullable(),
  order: z.number(),
});
export type TripChecklistItem = z.infer<typeof tripChecklistItemSchema>;

/** A read-only share link for one trip (server also stores the token). */
export const shareLinkSchema = z.object({
  tripId: z.string(),
  token: z.string(),
  revoked: z.boolean(),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;
