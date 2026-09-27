import { describe, expect, it } from 'vitest';
import type { Trip, TripKind } from '../../model/schemas';
import {
  compareTripOrder,
  defaultGearIds,
  isEarlierTrip,
  readinessBarColor,
  readinessChipStyle,
  readinessTextColor,
  tripNights,
} from './utils';

const trip = (over: Partial<Trip> = {}): Trip => ({
  name: 'Trip',
  level: 2,
  status: 'idea',
  targetWindow: '',
  startDate: null,
  endDate: null,
  kinds: [],
  towing: false,
  campgroundId: null,
  location: null,
  boatLaunch: null,
  gearIds: [],
  peakSunHours: null,
  notes: '',
  ...over,
});

describe('tripNights', () => {
  it('is null when either date is missing', () => {
    expect(tripNights(trip())).toBeNull();
    expect(tripNights(trip({ startDate: '2027-06-01' }))).toBeNull();
  });

  it('counts nights between dates', () => {
    expect(tripNights(trip({ startDate: '2027-06-01', endDate: '2027-06-04' }))).toBe(3);
  });

  it('is null for an end date before the start date', () => {
    expect(tripNights(trip({ startDate: '2027-06-04', endDate: '2027-06-01' }))).toBeNull();
  });
});

describe('compareTripOrder', () => {
  it('sorts dated trips by start date', () => {
    const a = trip({ startDate: '2027-05-01' });
    const b = trip({ startDate: '2027-06-01' });
    expect(compareTripOrder(a, b)).toBeLessThan(0);
    expect(compareTripOrder(b, a)).toBeGreaterThan(0);
  });

  it('puts a dated trip before an undated one', () => {
    expect(compareTripOrder(trip({ startDate: '2027-05-01' }), trip())).toBeLessThan(0);
    expect(compareTripOrder(trip(), trip({ startDate: '2027-05-01' }))).toBeGreaterThan(0);
  });

  it('falls back to level when neither has a date', () => {
    expect(compareTripOrder(trip({ level: 1 }), trip({ level: 3 }))).toBeLessThan(0);
  });
});

describe('isEarlierTrip', () => {
  it('matches compareTripOrder', () => {
    expect(isEarlierTrip(trip({ level: 1 }), trip({ level: 2 }))).toBe(true);
    expect(isEarlierTrip(trip({ level: 2 }), trip({ level: 1 }))).toBe(false);
  });
});

describe('defaultGearIds', () => {
  const gear: { id: string; data: { packFor: TripKind[] } }[] = [
    { id: 'g1', data: { packFor: ['all'] } },
    { id: 'g2', data: { packFor: ['boat'] } },
    { id: 'g3', data: { packFor: ['off-grid'] } },
  ];

  it('includes gear packed for all trips plus the trip\'s own kinds', () => {
    expect(defaultGearIds({ kinds: ['boat'] }, gear)).toEqual(['g1', 'g2']);
  });

  it('excludes gear for kinds the trip does not have', () => {
    expect(defaultGearIds({ kinds: [] }, gear)).toEqual(['g1']);
  });
});

describe('readiness color helpers', () => {
  it('agree on the same 80/50 thresholds', () => {
    for (const score of [0, 20, 49, 50, 79, 80, 100]) {
      const good = score >= 80;
      const mid = score >= 50 && score < 80;
      expect(readinessTextColor(score)).toBe(good ? 'text-ok' : mid ? 'text-warn' : 'text-bad');
      expect(readinessBarColor(score)).toBe(good ? 'bg-ok' : mid ? 'bg-warn' : 'bg-bad');
      expect(readinessChipStyle(score)).toBe(good ? 'bg-ok/10 text-ok' : mid ? 'bg-warn-bg text-warn' : 'bg-bad-bg text-bad');
    }
  });
});
