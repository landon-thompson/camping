import type { BookingRule, Campground, Reservation, SpecNumber } from '../../model/schemas';

/**
 * Pure booking-window logic (no I/O, no Date.now() calls) — see booking.test.ts.
 * Dates in/out of the app are ISO calendar dates ("YYYY-MM-DD"); instants are
 * real `Date`s. All wall-clock math (an agency's local open time) goes through
 * `zonedTimeToUtc`, which is DST-safe because it re-derives the UTC offset at
 * the actual instant rather than assuming a fixed offset for the zone.
 */

// ---------------------------------------------------------------------------
// Calendar-date helpers (deliberately timezone-free: a "YYYY-MM-DD" is just a
// calendar date, not an instant, so all arithmetic here uses UTC internally
// purely as a neutral epoch to avoid the host's local timezone leaking in).
// ---------------------------------------------------------------------------

function parseIsoDate(d: string): { y: number; mo: number; day: number } {
  const [y, mo, day] = d.split('-').map(Number);
  return { y: y ?? 0, mo: mo ?? 1, day: day ?? 1 };
}

function toIsoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Add (or subtract, with a negative count) whole days to an ISO calendar date. */
export function addDays(isoDate: string, days: number): string {
  const { y, mo, day } = parseIsoDate(isoDate);
  return toIsoDate(Date.UTC(y, mo - 1, day + days));
}

/**
 * Subtract whole calendar months from an ISO calendar date (e.g. 6 months
 * before 2027-07-15 is 2027-01-15). JS's Date normalizes month underflow and
 * day-of-month overflow (e.g. Mar 31 − 1 month → Mar 3, since Feb has fewer
 * days), which matches how Recreation.gov's rolling window behaves in practice.
 */
export function subtractMonths(isoDate: string, months: number): string {
  const { y, mo, day } = parseIsoDate(isoDate);
  return toIsoDate(Date.UTC(y, mo - 1 - months, day));
}

/** Whole days between two ISO calendar dates (b − a); negative if b is earlier. */
export function daysBetween(a: string, b: string): number {
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  const msPerDay = 86_400_000;
  return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.day) - Date.UTC(pa.y, pa.mo - 1, pa.day)) / msPerDay);
}

// ---------------------------------------------------------------------------
// Timezone-aware instant conversion
// ---------------------------------------------------------------------------

/** The UTC offset (ms) in effect for `instant` when read in `timeZone`. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) if (p.type !== 'literal') parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a local wall-clock date + time in `timeZone` to the real instant
 * (UTC `Date`) it represents. DST-safe: computes the zone's offset at a first
 * guess, then re-derives it at the corrected instant so a transition landing
 * exactly on the requested wall-clock time still resolves correctly.
 */
export function zonedTimeToUtc(isoDate: string, time: string, timeZone: string): Date {
  const { y, mo, day } = parseIsoDate(isoDate);
  const [h, mi] = time.split(':').map(Number);
  const guessUtc = Date.UTC(y, mo - 1, day, h ?? 0, mi ?? 0);
  const offset1 = tzOffsetMs(new Date(guessUtc), timeZone);
  const correctedUtc = guessUtc - offset1;
  const offset2 = tzOffsetMs(new Date(correctedUtc), timeZone);
  return new Date(offset2 === offset1 ? correctedUtc : guessUtc - offset2);
}

/** The calendar date (YYYY-MM-DD) `instant` falls on, read in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(instant); // en-CA formats as YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Booking window
// ---------------------------------------------------------------------------

/**
 * When reservations open for a stay arriving on `arrivalDate`, or null when
 * there is no advance-booking window at all (pay/register on arrival).
 * A campground's own override (e.g. a Recreation.gov facility with a shorter
 * window than the rest of the forest) always wins over the agency rule.
 */
export function bookingOpensAt(arrivalDate: string, rule: BookingRule, campground?: Campground | null): Date | null {
  const months = campground?.windowMonthsOverride?.value ?? rule.windowMonths?.value ?? null;
  const days = campground?.windowDaysOverride?.value ?? (months === null ? rule.windowDays.value : null);
  const openTime = rule.openTime ?? '00:00';

  const openDate = months !== null ? subtractMonths(arrivalDate, months) : days !== null ? addDays(arrivalDate, -days) : null;
  if (openDate === null) return null;
  return zonedTimeToUtc(openDate, openTime, rule.timeZone);
}

export type BookingState = 'no-booking-needed' | 'not-open' | 'opens-today' | 'open' | 'past';

/**
 * Where a stay stands relative to its booking window right now.
 * - `no-booking-needed`: the agency doesn't take reservations for this kind of
 *   site (e.g. first-come state forest sites, dispersed camping).
 * - `past`: the arrival date has already gone by.
 * - `not-open` / `opens-today` / `open`: relative to `opensAt`.
 */
export function bookingState(
  now: Date,
  opensAt: Date | null,
  arrivalDate: string | null,
  opts: { reservationRequired: boolean | null; timeZone: string },
): BookingState {
  if (opts.reservationRequired === false) return 'no-booking-needed';
  if (arrivalDate !== null && daysBetween(localDate(now, opts.timeZone), arrivalDate) < 0) return 'past';
  if (opensAt === null) return 'open';
  if (now.getTime() >= opensAt.getTime()) return 'open';
  return localDate(now, opts.timeZone) === localDate(opensAt, opts.timeZone) ? 'opens-today' : 'not-open';
}

/** Whole days from `now` until `target` (in the agency's timezone), ≥ 0 once open. */
export function daysUntil(now: Date, target: Date, timeZone: string): number {
  return Math.max(0, daysBetween(localDate(now, timeZone), localDate(target, timeZone)));
}

