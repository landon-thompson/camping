import type { GearLocation } from '../model/schemas';
import { limitStatus, pctOf, worst, type LimitStatus } from './limits';

/** Approximate densities. */
export const WATER_LB_PER_GAL = 8.34;
export const GASOLINE_LB_PER_GAL = 6.1;

/** Locations that ride in or on the vehicle and so count against payload. */
export const PAYLOAD_LOCATIONS: GearLocation[] = ['roof', 'cargo', 'cab', 'mounted'];

export interface LoadGear {
  name: string;
  quantity: number;
  /** Per unit; null = unknown. */
  weightLb: number | null;
  location: GearLocation | null;
}

export interface LoadInput {
  payloadLimitLb: number | null;
  roofLimitLb: number | null;
  towRatingLb: number | null;
  towing: boolean;
  trailer: {
    /** A real scale ticket replaces the estimate range. */
    scaleTicketLb: number | null;
    lowLb: number | null;
    highLb: number | null;
    tonguePctMin: number;
    tonguePctMax: number;
  };
  peopleLb: number[];
  waterGal: number;
  extraFuelGal: number;
  otherLb: number;
  gear: LoadGear[];
}

export interface Gauge {
  usedLb: number;
  limitLb: number | null;
  pct: number | null;
  status: LimitStatus;
}

export interface LoadResult {
  payload: Gauge;
  roof: Gauge;
  /** Uses the heavier end of the trailer range. */
  tow: Gauge & { lowLb: number; isEstimate: boolean };
  tongue: { lowLb: number; highLb: number };
  breakdown: {
    peopleLb: number;
    gearLb: Record<'roof' | 'cargo' | 'cab' | 'mounted', number>;
    waterLb: number;
    fuelLb: number;
    otherLb: number;
    tongueLb: number;
  };
  /** Items counted but with no weight entered — the real load is higher. */
  missingWeights: string[];
  overall: LimitStatus;
  warnings: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function computeLoad(input: LoadInput): LoadResult {
  const gearLb = { roof: 0, cargo: 0, cab: 0, mounted: 0 };
  const missingWeights: string[] = [];
  for (const g of input.gear) {
    if (!g.location || !PAYLOAD_LOCATIONS.includes(g.location)) continue;
    if (g.weightLb === null) {
      missingWeights.push(g.name);
      continue;
    }
    gearLb[g.location as keyof typeof gearLb] += g.weightLb * g.quantity;
  }

  const t = input.trailer;
  const ticket = t.scaleTicketLb;
  const lowLb = input.towing ? (ticket ?? t.lowLb ?? t.highLb ?? 0) : 0;
  const highLb = input.towing ? (ticket ?? t.highLb ?? t.lowLb ?? 0) : 0;
  const tongueLow = (lowLb * t.tonguePctMin) / 100;
  const tongueHigh = (highLb * t.tonguePctMax) / 100;

  const peopleLb = input.peopleLb.reduce((a, b) => a + b, 0);
  const waterLb = input.waterGal * WATER_LB_PER_GAL;
  const fuelLb = input.extraFuelGal * GASOLINE_LB_PER_GAL;
  const gearTotal = gearLb.roof + gearLb.cargo + gearLb.cab + gearLb.mounted;
  // Tongue weight sits on the hitch and counts against payload (heavy end for safety).
  const payloadUsed = peopleLb + gearTotal + waterLb + fuelLb + input.otherLb + tongueHigh;

  const payload: Gauge = {
    usedLb: payloadUsed,
    limitLb: input.payloadLimitLb,
    pct: pctOf(payloadUsed, input.payloadLimitLb),
    status: limitStatus(payloadUsed, input.payloadLimitLb),
  };
  const roof: Gauge = {
    usedLb: gearLb.roof,
    limitLb: input.roofLimitLb,
    pct: pctOf(gearLb.roof, input.roofLimitLb),
    status: limitStatus(gearLb.roof, input.roofLimitLb),
  };
  const tow = {
    usedLb: highLb,
    lowLb,
    limitLb: input.towRatingLb,
    pct: pctOf(highLb, input.towRatingLb),
    status: input.towing ? limitStatus(highLb, input.towRatingLb) : ('ok' as LimitStatus),
    isEstimate: input.towing && ticket === null,
  };

  const warnings: string[] = [];
  const say = (label: string, g: Gauge) => {
    if (g.status === 'over') warnings.push(`${label} is over the limit by ${fmt(g.usedLb - (g.limitLb ?? 0))} lb.`);
    else if (g.status === 'near') warnings.push(`${label} is within 10% of the limit (${fmt(g.usedLb)} of ${fmt(g.limitLb ?? 0)} lb).`);
    else if (g.status === 'unknown') warnings.push(`${label}: no limit entered.`);
  };
  say('Payload', payload);
  say('Roof load', roof);
  if (input.towing) say('Trailer weight', tow);
  if (missingWeights.length) {
    warnings.push(`${missingWeights.length} item${missingWeights.length === 1 ? ' has' : 's have'} no weight yet, so the real load is higher.`);
  }
  if (tow.isEstimate) warnings.push('Trailer weight is an estimate. Replace it with a scale ticket.');

  return {
    payload,
    roof,
    tow,
    tongue: { lowLb: tongueLow, highLb: tongueHigh },
    breakdown: { peopleLb, gearLb, waterLb, fuelLb, otherLb: input.otherLb, tongueLb: tongueHigh },
    missingWeights,
    overall: worst(payload.status, roof.status, tow.status),
    warnings,
  };
}
