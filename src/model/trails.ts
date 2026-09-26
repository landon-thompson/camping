import { z } from 'zod';
import { latLng } from './core';

/** Phase 4 — imported routes and map pins. Owned by the trails feature. */

/** GeoJSON LineString / MultiLineString coordinates ([lng, lat] or [lng, lat, ele]). */
const position = z.array(z.number()).min(2).max(3);

export const routeSchema = z.object({
  tripId: z.string().nullable(),
  name: z.string().min(1),
  /** Where the file came from (the owner's own export). */
  source: z.enum(['onx', 'gaia', 'other']),
  /** Simplified geometry — keep each record well under the 256 KB sync limit. */
  geometry: z.union([
    z.object({ type: z.literal('LineString'), coordinates: z.array(position) }),
    z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position)) }),
  ]),
  distanceMi: z.number().min(0),
  estDriveMin: z.number().min(0).nullable(),
  flags: z.object({ noTrailer: z.boolean(), fourWd: z.boolean(), seasonalMud: z.boolean() }),
  /** Owner's own rating, 1 easy … 5 hard. */
  difficulty: z.number().int().min(1).max(5).nullable(),
  notes: z.string(),
});
export type Route = z.infer<typeof routeSchema>;

export const pinKind = z.enum(['dispersed', 'launch', 'water', 'turnaround', 'other']);
export type PinKind = z.infer<typeof pinKind>;

export const pinSchema = z.object({
  tripId: z.string().nullable(),
  kind: pinKind,
  name: z.string(),
  position: latLng,
  notes: z.string(),
  /** `photo:*` record ids (Phase 5 photo storage). */
  photoIds: z.array(z.string()),
});
export type Pin = z.infer<typeof pinSchema>;
