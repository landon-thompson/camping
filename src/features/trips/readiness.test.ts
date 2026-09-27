import { describe, expect, it } from 'vitest';
import type { Campground, Gear, LoadProfile, PowerProfile, Reservation, Trailer, Trip, TripChecklistItem, Vehicle } from '../../model/schemas';
import { computeReadiness, READINESS_WEIGHTS, type ReadinessInput } from './readiness';

const trip = (over: Partial<Trip> = {}): Trip => ({
  name: 'Trip',
  level: 2,
  status: 'idea',
  targetWindow: 'June',
  startDate: null,
  endDate: null,
  kinds: ['boat'],
  towing: true,
  campgroundId: null,
  location: null,
  boatLaunch: null,
  gearIds: [],
  peakSunHours: null,
  notes: '',
  ...over,
});

const checklistItem = (checked: boolean): TripChecklistItem => ({
  tripId: 'trip:x',
  text: 'Item',
  source: 'template',
  sourceId: null,
  group: 'Core',
  checked,
  checkedBy: null,
  order: 0,
});

const gear = (over: Partial<Gear> = {}): Gear => ({
  name: 'Item',
  categoryId: 'budget_category:kitchen',
  status: 'own',
  priority: null,
  quantity: 1,
  costLowUsd: null,
  costHighUsd: null,
  costActualUsd: null,
  inBudget: true,
  optional: false,
  weightLb: { value: 10, status: 'verify' },
  powerW: null,
  energyWhPerDay: null,
  location: 'cargo',
  packFor: ['all'],
  notes: '',
  verify: '',
  ...over,
});

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  name: 'GX550',
  year: 2026,
  make: 'Lexus',
  model: 'GX550',
  trim: 'Overtrail',
  payloadLb: { value: 1490, status: 'verify' },
  towRatingLb: { value: 9096, status: 'verify' },
  roofLimitLb: { value: 165, status: 'verify' },
  features: [],
  notes: [],
  ...over,
});

const trailer = (over: Partial<Trailer> = {}): Trailer => ({
  name: 'Boat',
  description: '',
  weightLowLb: { value: 3000, status: 'estimate' },
  weightHighLb: { value: 3800, status: 'estimate' },
  scaleTicketLb: { value: null, status: 'estimate' },
  tonguePctMin: 10,
  tonguePctMax: 15,
  ...over,
});

const loadProfile = (over: Partial<LoadProfile> = {}): LoadProfile => ({
  people: [{ id: 'p1', label: 'Adult', weightLb: { value: 180, status: 'estimate' } }],
  waterGal: 5,
  extraFuelGal: 0,
  otherLb: 0,
  towing: true,
  includeWishlist: false,
  ...over,
});

const powerProfile = (over: Partial<PowerProfile> = {}): PowerProfile => ({
  batteryName: 'EcoFlow',
  batteryWh: { value: 1024, status: 'verify' },
  usablePct: { value: 90, status: 'estimate' },
  startPct: 100,
  loads: [{ id: 'l1', name: 'Fridge', enabled: true, whPerDay: 300, watts: null, hoursPerDay: null, note: '' }],
  solar: { enabled: true, panelW: 200, peakSunHours: 5, efficiencyPct: 80 },
  driveCharge: { watts: 0, hoursPerDay: 0 },
  tripDays: 3,
  ...over,
});

const baseInput = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  trip: trip(),
  checklistItems: [],
  reservation: null,
  campground: null,
  tripGear: [],
  vehicle: null,
  trailer: null,
  loadProfile: null,
  powerProfile: null,
  ...over,
});

