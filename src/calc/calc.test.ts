import { describe, expect, it } from 'vitest';
import type { Gear, PowerLoad } from '../model/schemas';
import { buyNext, itemCost, totals } from './budget';
import { limitStatus } from './limits';
import { computeLoad, GASOLINE_LB_PER_GAL, WATER_LB_PER_GAL, type LoadInput } from './load';
import { computePower, loadWhPerDay, type PowerInput } from './power';

const gear = (over: Partial<Gear> = {}): Gear => ({
  name: 'Item',
  categoryId: 'budget_category:power',
  status: 'wishlist',
  priority: null,
  quantity: 1,
  costLowUsd: null,
  costHighUsd: null,
  costActualUsd: null,
  inBudget: true,
  optional: false,
  weightLb: { value: null, status: 'estimate' },
  powerW: null,
  energyWhPerDay: null,
  location: 'cargo',
  packFor: [],
  notes: '',
  verify: '',
  ...over,
});

describe('limitStatus', () => {
  it('flags over, within 10%, ok and unknown', () => {
    expect(limitStatus(1500, 1490)).toBe('over');
    expect(limitStatus(1490, 1490)).toBe('near');
    expect(limitStatus(1341, 1490)).toBe('near'); // exactly 90%
    expect(limitStatus(1340, 1490)).toBe('ok');
    expect(limitStatus(100, null)).toBe('unknown');
    expect(limitStatus(100, 0)).toBe('unknown');
  });
});

describe('budget', () => {
  it('uses actual price, else the estimate range, times quantity', () => {
    expect(itemCost(gear({ costLowUsd: 550, costHighUsd: 900 }))).toMatchObject({ low: 550, high: 900, mid: 725, known: true });
    expect(itemCost(gear({ costLowUsd: 475, costHighUsd: 475, costActualUsd: 449 }))).toMatchObject({ mid: 449, actual: true });
    expect(itemCost(gear({ costLowUsd: 20, costHighUsd: 40, quantity: 2 }))).toMatchObject({ low: 40, high: 80, mid: 60 });
    expect(itemCost(gear({ costHighUsd: 269 }))).toMatchObject({ low: 269, high: 269 });
    expect(itemCost(gear()).known).toBe(false);
  });

  it('splits spent, planned, optional and unpriced', () => {
    const items = [
      gear({ status: 'ordered', costLowUsd: 475, costHighUsd: 475 }), // spent 475
      gear({ status: 'own', costActualUsd: 600 }), // bought this season: spent 600
      gear({ status: 'own', inBudget: false, costActualUsd: 300 }), // owned before: ignored
      gear({ costLowUsd: 200, costHighUsd: 400 }), // planned 300 (200–400)
      gear({ optional: true, costLowUsd: 269, costHighUsd: 269 }), // optional 269
      gear(), // unpriced
    ];
    expect(totals(items, 3000)).toEqual({
      budget: 3000,
      spent: 1075,
      planned: 300,
      plannedLow: 200,
      plannedHigh: 400,
      optional: 269,
      remaining: 1625,
      unpriced: 1,
    });
  });

  it('orders the buy-next list by priority then price and shows where the budget runs out', () => {
    const items = [
      gear({ name: 'Solar', priority: 5, costLowUsd: 200, costHighUsd: 400 }),
      gear({ name: 'EcoFlow', priority: 1, costLowUsd: 550, costHighUsd: 900 }),
      gear({ name: 'Fridge', priority: 1, costLowUsd: 475, costHighUsd: 475 }),
      gear({ name: 'Awning', priority: 3, costLowUsd: 389, costHighUsd: 499 }),
      gear({ name: 'Straps', priority: null, costLowUsd: 30, costHighUsd: 30 }),
      gear({ name: 'Slide', priority: 2, optional: true, costLowUsd: 269, costHighUsd: 269 }),
      gear({ name: 'Old cooler', status: 'ordered', costActualUsd: 100 }),
    ];
    const rows = buyNext(items, 1800);
    expect(rows.map((r) => r.item.name)).toEqual(['Fridge', 'EcoFlow', 'Awning', 'Solar', 'Straps']);
    // 100 already spent: 100+475=575, +725=1300, +444=1744 fits, +300=2044 doesn't.
    expect(rows.map((r) => r.fits)).toEqual([true, true, true, false, false]);
    expect(rows[2]?.cumulative).toBe(1644);
  });
});

const baseLoad = (over: Partial<LoadInput> = {}): LoadInput => ({
  payloadLimitLb: 1490,
  roofLimitLb: 165,
  towRatingLb: 9096,
  towing: false,
  trailer: { scaleTicketLb: null, lowLb: 3000, highLb: 3800, tonguePctMin: 10, tonguePctMax: 15 },
  peopleLb: [170, 170, 30],
  waterGal: 12,
  extraFuelGal: 0,
  otherLb: 0,
  gear: [],
  ...over,
});