/** "Tue Jan 5, 8:00 AM CST" — for the in-app countdown line. */
export function formatOpensAt(instant: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(instant);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(instant);
  return `${date}, ${time}`;
}

/**
 * Whether a *campground* actually takes advance reservations, independent of
 * its managing agency's general policy. The four seeded `booking_rule`s are
 * one per agency (state park / state forest / USFS / dispersed), but a single
 * agency can run both reservable and first-come sites — e.g. a USFS rustic
 * campground is first-come even though the same Superior National Forest also
 * has Recreation.gov campgrounds. The campground's own `bookingSystem` is the
 * authoritative signal for "does this specific site take reservations at all".
 */
export function campgroundTakesReservations(bookingSystem: Campground['bookingSystem']): boolean {
  return bookingSystem === 'reservemn' || bookingSystem === 'recreation-gov';
}

export interface ResolvedBooking {
  opensAt: Date | null;
  state: BookingState;
}

/**
 * Combines a campground with its agency's booking rule into "when does
 * booking open, and where does this stay stand right now" — the one function
 * every reservations screen calls. `arrivalDate` may be null when a trip
 * doesn't have dates yet.
 */
export function resolveBooking(now: Date, arrivalDate: string | null, rule: BookingRule, campground: Campground): ResolvedBooking {
  const takesReservations = campgroundTakesReservations(campground.bookingSystem);
  const reservationRequired = takesReservations ? rule.reservationRequired : false;
  const opensAt = takesReservations && arrivalDate ? bookingOpensAt(arrivalDate, rule, campground) : null;
  const state = bookingState(now, opensAt, arrivalDate, { reservationRequired, timeZone: rule.timeZone });
  return { opensAt, state };
}

// ---------------------------------------------------------------------------
// Stay-length and cancellation checks
// ---------------------------------------------------------------------------

export interface MaxNightsResult {
  ok: boolean;
  message: string | null;
}

/** Flags a stay that would exceed the agency's per-reservation night limit. */
export function checkMaxNights(nights: number | null, maxNights: SpecNumber): MaxNightsResult {
  if (nights === null || maxNights.value === null) return { ok: true, message: null };
  if (nights > maxNights.value) {
    return {
      ok: false,
      message: `${nights} nights exceeds the ${maxNights.value}-night limit per reservation — you may need to split this into separate bookings.`,
    };
  }
  return { ok: true, message: null };
}

export interface CancelDeadlineInfo {
  daysLeft: number | null;
  /** Deadline has passed. */
  overdue: boolean;
  /** Within the warning window (today through 3 days out) but not overdue. */
  warn: boolean;
}

/** Days left until a reservation's cancellation deadline, for an in-app warning. */
export function cancelDeadlineInfo(today: string, cancelDeadline: string | null, warnWithinDays = 3): CancelDeadlineInfo {
  if (!cancelDeadline) return { daysLeft: null, overdue: false, warn: false };
  const daysLeft = daysBetween(today, cancelDeadline);
  return { daysLeft, overdue: daysLeft < 0, warn: daysLeft >= 0 && daysLeft <= warnWithinDays };
}

// ---------------------------------------------------------------------------
// Book-overview row (one line per trip, sorted by what needs attention)
// ---------------------------------------------------------------------------

export type BookingTone = 'attention' | 'ok' | 'info' | 'neutral';

export interface BookingRowStatus {
  /** e.g. "Booking open now", "Opens in 12 days (Tue Jan 5, 8:00 AM CST)", "Booked (ABC123, site 14)", "No campground yet". */
  label: string;
  /** Lower sorts first — the trip that most needs attention floats to the top. */
  urgency: number;
  tone: BookingTone;
}

/**
 * The one-line status + sort priority for a trip's row on the Book overview.
 * `resolved`/`rule` are undefined/null when there's no campground yet or its
 * dates haven't resolved a booking window; `reservation` is the trip's one
 * `reservation:*` record, if any.
 */
export function bookingRowStatus(
  now: Date,
  hasCampground: boolean,
  resolved: ResolvedBooking | null,
  timeZone: string | undefined,
  reservation: Pick<Reservation, 'status' | 'confirmation' | 'site'> | undefined,
): BookingRowStatus {
  if (reservation?.status === 'booked') {
    const parts = [reservation.confirmation, reservation.site ? `site ${reservation.site}` : ''].filter(Boolean);
    return { label: parts.length ? `Booked (${parts.join(', ')})` : 'Booked', urgency: 4, tone: 'ok' };
  }
  if (!hasCampground) return { label: 'No campground yet', urgency: 0, tone: 'attention' };
  if (reservation?.status === 'waitlisted') return { label: 'Waitlisted', urgency: 1, tone: 'attention' };
  if (!resolved) return { label: 'Set trip dates to see the booking window', urgency: 2, tone: 'neutral' };
  if (resolved.state === 'open' || resolved.state === 'opens-today') return { label: 'Booking open now', urgency: 1, tone: 'ok' };
  if (resolved.state === 'not-open' && resolved.opensAt && timeZone) {
    const days = daysUntil(now, resolved.opensAt, timeZone);
    return { label: `Opens in ${days} day${days === 1 ? '' : 's'} (${formatOpensAt(resolved.opensAt, timeZone)})`, urgency: 2, tone: 'info' };
  }
  if (resolved.state === 'no-booking-needed') return { label: 'No booking needed', urgency: 3, tone: 'neutral' };
  return { label: 'Arrival date has passed', urgency: 5, tone: 'neutral' };
}
