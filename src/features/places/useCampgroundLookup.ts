import { useState } from 'react';
import { db } from '../../db/local';
import { saveRecord } from '../../db/records';
import type { Campground } from '../../model/schemas';
import { viaAppServer } from '../reservations/stateParks';
import { findCampgroundLocation, withFoundLocation } from './campgroundLocation';

export type LookupState = { state: 'idle' } | { state: 'busy' } | { state: 'found'; source: string } | { state: 'failed'; message: string };

/**
 * Finds a campground's location in official data and saves it on the campground.
 * `onFound` lets the caller move a trip's pin there too.
 */
export function useCampgroundLookup() {
  const [status, setStatus] = useState<LookupState>({ state: 'idle' });
  async function lookup(id: string, cg: Campground, onFound?: (cg: Campground) => Promise<void> | void) {
    setStatus({ state: 'busy' });
    try {
      const r = await findCampgroundLocation(cg, viaAppServer);
      if (!r.ok) {
        setStatus({ state: 'failed', message: r.message });
        return;
      }
      // Re-read so edits made while we waited aren't lost.
      const latest = ((await db.records.get(id))?.data as Campground | undefined) ?? cg;
      const updated = withFoundLocation(latest, r.found);
      await saveRecord('campground', id, updated);
      await onFound?.(updated);
      setStatus({ state: 'found', source: r.found.source });
    } catch (e) {
      setStatus({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { status, lookup };
}
