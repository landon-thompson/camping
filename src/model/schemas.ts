/**
 * Registry of every record type the app stores, and the one import path for
 * schemas. Each feature owns its own schema file:
 *   core.ts (shared) · gear.ts (Phase 1) · trips.ts (2) · reservations.ts (3)
 *   trails.ts (4) · journal.ts (5)
 * Records sync independently, so keep them fine-grained.
 */
import { settingsSchema, trailerSchema, vehicleSchema } from './core';
import { budgetCategorySchema, checklistTemplateSchema, gearSchema, loadProfileSchema, powerProfileSchema } from './gear';
import { shareLinkSchema, tripChecklistItemSchema, tripSchema } from './trips';
import { bookingRuleSchema, campgroundSchema, permitSchema, reservationSchema } from './reservations';
import { pinSchema, routeSchema } from './trails';
import { debriefSchema, photoSchema } from './journal';
import { lakeSurveySchema, tripNearbySchema } from './places';
import type { z } from 'zod';

export * from './core';
export * from './gear';
export * from './trips';
export * from './reservations';
export * from './trails';
export * from './journal';
export * from './places';

export const recordSchemas = {
  // core
  settings: settingsSchema,
  vehicle: vehicleSchema,
  trailer: trailerSchema,
  // Phase 1
  gear: gearSchema,
  budget_category: budgetCategorySchema,
  checklist_template: checklistTemplateSchema,
  load_profile: loadProfileSchema,
  power_profile: powerProfileSchema,
  // Phase 2
  trip: tripSchema,
  trip_checklist_item: tripChecklistItemSchema,
  share_link: shareLinkSchema,
  // Phase 3
  booking_rule: bookingRuleSchema,
  campground: campgroundSchema,
  reservation: reservationSchema,
  permit: permitSchema,
  // Phase 4
  route: routeSchema,
  pin: pinSchema,
  // Phase 5
  debrief: debriefSchema,
  photo: photoSchema,
  // Lakes & launches
  trip_nearby: tripNearbySchema,
  lake_survey: lakeSurveySchema,
} as const;

export type RecordType = keyof typeof recordSchemas;
export type RecordData<T extends RecordType> = z.infer<(typeof recordSchemas)[T]>;

export function isRecordType(t: string): t is RecordType {
  return Object.hasOwn(recordSchemas, t);
}
