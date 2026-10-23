import { fishingLogSchema, type FishingLog } from '../../../model/lakerecs';
import { speciesName } from '../../fishing/lakeSurvey';

/** What the "Log a catch" form holds while editing (strings, so fields can be blank). */
export interface LogDraft {
  date: string;
  hours: string;
  anglers: string;
  /** Species code → typed count. Blank counts for target species mean 0. */
  counts: Record<string, string>;
  targetSpecies: string[];
  rating: number | null;
  notes: string;
}

/** Today's date on this phone, as YYYY-MM-DD (local time, not UTC). */
export function todayIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newDraft(target: string, today: string): LogDraft {
  return { date: today, hours: '2', anglers: '2', counts: { [target]: '0' }, targetSpecies: [target], rating: null, notes: '' };
}

const num = (s: string) => Number(s.trim().replace(',', '.'));

export type DraftResult = { ok: true; log: FishingLog } | { ok: false; errors: string[] };

/** Form → fishing_log record, checked against `fishingLogSchema`, with plain error messages. */
export function draftToLog(draft: LogDraft, lake: { key: string; name: string }, tripId: string | null): DraftResult {
  const errors: string[] = [];
  if (!draft.hours.trim()) errors.push('Enter how many hours you fished.');
  if (!draft.anglers.trim()) errors.push('Enter how many people fished.');

  const catches: FishingLog['catches'] = [];
  for (const [species, raw] of Object.entries(draft.counts)) {
    const blank = !raw.trim();
    if (blank && !draft.targetSpecies.includes(species)) continue;
    catches.push({ species, count: blank ? 0 : num(raw) });
  }

  const candidate = {
    lakeKey: lake.key,
    lakeName: lake.name,
    tripId,
    date: draft.date,
    hours: num(draft.hours),
    anglers: num(draft.anglers),
    catches,
    targetSpecies: draft.targetSpecies,
    rating: draft.rating,
    notes: draft.notes.trim(),
  };
  const parsed = fishingLogSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      const msg =
        field === 'hours'
          ? 'Hours must be a number from 0 to 24.'
          : field === 'anglers'
            ? 'People fishing must be a whole number from 1 to 12.'
            : field === 'date'
              ? 'Pick a date.'
              : field === 'catches'
                ? 'Fish counts must be whole numbers from 0 to 999.'
                : field === 'rating'
                  ? 'Rating must be 1 to 5.'
                  : field === 'lakeKey'
                    ? 'This lake has no official id, so it can’t be logged.'
                    : `Check “${field || 'the form'}”.`;
      if (!errors.includes(msg)) errors.push(msg);
    }
    return { ok: false, errors };
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, log: parsed.data };
}

const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;

/** "2 h · 2 people · 3 walleye, 0 northern pike" for the past-outings list. */
export function logSummary(log: FishingLog): string {
  const fish = log.catches.map((c) => `${c.count} ${speciesName(c.species).toLowerCase()}`).join(', ');
  return [hoursText(log.hours), `${log.anglers} ${log.anglers === 1 ? 'person' : 'people'}`, fish || 'no fish listed'].join(' · ');
}
