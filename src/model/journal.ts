import { z } from 'zod';

/** Phase 5 — trip debriefs and photos. Owned by the journal feature. */

export const debriefSchema = z.object({
  tripId: z.string(),
  /**
   * Things we forgot. The trips feature's checklist generator adds each of
   * these to the NEXT trip's checklist (source: 'forgot').
   */
  forgot: z.array(z.string()),
  /** `gear:*` ids or free text for things we never used. */
  neverUsed: z.array(z.string()),
  wentWell: z.string(),
  improve: z.string(),
  notes: z.string(),
  photoIds: z.array(z.string()),
});
export type Debrief = z.infer<typeof debriefSchema>;

export const photoSchema = z.object({
  /** Path in Azure Blob Storage once uploaded; null while only on this phone. */
  blobPath: z.string().nullable(),
  tripId: z.string().nullable(),
  caption: z.string(),
  takenAt: z.string().nullable(),
  contentType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Photo = z.infer<typeof photoSchema>;