describe('computeReadiness', () => {
  it('weights sum to 100', () => {
    expect(Object.values(READINESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scores an empty new trip low, with reasons for every part', () => {
    const result = computeReadiness(baseInput());
    expect(result.parts).toHaveLength(7);
    expect(result.score).toBeLessThan(50);
    for (const p of result.parts) expect(p.reason.length).toBeGreaterThan(0);
  });

  it('gives full checklist credit only once everything is checked', () => {
    const half = computeReadiness(baseInput({ checklistItems: [checklistItem(true), checklistItem(false)] }));
    const full = computeReadiness(baseInput({ checklistItems: [checklistItem(true), checklistItem(true)] }));
    expect(half.parts.find((p) => p.key === 'checklist')?.score).toBe(50);
    expect(full.parts.find((p) => p.key === 'checklist')?.score).toBe(100);
  });

  it('treats first-come and dispersed campgrounds as reservation N/A', () => {
    const campground: Campground = {
      name: 'Boat-in site',
      agency: 'usfs',
      bookingSystem: 'first-come',
      unit: 'Superior NF',
      location: null,
      bookingUrl: '',
      ridbFacilityId: null,
      windowDaysOverride: null,
      electric: false,
      boatLaunch: true,
      rules: [],
      verify: '',
      source: '',
      notes: '',
    };
    const result = computeReadiness(baseInput({ trip: trip({ campgroundId: 'campground:x' }), campground }));
    expect(result.parts.find((p) => p.key === 'reservation')).toMatchObject({ score: 100 });
  });

  it('scores booked reservations full and unbooked ones zero', () => {
    const reservation = (status: Reservation['status']): Reservation => ({
      tripId: 'trip:x',
      campgroundId: null,
      status,
      arrivalDate: null,
      nights: null,
      confirmation: '',
      site: '',
      costUsd: null,
      feesUsd: null,
      cancelDeadline: null,
      notifyMeSet: false,
      notes: '',
    });
    const booked = computeReadiness(baseInput({ trip: trip({ campgroundId: 'c1' }), reservation: reservation('booked') }));
    const planned = computeReadiness(baseInput({ trip: trip({ campgroundId: 'c1' }), reservation: reservation('planned') }));
    expect(booked.parts.find((p) => p.key === 'reservation')?.score).toBe(100);
    expect(planned.parts.find((p) => p.key === 'reservation')?.score).toBe(0);
  });

  it('scores dates and location once set', () => {
    const withBoth = computeReadiness(
      baseInput({ trip: trip({ startDate: '2027-06-01', endDate: '2027-06-03', location: { lat: 46, lng: -93, label: 'Home lake' } }) }),
    );
    expect(withBoth.parts.find((p) => p.key === 'dates')?.score).toBe(100);
    expect(withBoth.parts.find((p) => p.key === 'location')?.score).toBe(100);
  });

  it('scores gear coverage by owned/ordered vs wishlist', () => {
    const tripGear = [gear({ status: 'own' }), gear({ status: 'wishlist' })];
    const result = computeReadiness(baseInput({ tripGear }));
    expect(result.parts.find((p) => p.key === 'gear')?.score).toBe(50);
  });

  it('treats missing load/power profiles as not applicable (full credit)', () => {
    const result = computeReadiness(baseInput());
    expect(result.parts.find((p) => p.key === 'load')).toMatchObject({ score: 100 });
    expect(result.parts.find((p) => p.key === 'power')).toMatchObject({ score: 100 });
  });

  it('penalizes an over-payload load and a battery that runs flat', () => {
    const heavyGear = [gear({ weightLb: { value: 2000, status: 'verify' }, location: 'cargo' })];
    const overLoad = computeReadiness(
      baseInput({ trip: trip({ towing: false }), tripGear: heavyGear, vehicle: vehicle(), trailer: trailer(), loadProfile: loadProfile() }),
    );
    expect(overLoad.parts.find((p) => p.key === 'load')?.score).toBeLessThan(100);

    const thirstyProfile = powerProfile({ loads: [{ id: 'l1', name: 'AC', enabled: true, whPerDay: 2000, watts: null, hoursPerDay: null, note: '' }] });
    const overPower = computeReadiness(baseInput({ trip: trip({ peakSunHours: 0 }), powerProfile: thirstyProfile }));
    expect(overPower.parts.find((p) => p.key === 'power')?.score).toBeLessThan(100);
  });

  it('is a weighted average bounded between 0 and 100', () => {
    const result = computeReadiness(
      baseInput({
        checklistItems: [checklistItem(true)],
        trip: trip({ startDate: '2027-06-01', endDate: '2027-06-03', location: { lat: 46, lng: -93, label: '' }, campgroundId: 'c1' }),
        tripGear: [gear({ status: 'own' })],
      }),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  describe('actionable targets (each links back to where to fix it)', () => {
    it('sends an incomplete checklist and missing gear to Pack', () => {
      const result = computeReadiness(baseInput());
      expect(result.parts.find((p) => p.key === 'checklist')?.target).toMatchObject({ tab: 't-pack' });
      expect(result.parts.find((p) => p.key === 'gear')?.target).toMatchObject({ tab: 't-pack' });
    });

    it('sends a trip with no campground/reservation to Book', () => {
      const result = computeReadiness(baseInput());
      expect(result.parts.find((p) => p.key === 'reservation')?.target).toMatchObject({ tab: 't-reservation' });
    });

    it('sends missing dates and location to Plan, with a focus id', () => {
      const result = computeReadiness(baseInput());
      expect(result.parts.find((p) => p.key === 'dates')?.target).toMatchObject({ tab: 't-details', focusId: 'plan-trip-dates' });
      expect(result.parts.find((p) => p.key === 'location')?.target).toMatchObject({ tab: 't-details', focusId: 'plan-where' });
    });

    it('clears the target once a part is fully satisfied', () => {
      const result = computeReadiness(
        baseInput({
          checklistItems: [checklistItem(true)],
          trip: trip({ startDate: '2027-06-01', endDate: '2027-06-03', location: { lat: 46, lng: -93, label: '' } }),
          tripGear: [gear({ status: 'own' })],
        }),
      );
      for (const key of ['checklist', 'gear', 'dates', 'location'] as const) {
        expect(result.parts.find((p) => p.key === key)?.target).toBeNull();
      }
    });

    it('never sends a target for load or power (no owned screen to send them to)', () => {
      const result = computeReadiness(baseInput({ vehicle: vehicle(), trailer: trailer(), loadProfile: loadProfile(), powerProfile: powerProfile() }));
      expect(result.parts.find((p) => p.key === 'load')?.target).toBeNull();
      expect(result.parts.find((p) => p.key === 'power')?.target).toBeNull();
    });
  });
});
