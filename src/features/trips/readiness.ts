import { computeLoad, type LoadGear } from '../../calc/load';
import { computePower } from '../../calc/power';
import type { Campground, Gear, LoadProfile, PowerProfile, Reservation, Trailer, Trip, TripChecklistItem, Vehicle } from '../../model/schemas';
import { tripNights } from './utils';

export type ReadinessKey = 'checklist' | 'reservation' | 'dates' | 'location' | 'gear' | 'load' | 'power';

export interface ReadinessPart {
  key: ReadinessKey;
  label: string;
  /** Relative weight out of 100 — see READINESS_WEIGHTS. */
  weight: number;
  /** 0–100. */
  score: number;
  reason: string;
}

export interface ReadinessResult {
  /** 0–100 weighted average of the parts. */
  score: number;
  parts: ReadinessPart[];
}

/**
 * How much each part counts toward the overall readiness score (out of 100).
 * Documented in docs/phase-2.md — change here if the weighting changes.
 */
export const READINESS_WEIGHTS: Record<ReadinessKey, number> = {
  checklist: 25,
  reservation: 15,
  dates: 10,
  location: 10,
  gear: 20,
  load: 10,
  power: 10,
};

export interface ReadinessInput {
  trip: Trip;
  checklistItems: TripChecklistItem[];
  reservation: Reservation | null;
  campground: Campground | null;
  /** Gear records for trip.gearIds (missing ids simply skipped). */
  tripGear: Gear[];
  vehicle: Vehicle | null;
  trailer: Trailer | null;
  loadProfile: LoadProfile | null;
  powerProfile: PowerProfile | null;
}

const round = (n: number) => Math.round(n);
const clamp = (n: number) => Math.max(0, Math.min(100, n));

function checklistPart(items: TripChecklistItem[]): ReadinessPart {
  const total = items.length;
  const checked = items.filter((i) => i.checked).length;
  return {
    key: 'checklist',
    label: 'Checklist',
    weight: READINESS_WEIGHTS.checklist,
    score: total === 0 ? 0 : round((checked / total) * 100),
    reason: total === 0 ? 'No checklist yet — generate one on the trip page.' : `${checked} of ${total} items checked.`,
  };
}

function reservationPart(trip: Trip, campground: Campground | null, reservation: Reservation | null): ReadinessPart {
  const weight = READINESS_WEIGHTS.reservation;
  const base = { key: 'reservation' as const, label: 'Reservation', weight };
  if (campground && (campground.bookingSystem === 'first-come' || campground.bookingSystem === 'dispersed')) {
    return {
      ...base,
      score: 100,
      reason: campground.bookingSystem === 'first-come' ? 'First-come, first-served — no reservation needed.' : 'Dispersed camping — no reservation needed.',
    };
  }
  if (reservation?.status === 'booked') return { ...base, score: 100, reason: 'Booked.' };
  if (reservation?.status === 'waitlisted') return { ...base, score: 50, reason: 'Waitlisted.' };
  if (!trip.campgroundId) return { ...base, score: 0, reason: 'No campground chosen yet.' };
  return { ...base, score: 0, reason: 'Not booked yet.' };
}

function datesPart(trip: Trip): ReadinessPart {
  const set = !!(trip.startDate && trip.endDate);
  return {
    key: 'dates',
    label: 'Dates',
    weight: READINESS_WEIGHTS.dates,
    score: set ? 100 : 0,
    reason: set ? 'Dates set.' : trip.targetWindow ? `No firm dates yet — target window "${trip.targetWindow}".` : 'Dates not set yet.',
  };
}

function locationPart(trip: Trip): ReadinessPart {
  const loc = trip.location;
  return {
    key: 'location',
    label: 'Location',
    weight: READINESS_WEIGHTS.location,
    score: loc ? 100 : 0,
    reason: loc ? `Location set${loc.label ? `: ${loc.label}` : ''}.` : 'No location pinned yet.',
  };
}