describe('load & tow', () => {
  it('adds people, gear by location, water, fuel and other against payload', () => {
    const r = computeLoad(
      baseLoad({
        extraFuelGal: 5,
        otherLb: 20,
        gear: [
          { name: 'Awning', quantity: 1, weightLb: 28, location: 'roof' },
          { name: 'Fridge', quantity: 1, weightLb: 50, location: 'cargo' },
          { name: 'Jugs', quantity: 2, weightLb: 2, location: 'cargo' },
          { name: 'Messenger', quantity: 1, weightLb: 1, location: 'cab' },
          { name: 'PFD', quantity: 1, weightLb: 2, location: 'boat' }, // not payload
          { name: 'Spare', quantity: 1, weightLb: 40, location: 'home' }, // stays home
        ],
      }),
    );
    const expected = 370 + 28 + 50 + 4 + 1 + 12 * WATER_LB_PER_GAL + 5 * GASOLINE_LB_PER_GAL + 20;
    expect(r.payload.usedLb).toBeCloseTo(expected, 6);
    expect(r.roof.usedLb).toBe(28);
    expect(r.roof.status).toBe('ok');
    expect(r.tow.usedLb).toBe(0);
    expect(r.overall).toBe('ok');
  });

  it('counts tongue weight (heavy end) against payload when towing and warns on estimates', () => {
    const r = computeLoad(baseLoad({ towing: true }));
    expect(r.tongue).toEqual({ lowLb: 300, highLb: 570 });
    expect(r.tow).toMatchObject({ usedLb: 3800, lowLb: 3000, isEstimate: true, status: 'ok' });
    expect(r.payload.usedLb).toBeCloseTo(370 + 12 * WATER_LB_PER_GAL + 570, 6);
    expect(r.warnings.some((w) => w.includes('scale ticket'))).toBe(true);
  });

  it('uses a scale ticket instead of the estimate range', () => {
    const r = computeLoad(baseLoad({ towing: true, trailer: { scaleTicketLb: 3400, lowLb: 3000, highLb: 3800, tonguePctMin: 10, tonguePctMax: 15 } }));
    expect(r.tow).toMatchObject({ usedLb: 3400, lowLb: 3400, isEstimate: false });
    expect(r.tongue).toEqual({ lowLb: 340, highLb: 510 });
  });

  it('warns when over or within 10% of a limit, and when weights are missing', () => {
    const r = computeLoad(
      baseLoad({
        gear: [
          { name: 'Bars', quantity: 1, weightLb: 20, location: 'roof' },
          { name: 'Awning', quantity: 1, weightLb: 45, location: 'roof' },
          { name: 'Cargo bag load', quantity: 1, weightLb: 110, location: 'roof' },
          { name: 'Boxes', quantity: 1, weightLb: 800, location: 'cargo' },
          { name: 'Table', quantity: 1, weightLb: null, location: 'cargo' },
        ],
      }),
    );
    expect(r.roof).toMatchObject({ usedLb: 175, status: 'over' });
    // 370 + 175 + 800 + 100.08 = 1445.08 → ≥ 90% of 1490
    expect(r.payload.status).toBe('near');
    expect(r.missingWeights).toEqual(['Table']);
    expect(r.overall).toBe('over');
    expect(r.warnings.join(' ')).toMatch(/Roof load is over the limit by 10 lb/);
  });

  it('flags a tow over the rating', () => {
    const r = computeLoad(baseLoad({ towing: true, towRatingLb: 3500 }));
    expect(r.tow.status).toBe('over');
  });
});

const load = (over: Partial<PowerLoad>): PowerLoad => ({
  id: 'x',
  name: 'Load',
  enabled: true,
  whPerDay: null,
  watts: null,
  hoursPerDay: null,
  note: '',
  ...over,
});

const basePower = (over: Partial<PowerInput> = {}): PowerInput => ({
  batteryWh: 1024,
  usablePct: 90,
  startPct: 100,
  loads: [load({ name: 'Fridge', whPerDay: 350 }), load({ name: 'Fan, lights, phones', whPerDay: 100 })],
  solar: { enabled: true, panelW: 200, peakSunHours: 4, efficiencyPct: 72 },
  driveCharge: { watts: 300, hoursPerDay: 0 },
  tripDays: 3,
  ...over,
});

describe('power budget', () => {
  it('resolves loads from a daily figure or watts × hours', () => {
    expect(loadWhPerDay(load({ whPerDay: 350 }))).toBe(350);
    expect(loadWhPerDay(load({ watts: 400, hoursPerDay: 3 }))).toBe(1200);
    expect(loadWhPerDay(load({ watts: 400, hoursPerDay: 3, enabled: false }))).toBe(0);
  });

  it('computes net Wh/day and days of autonomy for the seed setup', () => {
    const r = computePower(basePower());
    expect(r.consumptionWh).toBe(450);
    expect(r.solarWh).toBeCloseTo(576, 6); // 200 W × 4 h × 72%
    expect(r.netWh).toBeCloseTo(126, 6);
    expect(r.daysOfAutonomy).toBe(Infinity);
    expect(r.endPct).toBe(100);
    expect(r.status).toBe('ok');
  });

  it('finds when the battery runs flat without enough sun', () => {
    const r = computePower(basePower({ solar: { enabled: true, panelW: 200, peakSunHours: 1, efficiencyPct: 72 }, tripDays: 4 }));
    // net = 144 − 450 = −306 Wh/day; usable 921.6 Wh → 3.01 days
    expect(r.netWh).toBeCloseTo(-306, 6);
    expect(r.daysOfAutonomy).toBeCloseTo(921.6 / 306, 6);
    expect(r.flatOnDay).toBe(4);
    expect(r.status).toBe('over');
  });

  it('warns when the trip ends below 20%, and counts drive charging', () => {
    const noSun = { enabled: false, panelW: 200, peakSunHours: 4, efficiencyPct: 72 };
    const r = computePower(basePower({ solar: noSun, tripDays: 2 }));
    // 921.6 − 900 = 21.6 Wh left → 2.3%
    expect(r.status).toBe('near');
    const charged = computePower(basePower({ solar: noSun, tripDays: 2, driveCharge: { watts: 300, hoursPerDay: 1 } }));
    expect(charged.driveWh).toBe(300);
    expect(charged.status).toBe('ok');
  });

  it('shows the small AC is the big draw', () => {
    const r = computePower(basePower({ loads: [...basePower().loads, load({ name: 'AC', watts: 400, hoursPerDay: 4 })] }));
    expect(r.consumptionWh).toBe(2050);
    expect(r.flatOnDay).toBe(1);
  });
});
