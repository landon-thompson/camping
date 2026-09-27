import { z } from 'zod';
import { isoDate, latLng, specNumber } from './core';

/** Phase 3 — campground directory, booking rules, reservations. Owned by the reservations feature. */

export const agency = z.enum(['mn-state-park', 'mn-state-forest', 'sd-state-park', 'usfs', 'other']);
export type Agency = z.infer<typeof agency>;

/** How a site is booked. */
export const bookingSystem = z.enum(['reservemn', 'campsd', 'recreation-gov', 'first-come', 'dispersed', 'other']);
export type BookingSystem = z.infer<typeof bookingSystem>;

/**
 * Agency-level booking rules, stored as editable data (never constants).
 * Every value carries a verify status and a source.
 */
export const bookingRuleSchema = z.object({
  agency,
  label: z.string(),
  bookingSystem,
  reservationRequired: z.boolean().nullable(),
  /** Reservations open this many days before arrival (null = no advance booking). */
  windowDays: specNumber,
  /**
   * Some agencies (federal Recreation.gov) publish the window in calendar
   * months rather than a fixed day count, so a month subtracts correctly
   * across short/long months. When set, this takes priority over `windowDays`.
   */
  windowMonths: specNumber.nullable().optional(),
  /** Local opening time on the first day, "HH:MM", in `timeZone`. */
  openTime: z.string().nullable(),
  timeZone: z.string(),
  /** Rolling window vs. released in blocks. */
  rolling: z.boolean(),
  maxNights: specNumber,
  officialUrl: z.string(),
  phone: z.string(),
  notes: z.array(z.string()),
  source: z.string(),
  status: z.enum(['verified', 'verify']),
});
export type BookingRule = z.infer<typeof bookingRuleSchema>;

export const campgroundSchema = z.object({
  name: z.string().min(1),
  agency,
  bookingSystem,
  /** e.g. "Superior National Forest", "Itasca State Park". */
  unit: z.string(),
  location: latLng.nullable(),
  /** Official page to book or read about it ("Book now" deep link). */
  bookingUrl: z.string(),
  /** Recreation.gov / RIDB facility id, for federal campgrounds. */
  ridbFacilityId: z.string().nullable(),
  /** Overrides the agency rule (e.g. a Recreation.gov facility's own window). */
  windowDaysOverride: specNumber.nullable(),
  /** Overrides the agency rule in calendar months (see `windowMonths`). */
  windowMonthsOverride: specNumber.nullable().optional(),
  electric: z.boolean().nullable(),
  boatLaunch: z.boolean().nullable(),
  rules: z.array(z.string()),
  /** What still needs checking; non-empty → shown as "verify". */
  verify: z.string(),
  source: z.string(),
  notes: z.string(),
});
export type Campground = z.infer<typeof campgroundSchema>;

export const reservationStatus = z.enum(['planned', 'booked', 'waitlisted', 'cancelled']);
export type ReservationStatus = z.infer<typeof reservationStatus>;

export const reservationSchema = z.object({
  tripId: z.string(),
  campgroundId: z.string().nullable(),
  status: reservationStatus,
  arrivalDate: isoDate.nullable(),
  nights: z.number().int().min(1).nullable(),
  confirmation: z.string(),
  site: z.string(),
  costUsd: z.number().min(0).nullable(),
  feesUsd: z.number().min(0).nullable(),
  cancelDeadline: isoDate.nullable(),
  /** Official "notify me" cancellation alert set (when dates are full). */
  notifyMeSet: z.boolean(),
  notes: z.string(),
});
export type Reservation = z.infer<typeof reservationSchema>;

/** Passes/permits, e.g. the MN state park annual vehicle permit. */
export const permitSchema = z.object({
  name: z.string(),
  year: z.number().int(),
  have: z.boolean(),
  expires: isoDate.nullable(),
  notes: z.string(),
});
export type Permit = z.infer<typeof permitSchema>;