function gearPart(tripGear: Gear[]): ReadinessPart {
  const weight = READINESS_WEIGHTS.gear;
  if (tripGear.length === 0) return { key: 'gear', label: 'Gear', weight, score: 0, reason: 'No gear assigned to this trip yet.' };
  const have = tripGear.filter((g) => g.status !== 'wishlist').length;
  return {
    key: 'gear',
    label: 'Gear',
    weight,
    score: round((have / tripGear.length) * 100),
    reason: `${have} of ${tripGear.length} items owned or ordered.`,
  };
}

function scoreFromLimitStatus(status: 'ok' | 'near' | 'over' | 'unknown'): number {
  if (status === 'over') return 40;
  if (status === 'near') return 80;
  return 100; // 'ok' or 'unknown' (nothing entered yet — don't penalize)
}

function loadPart(trip: Trip, tripGear: Gear[], vehicle: Vehicle | null, trailer: Trailer | null, loadProfile: LoadProfile | null): ReadinessPart {
  const weight = READINESS_WEIGHTS.load;
  const base = { key: 'load' as const, label: 'Load & tow', weight };
  if (!loadProfile) return { ...base, score: 100, reason: 'No load profile set up yet (Phase 1).' };
  const gear: LoadGear[] = tripGear.map((g) => ({ name: g.name, quantity: g.quantity, weightLb: g.weightLb.value, location: g.location }));
  const result = computeLoad({
    payloadLimitLb: vehicle?.payloadLb.value ?? null,
    roofLimitLb: vehicle?.roofLimitLb.value ?? null,
    towRatingLb: vehicle?.towRatingLb.value ?? null,
    towing: trip.towing,
    trailer: {
      scaleTicketLb: trailer?.scaleTicketLb.value ?? null,
      lowLb: trailer?.weightLowLb.value ?? null,
      highLb: trailer?.weightHighLb.value ?? null,
      tonguePctMin: trailer?.tonguePctMin ?? 0,
      tonguePctMax: trailer?.tonguePctMax ?? 0,
    },
    peopleLb: loadProfile.people.map((p) => p.weightLb.value ?? 0),
    waterGal: loadProfile.waterGal,
    extraFuelGal: loadProfile.extraFuelGal,
    otherLb: loadProfile.otherLb,
    gear,
  });
  return { ...base, score: scoreFromLimitStatus(result.overall), reason: result.warnings[0] ?? 'Within limits.' };
}

function powerPart(trip: Trip, powerProfile: PowerProfile | null): ReadinessPart {
  const weight = READINESS_WEIGHTS.power;
  const base = { key: 'power' as const, label: 'Power', weight };
  if (!powerProfile) return { ...base, score: 100, reason: 'No power profile set up yet (Phase 1).' };
  const nights = tripNights(trip);
  const result = computePower({
    batteryWh: powerProfile.batteryWh.value ?? 0,
    usablePct: powerProfile.usablePct.value ?? 100,
    startPct: powerProfile.startPct,
    loads: powerProfile.loads,
    solar: { ...powerProfile.solar, peakSunHours: trip.peakSunHours ?? powerProfile.solar.peakSunHours },
    driveCharge: powerProfile.driveCharge,
    tripDays: Math.max(1, nights ?? powerProfile.tripDays),
  });
  const score = result.status === 'over' ? 40 : result.status === 'near' ? 80 : 100;
  const reason =
    result.status === 'over'
      ? `Battery would run flat on day ${result.flatOnDay} of the trip.`
      : result.status === 'near'
        ? `Ends the trip around ${round(result.endPct)}% charge — cutting it close.`
        : 'Power should last the trip.';
  return { ...base, score, reason };
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const parts: ReadinessPart[] = [
    checklistPart(input.checklistItems),
    reservationPart(input.trip, input.campground, input.reservation),
    datesPart(input.trip),
    locationPart(input.trip),
    gearPart(input.tripGear),
    loadPart(input.trip, input.tripGear, input.vehicle, input.trailer, input.loadProfile),
    powerPart(input.trip, input.powerProfile),
  ];
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.score * p.weight, 0);
  return { score: totalWeight === 0 ? 0 : clamp(round(weighted / totalWeight)), parts };
}
