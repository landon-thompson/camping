import { z } from 'zod';
import { latLng } from './core';

/** A public boat launch (DNR public water access data), cached near a trip. */
export const boatLaunchSiteSchema = latLng.extend({
  name: z.string(),
  /** Lake or river it launches into. */
  water: z.string(),
  /** DNR lake id (DOW number, 8 digits) when the data gives one. */
  dow: z.string().nullable(),
  ramp: z.string(),
  manager: z.string(),
  distanceKm: z.number(),
});
export type BoatLaunchSite = z.infer<typeof boatLaunchSiteSchema>;

export const nearbyLakeSchema = z.object({
  dow: z.string().regex(/^\d{8}$/),
  name: z.string(),
  county: z.string(),
  /** A point on/at the lake when known (LakeFinder, or a launch on it). */
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});
export type NearbyLake = z.infer<typeof nearbyLakeSchema>;

/**
 * Official data found around one trip's location (`trip_nearby:<tripId>`), kept
 * so it works offline. Separate from the trip record so a refresh never
 * overwrites trip edits.
 */
export const tripNearbySchema = z.object({
  tripId: z.string(),
  /** The location these results are for; refreshed when the trip moves. */
  anchor: latLng,
  fetchedAt: z.string(),
  launches: z.array(boatLaunchSiteSchema),
  lakes: z.array(nearbyLakeSchema),
  /** Lakes the owner wants fishing info for (DOW numbers). */
  selectedLakes: z.array(z.string()),
  /** What each source returned, for when something didn't load. */
  report: z.array(z.string()),
  /** How far out lakes and launches were searched (older records lack it → refetch). */
  radiusKm: z.number().optional(),
});
export type TripNearby = z.infer<typeof tripNearbySchema>;

export const fishCatchSchema = z.object({
  /** DNR species code, e.g. WAE (walleye). */
  species: z.string(),
  gear: z.string(),
  gearCount: z.number().nullable(),
  totalCatch: z.number().nullable(),
  /** Catch per unit effort: fish per net (or per hour of electrofishing). */
  cpue: z.number().nullable(),
  /** DNR's typical range for similar lakes (25th–75th percentile), if given. */
  normalLow: z.number().nullable(),
  normalHigh: z.number().nullable(),
  avgWeightLb: z.number().nullable(),
  /** DNR's typical average-weight range for similar lakes (lb), if given. */
  normalWeightLow: z.number().nullable().optional(),
  normalWeightHigh: z.number().nullable().optional(),
});
export type FishCatch = z.infer<typeof fishCatchSchema>;

/** One lake's DNR fish surveys (`lake_survey:<dow>`), cached from LakeFinder. */
export const lakeSurveySchema = z.object({
  dow: z.string().regex(/^\d{8}$/),
  lakeName: z.string(),
  fetchedAt: z.string(),
  /** Parser version; older cached surveys are refreshed in the background. */
  v: z.number().optional(),
  surveys: z.array(
    z.object({
      date: z.string(),
      type: z.string(),
      catches: z.array(fishCatchSchema),
    }),
  ),
});
export type LakeSurvey = z.infer<typeof lakeSurveySchema>;
