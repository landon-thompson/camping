import { describe, expect, it } from 'vitest';
import {
  addDays,
  bookingOpensAt,
  bookingState,
  campgroundTakesReservations,
  cancelDeadlineInfo,
  checkMaxNights,
  daysBetween,
  daysUntil,
  formatOpensAt,
  localDate,
  resolveBooking,
  subtractMonths,
  zonedTimeToUtc,
} from './booking';
import type { BookingRule, Campground } from '../../model/schemas';

const stateParkRule: BookingRule = {
  agency: 'mn-state-park',
  label: 'Minnesota state park',
  bookingSystem: 'reservemn',
  reservationRequired: true,
  windowDays: { value: 120, status: 'verify', source: 'search' },
  windowMonths: null,
  openTime: '08:00',
  timeZone: 'America/Chicago',
  rolling: true,
  maxNights: { value: 14, status: 'verify' },
  officialUrl: 'https://www.mndnr.gov/reservations',
  phone: '866-857-2757',
  notes: [],
  source: 'search',
  status: 'verify',
};

const usfsRule: BookingRule = {
  agency: 'usfs',
  label: 'US Forest Service (Recreation.gov)',
  bookingSystem: 'recreation-gov',
  reservationRequired: true,
  windowDays: { value: null, status: 'verify' },
  windowMonths: { value: 6, status: 'verify', source: 'search' },
  openTime: '10:00',
  timeZone: 'America/New_York',
  rolling: true,
  maxNights: { value: 14, status: 'verify' },
  officialUrl: 'https://www.recreation.gov/',
  phone: '877-444-6777',
  notes: [],
  source: 'search',
  status: 'verify',
};

const firstComeRule: BookingRule = {
  agency: 'mn-state-forest',
  label: 'Minnesota state forest (individual site)',
  bookingSystem: 'first-come',
  reservationRequired: false,
  windowDays: { value: null, status: 'verify' },
  windowMonths: null,
  openTime: null,
  timeZone: 'America/Chicago',
  rolling: false,
  maxNights: { value: null, status: 'verify' },
  officialUrl: 'https://www.mndnr.gov/reservations',
  phone: '866-857-2757',
  notes: ['Pay before occupying a site — no advance reservation for individual sites.'],
  source: 'search',
  status: 'verify',
};

function campground(overrides: Partial<Campground> = {}): Campground {
  return {
    name: 'Test campground',
    agency: 'usfs',
    bookingSystem: 'recreation-gov',
    unit: 'Test forest',
    location: null,
    bookingUrl: 'https://www.recreation.gov/camping/campgrounds/1',
    ridbFacilityId: '1',
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: null,
    boatLaunch: null,
    rules: [],
    verify: '',
    source: '',
    notes: '',
    ...overrides,
  };
}

describe('calendar-date helpers', () => {
  it('adds and subtracts days across month/year boundaries', () => {
    expect(addDays('2027-07-04', -120)).toBe('2027-03-06');
    expect(addDays('2028-03-10', -120)).toBe('2027-11-11');
    expect(addDays('2027-01-10', -120)).toBe('2026-09-12');
  });

  it('subtracts calendar months, normalizing day overflow like Recreation.gov', () => {
    expect(subtractMonths('2027-07-15', 6)).toBe('2027-01-15');
    // Aug 31 − 6 months would be "Feb 31", which doesn't exist in 2027 (not a leap year).
    expect(subtractMonths('2027-08-31', 6)).toBe('2027-03-03');
  });

  it('computes whole days between two dates', () => {
    expect(daysBetween('2027-01-01', '2027-01-01')).toBe(0);
    expect(daysBetween('2027-01-01', '2027-01-05')).toBe(4);
    expect(daysBetween('2027-01-05', '2027-01-01')).toBe(-4);
  });
});

