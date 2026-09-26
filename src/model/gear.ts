import { z } from 'zod';
import { specNumber, tripKind } from './core';

/** Phase 1 — gear, budget, checklist templates, calculator inputs. */

export const gearStatus = z.enum(['own', 'ordered', 'wishlist']);
export type GearStatus = z.infer<typeof gearStatus>;

/** Where an item rides. Roof, cargo, cab and on-vehicle count against payload. */
export const gearLocation = z.enum(['roof', 'cargo', 'cab', 'mounted', 'boat', 'trailer', 'home']);
export type GearLocation = z.infer<typeof gearLocation>;

export const gearSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string(),
  status: gearStatus,
  /** 1 = buy first. null = not ranked. */
  priority: z.number().int().min(1).max(5).nullable(),
  quantity: z.number().int().min(1),
  /** Research price range (estimate). */
  costLowUsd: z.number().min(0).nullable(),
  costHighUsd: z.number().min(0).nullable(),
  /** What we actually paid; overrides the estimate. */
  costActualUsd: z.number().min(0).nullable(),
  /** Counts toward this season's budget (false for things we already had). */
  inBudget: z.boolean(),
  /** Nice-to-have; left out of planned spending until bought. */
  optional: z.boolean(),
  /** Weight of one unit. */
  weightLb: specNumber,
  /** Running draw in watts, if it uses power. */
  powerW: z.number().min(0).nullable(),
  energyWhPerDay: z.number().min(0).nullable(),
  location: gearLocation.nullable(),
  packFor: z.array(tripKind),
  notes: z.string(),
  /** Anything to check before buying (fit, specs). Shown as a "verify" flag. */
  verify: z.string(),
});
export type Gear = z.infer<typeof gearSchema>;

export const budgetCategorySchema = z.object({
  name: z.string().min(1),
  budgetUsd: z.number().min(0),
  order: z.number(),
});
export type BudgetCategory = z.infer<typeof budgetCategorySchema>;

// ---------------------------------------------------------------- checklists

export const checklistTemplateSchema = z.object({
  name: z.string().min(1),
  kind: tripKind,
  description: z.string(),
  /** Where the items come from, e.g. a law; empty if our own list. */
  source: z.string(),
  items: z.array(z.object({ id: z.string(), text: z.string().min(1) })),
});
export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;

// ---------------------------------------------------------------- calculators

export const loadProfileSchema = z.object({
  people: z.array(z.object({ id: z.string(), label: z.string(), weightLb: specNumber })),
  waterGal: z.number().min(0),
  extraFuelGal: z.number().min(0),
  otherLb: z.number().min(0),
  towing: z.boolean(),
  /** Count gear we haven't bought yet, to plan the full setup. */
  includeWishlist: z.boolean(),
});
export type LoadProfile = z.infer<typeof loadProfileSchema>;

export const powerLoadSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /** Either a daily figure… */
  whPerDay: z.number().min(0).nullable(),
  /** …or watts × hours per day. */
  watts: z.number().min(0).nullable(),
  hoursPerDay: z.number().min(0).max(24).nullable(),
  note: z.string(),
});
export type PowerLoad = z.infer<typeof powerLoadSchema>;

export const powerProfileSchema = z.object({
  batteryName: z.string(),
  batteryWh: specNumber,
  /** Share of capacity you can actually use after inverter/DC losses. */
  usablePct: specNumber,
  startPct: z.number().min(0).max(100),
  loads: z.array(powerLoadSchema),
  solar: z.object({
    enabled: z.boolean(),
    panelW: z.number().min(0),
    peakSunHours: z.number().min(0).max(24),
    efficiencyPct: z.number().min(0).max(100),
  }),
  driveCharge: z.object({ watts: z.number().min(0), hoursPerDay: z.number().min(0).max(24) }),
  tripDays: z.number().int().min(1).max(30),
});
export type PowerProfile = z.infer<typeof powerProfileSchema>;
