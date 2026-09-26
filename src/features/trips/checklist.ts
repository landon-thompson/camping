import type { ChecklistTemplate, Debrief, Gear, Trip, TripChecklistItem } from '../../model/schemas';

/**
 * CONTRACT (Phase 2 implements; Phase 5 relies on it):
 * Build a trip's checklist from the checklist templates matching the trip's
 * kinds (plus 'all' and 'departure'), the trip's gear, and every `forgot`
 * entry from debriefs of EARLIER trips (source: 'forgot').
 */
export function generateChecklist(
  _tripId: string,
  _trip: Trip,
  _templates: { id: string; data: ChecklistTemplate }[],
  _gear: { id: string; data: Gear }[],
  _pastDebriefs: Debrief[],
): Omit<TripChecklistItem, 'checked' | 'checkedBy'>[] {
  return [];
}