describe('zonedTimeToUtc (DST safety)', () => {
  // America/Chicago: CST (UTC−6) through Mar 13, 2027; CDT (UTC−5) from Mar 14
  // through Nov 6, 2027; CST again from Nov 7, 2027.
  it('uses the standard-time offset before the spring-forward transition', () => {
    expect(zonedTimeToUtc('2027-03-06', '08:00', 'America/Chicago').toISOString()).toBe('2027-03-06T14:00:00.000Z');
  });

  it('uses the daylight-time offset after the spring-forward transition', () => {
    expect(zonedTimeToUtc('2027-04-03', '08:00', 'America/Chicago').toISOString()).toBe('2027-04-03T13:00:00.000Z');
  });

  it('uses the daylight-time offset just before the fall-back transition', () => {
    expect(zonedTimeToUtc('2027-11-01', '08:00', 'America/Chicago').toISOString()).toBe('2027-11-01T13:00:00.000Z');
  });

  it('uses the standard-time offset just after the fall-back transition', () => {
    expect(zonedTimeToUtc('2027-11-10', '08:00', 'America/Chicago').toISOString()).toBe('2027-11-10T14:00:00.000Z');
  });

  it('is correct in a second timezone (America/New_York) on both sides of the transition', () => {
    expect(zonedTimeToUtc('2027-03-01', '10:00', 'America/New_York').toISOString()).toBe('2027-03-01T15:00:00.000Z');
    expect(zonedTimeToUtc('2027-04-01', '10:00', 'America/New_York').toISOString()).toBe('2027-04-01T14:00:00.000Z');
  });
});

describe('localDate', () => {
  it('reads the calendar date of an instant in a given zone, not UTC', () => {
    // 2027-01-01T02:00:00Z is still Dec 31 in Chicago (CST, UTC−6).
    expect(localDate(new Date('2027-01-01T02:00:00Z'), 'America/Chicago')).toBe('2026-12-31');
    expect(localDate(new Date('2027-01-01T02:00:00Z'), 'UTC')).toBe('2027-01-01');
  });
});

describe('bookingOpensAt', () => {
  it('opens 120 days before arrival at the rule’s local time (day-count rule, crossing DST)', () => {
    expect(bookingOpensAt('2027-07-04', stateParkRule)!.toISOString()).toBe('2027-03-06T14:00:00.000Z');
    expect(bookingOpensAt('2028-03-10', stateParkRule)!.toISOString()).toBe('2027-11-11T14:00:00.000Z');
  });

  it('opens 6 calendar months before arrival (month-count rule)', () => {
    expect(bookingOpensAt('2027-07-15', usfsRule)!.toISOString()).toBe('2027-01-15T15:00:00.000Z');
  });

  it('returns null when the agency takes no advance reservations', () => {
    expect(bookingOpensAt('2027-07-15', firstComeRule)).toBeNull();
  });

  it('lets a campground’s day override replace the agency’s day window', () => {
    const cg = campground({ agency: 'mn-state-park', windowDaysOverride: { value: 30, status: 'verify' } });
    expect(bookingOpensAt('2027-07-04', stateParkRule, cg)!.toISOString()).toBe(
      zonedTimeToUtc(addDays('2027-07-04', -30), '08:00', 'America/Chicago').toISOString(),
    );
  });

  it('lets a campground’s month override replace the agency’s month window', () => {
    const cg = campground({ windowMonthsOverride: { value: 2, status: 'verify' } });
    expect(bookingOpensAt('2027-07-15', usfsRule, cg)!.toISOString()).toBe(
      zonedTimeToUtc(subtractMonths('2027-07-15', 2), '10:00', 'America/New_York').toISOString(),
    );
  });
});

describe('bookingState', () => {
  const opts = (r: BookingRule) => ({ reservationRequired: r.reservationRequired, timeZone: r.timeZone });

  it('is no-booking-needed whenever the agency does not require a reservation, regardless of dates', () => {
    expect(bookingState(new Date('2027-01-01T00:00:00Z'), null, '2027-07-15', opts(firstComeRule))).toBe('no-booking-needed');
  });

  it('is past once the arrival date has gone by', () => {
    const now = new Date('2027-07-16T12:00:00Z');
    const opensAt = bookingOpensAt('2027-07-15', stateParkRule)!;
    expect(bookingState(now, opensAt, '2027-07-15', opts(stateParkRule))).toBe('past');
  });

  it('is not-open while now is before the opening instant on an earlier calendar day', () => {
    const opensAt = bookingOpensAt('2027-07-15', stateParkRule)!; // 2027-03-17T13:00:00.000Z (CDT)
    const now = new Date('2027-03-16T12:00:00Z');
    expect(bookingState(now, opensAt, '2027-07-15', opts(stateParkRule))).toBe('not-open');
  });

  it('is opens-today on the opening calendar day before the opening instant', () => {
    const opensAt = bookingOpensAt('2027-07-15', stateParkRule)!; // 2027-03-17T13:00:00.000Z Chicago (08:00 local, CDT)
    const now = new Date('2027-03-17T10:00:00Z'); // same Chicago calendar day, before the opening instant
    expect(bookingState(now, opensAt, '2027-07-15', opts(stateParkRule))).toBe('opens-today');
  });

  it('is open once now reaches the opening instant', () => {
    const opensAt = bookingOpensAt('2027-07-15', stateParkRule)!;
    expect(bookingState(opensAt, opensAt, '2027-07-15', opts(stateParkRule))).toBe('open');
    expect(bookingState(new Date(opensAt.getTime() + 1), opensAt, '2027-07-15', opts(stateParkRule))).toBe('open');
  });

  it('is open when there is no window at all but a reservation is still required (e.g. same-day only)', () => {
    expect(bookingState(new Date('2027-01-01T00:00:00Z'), null, null, { reservationRequired: true, timeZone: 'America/Chicago' })).toBe(
      'open',
    );
  });
});

