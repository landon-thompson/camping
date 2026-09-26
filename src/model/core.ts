import { z } from 'zod';

/**
 * How much we trust a number. Per the working rules, nothing gets presented as
 * fact unless it came from an official source or our own measurement.
 *  - verified: checked against the official source / sticker / scale ticket
 *  - verify:   from research or an owner report; check before relying on it
 *  - estimate: a placeholder guess; replace with a real measurement
 */
export const specStatus = z.enum(['verified', 'verify', 'estimate']);
export type SpecStatus = z.infer<typeof specStatus>;

export const specNumber = z.object({
  value: z.number().nullable(),
  status: specStatus,
  source: z.string().optional(),
  note: z.string().optional(),
});
export type SpecNumber = z.infer<typeof specNumber>;

export const settingsSchema = z.object({
  householdName: z.string().min(1),
  seasonYear: z.number().int(),
  homeBase: z.object({
    name: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  }),
  people: z.object({
    adults: z.number().int().min(0),
    children: z.number().int().min(0),
    notes: z.string().optional(),
  }),
  /** Season gear budget in USD. Category budgets arrive in Phase 1. */
  seasonBudgetUsd: z.number().min(0),
});
export type Settings = z.infer<typeof settingsSchema>;

export const vehicleSchema = z.object({
  name: z.string().min(1),
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  trim: z.string(),
  payloadLb: specNumber,
  towRatingLb: specNumber,
  roofLimitLb: specNumber,
  features: z.array(z.string()),
  notes: z.array(z.string()),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

export const trailerSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** Boat + motor + fuel + gear + trailer, low and high guesses until weighed. */
  weightLowLb: specNumber,
  weightHighLb: specNumber,
  /** A real scale ticket overrides the estimate range everywhere. */
  scaleTicketLb: specNumber,
  tonguePctMin: z.number().min(0).max(100),
  tonguePctMax: z.number().min(0).max(100),
});
export type Trailer = z.infer<typeof trailerSchema>;

/**
 * Trip types. Used to tag gear and checklist templates, and on each trip.
 * 'all' = every trip; 'departure' = pack-out list.
 */
export const tripKind = z.enum(['all', 'boat', 'no-hookup', 'electric', 'off-grid', 'toddler', 'departure']);
export type TripKind = z.infer<typeof tripKind>;

/** A point on the map. */
export const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type LatLng = z.infer<typeof latLng>;

/** Calendar date, YYYY-MM-DD (no time zone). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

