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
 * Every record type the app stores. Each record syncs independently, so keep
 * them fine-grained (one checklist item = one record) to avoid edit conflicts.
 */
export const recordSchemas = {
  settings: settingsSchema,
  vehicle: vehicleSchema,
  trailer: trailerSchema,
} as const;

export type RecordType = keyof typeof recordSchemas;
export type RecordData<T extends RecordType> = z.infer<(typeof recordSchemas)[T]>;

export function isRecordType(t: string): t is RecordType {
  return Object.hasOwn(recordSchemas, t);
}