describe('daysUntil', () => {
  it('counts whole days in the target timezone and never goes negative', () => {
    const now = new Date('2027-03-01T00:00:00Z');
    const target = new Date('2027-03-05T14:00:00Z');
    expect(daysUntil(now, target, 'America/Chicago')).toBe(5);
    expect(daysUntil(target, now, 'America/Chicago')).toBe(0);
  });
});

describe('formatOpensAt', () => {
  it('formats the local weekday, date and time with zone abbreviation', () => {
    expect(formatOpensAt(new Date('2027-03-05T14:00:00Z'), 'America/Chicago')).toBe('Fri, Mar 5, 8:00 AM CST');
  });
});

describe('checkMaxNights', () => {
  it('passes when nights are within (or the limit/nights are unknown)', () => {
    expect(checkMaxNights(10, { value: 14, status: 'verify' })).toEqual({ ok: true, message: null });
    expect(checkMaxNights(null, { value: 14, status: 'verify' })).toEqual({ ok: true, message: null });
    expect(checkMaxNights(30, { value: null, status: 'verify' })).toEqual({ ok: true, message: null });
  });

  it('flags a stay longer than the per-reservation limit', () => {
    const r = checkMaxNights(20, { value: 14, status: 'verify' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/14-night limit/);
  });
});

describe('campgroundTakesReservations / resolveBooking', () => {
  it('treats reservemn and recreation-gov campgrounds as reservable, everything else as not', () => {
    expect(campgroundTakesReservations('reservemn')).toBe(true);
    expect(campgroundTakesReservations('recreation-gov')).toBe(true);
    expect(campgroundTakesReservations('first-come')).toBe(false);
    expect(campgroundTakesReservations('dispersed')).toBe(false);
    expect(campgroundTakesReservations('other')).toBe(false);
  });

  it('is no-booking-needed for a first-come USFS campground even though the USFS agency rule itself requires reservations', () => {
    // Regression: a rustic first-come campground shares the same *agency*
    // (usfs) as reservable Recreation.gov campgrounds, but must not inherit
    // that rule's reservationRequired: true.
    const rustic = campground({ agency: 'usfs', bookingSystem: 'first-come' });
    const result = resolveBooking(new Date('2027-01-01T00:00:00Z'), '2027-07-15', usfsRule, rustic);
    expect(result).toEqual({ opensAt: null, state: 'no-booking-needed' });
  });

  it('computes the real window for a reservable campground', () => {
    const reservable = campground({ agency: 'usfs', bookingSystem: 'recreation-gov' });
    const now = new Date('2026-09-26T00:00:00Z');
    const result = resolveBooking(now, '2027-07-15', usfsRule, reservable);
    expect(result.opensAt?.toISOString()).toBe('2027-01-15T15:00:00.000Z');
    expect(result.state).toBe('not-open');
  });

  it('is open with no window when arrivalDate is not yet known', () => {
    const reservable = campground({ agency: 'mn-state-park', bookingSystem: 'reservemn' });
    const result = resolveBooking(new Date('2027-01-01T00:00:00Z'), null, stateParkRule, reservable);
    expect(result).toEqual({ opensAt: null, state: 'open' });
  });
});

describe('cancelDeadlineInfo', () => {
  it('is neutral when there is no deadline', () => {
    expect(cancelDeadlineInfo('2027-06-01', null)).toEqual({ daysLeft: null, overdue: false, warn: false });
  });

  it('warns inside the warning window, flags overdue after, and is quiet well before', () => {
    expect(cancelDeadlineInfo('2027-06-01', '2027-06-10')).toEqual({ daysLeft: 9, overdue: false, warn: false });
    expect(cancelDeadlineInfo('2027-06-08', '2027-06-10')).toEqual({ daysLeft: 2, overdue: false, warn: true });
    expect(cancelDeadlineInfo('2027-06-11', '2027-06-10')).toEqual({ daysLeft: -1, overdue: true, warn: false });
  });
});
