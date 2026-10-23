import { z } from 'zod';
import { isoDate } from './core';

/**
 * Lake recommender: the family's own fishing log. One record per outing
 * (`fishing_log:<uuid>`), so two phones logging the same day never conflict.
 * It syncs like every other record; it is never committed to the (public) repo.
 */
export const fishingLogSchema = z.object({
  /** `mn:<8-digit DOW>` or `sd:<slug>` — same keys as the lake model (docs/LAKE_RECS_PLAN.md). */
  lakeKey: z.string().regex(/^(mn:\d{8}|sd:[a-z0-9-]+)$/),
  lakeName: z.string(),
  tripId: z.string().nullable(),
  date: isoDate,
  /** Hours fished (boat time, all anglers together count once). */
  hours: z.number().min(0).max(24),
  anglers: z.number().int().min(1).max(12),
  /** Fish caught by species (DNR species codes, e.g. WAE). Zero counts matter: "4 hrs, 0 walleye" is evidence too. */
  catches: z.array(z.object({ species: z.string().regex(/^[A-Z]{3}$/), count: z.number().int().min(0).max(999) })),
  /** Species we were trying for (a 0 for these is informative even if not listed in catches). */
  targetSpecies: z.array(z.string().regex(/^[A-Z]{3}$/)),
  /** How the outing felt overall, 1–5 (launch, crowding, scenery), or null. Feeds the small "family history" term. */
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string(),
});
export type FishingLog = z.infer<typeof fishingLogSchema>;
