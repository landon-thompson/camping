import type { ChecklistTemplate, Debrief, Gear, Trip, TripChecklistItem } from '../../model/schemas';
import { isEarlierTrip } from './utils';

type GenChecklistItem = Omit<TripChecklistItem, 'checked' | 'checkedBy'>;

/** Case/space-insensitive key used to dedupe checklist text across sources. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Templates that apply to a trip: kind 'all', kind 'departure', or one of the trip's own kinds. */
export function templatesForTrip(
  trip: Pick<Trip, 'kinds'>,
  templates: { id: string; data: ChecklistTemplate }[],
): { id: string; data: ChecklistTemplate }[] {
  return templates.filter((t) => t.data.kind === 'all' || t.data.kind === 'departure' || trip.kinds.includes(t.data.kind));
}

/**
 * Debriefs belonging to trips that come before `trip` (earlier startDate, else
 * a lower level) — the source for the "Forgot last time" checklist group.
 */
export function pastDebriefsFor(
  trip: { id: string; data: Trip },
  allTrips: { id: string; data: Trip }[],
  allDebriefs: { data: Debrief }[],
): Debrief[] {
  const earlierTripIds = new Set(
    allTrips.filter((t) => t.id !== trip.id && isEarlierTrip(t.data, trip.data)).map((t) => t.id),
  );
  return allDebriefs.filter((d) => earlierTripIds.has(d.data.tripId)).map((d) => d.data);
}

/**
 * CONTRACT (Phase 2 implements; Phase 5 relies on it):
 * Build a trip's checklist from the checklist templates matching the trip's
 * kinds (plus 'all' and 'departure'), the trip's gear, and every `forgot`
 * entry from debriefs of EARLIER trips (source: 'forgot').
 *
 * Stable order: template items (in template, then item order), then trip gear
 * (in gearIds order), then "forgot" items (in pastDebriefs order). Text is
 * deduped (case/space-insensitive) — the first source to add a line keeps it.
 */
export function generateChecklist(
  tripId: string,
  trip: Trip,
  templates: { id: string; data: ChecklistTemplate }[],
  gear: { id: string; data: Gear }[],
  pastDebriefs: Debrief[],
): GenChecklistItem[] {
  const out: GenChecklistItem[] = [];
  const seen = new Set<string>();
  let order = 0;

  const add = (text: string, source: TripChecklistItem['source'], sourceId: string | null, group: string) => {
    const key = normalize(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ tripId, text: text.trim(), source, sourceId, group, order: order++ });
  };

  for (const t of templatesForTrip(trip, templates)) {
    for (const item of t.data.items) add(item.text, 'template', item.id, t.data.name);
  }
  for (const gearId of trip.gearIds) {
    const g = gear.find((x) => x.id === gearId);
    if (g) add(g.data.name, 'gear', gearId, 'Gear');
  }
  for (const debrief of pastDebriefs) {
    for (const text of debrief.forgot) add(text, 'forgot', null, 'Forgot last time');
  }

  return out;
}

/**
 * "Refresh": the freshly generated lines that aren't already on the trip
 * (matched by normalized text). Existing lines — including checked state and
 * custom, hand-typed ones — are never touched or removed.
 */
export function missingChecklistItems(existing: TripChecklistItem[], generated: GenChecklistItem[]): GenChecklistItem[] {
  const have = new Set(existing.map((i) => normalize(i.text)));
  let order = existing.reduce((max, i) => Math.max(max, i.order), -1) + 1;
  const out: GenChecklistItem[] = [];
  for (const item of generated) {
    const key = normalize(item.text);
    if (!key || have.has(key)) continue;
    have.add(key);
    out.push({ ...item, order: order++ });
  }
  return out;
}
