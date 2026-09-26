import { describe, expect, it } from 'vitest';
import type { ChecklistTemplate, Debrief, Gear, Trip } from '../../model/schemas';
import { generateChecklist, missingChecklistItems, pastDebriefsFor, templatesForTrip } from './checklist';

const trip = (over: Partial<Trip> = {}): Trip => ({
  name: 'Trip',
  level: 2,
  status: 'idea',
  targetWindow: 'June',
  startDate: null,
  endDate: null,
  kinds: ['boat', 'toddler'],
  towing: true,
  campgroundId: null,
  location: null,
  boatLaunch: null,
  gearIds: [],
  peakSunHours: null,
  notes: '',
  ...over,
});

const template = (over: Partial<ChecklistTemplate> = {}): ChecklistTemplate => ({
  name: 'Template',
  kind: 'all',
  description: '',
  source: '',
  items: [{ id: 'i1', text: 'Item one' }],
  ...over,
});

const gear = (over: Partial<Gear> = {}): Gear => ({
  name: 'Gear item',
  categoryId: 'budget_category:kitchen',
  status: 'own',
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
  packFor: ['all'],
  notes: '',
  verify: '',
  ...over,
});

describe('templatesForTrip', () => {
  it("includes 'all', 'departure', and templates matching a trip kind, and excludes the rest", () => {
    const templates = [
      { id: 't-all', data: template({ kind: 'all', name: 'All' }) },
      { id: 't-dep', data: template({ kind: 'departure', name: 'Departure' }) },
      { id: 't-boat', data: template({ kind: 'boat', name: 'Boat' }) },
      { id: 't-electric', data: template({ kind: 'electric', name: 'Electric' }) },
    ];
    const result = templatesForTrip(trip({ kinds: ['boat', 'toddler'] }), templates);
    expect(result.map((t) => t.data.name)).toEqual(['All', 'Departure', 'Boat']);
  });
});

describe('pastDebriefsFor', () => {
  const trips = [
    { id: 'trip:1', data: trip({ level: 1, startDate: '2027-06-01', endDate: '2027-06-02' }) },
    { id: 'trip:2', data: trip({ level: 2, startDate: '2027-06-15', endDate: '2027-06-17' }) },
    { id: 'trip:3', data: trip({ level: 3, startDate: null, endDate: null }) },
    { id: 'trip:4', data: trip({ level: 4, startDate: null, endDate: null }) },
  ];
  const debrief = (tripId: string, forgot: string[]): { data: Debrief } => ({
    data: { tripId, forgot, neverUsed: [], wentWell: '', improve: '', notes: '', photoIds: [] },
  });

  it('includes only debriefs of trips with an earlier startDate', () => {
    const debriefs = [debrief('trip:1', ['Bug spray']), debrief('trip:2', ['Later trip — excluded'])];
    const result = pastDebriefsFor(trips[1]!, trips, debriefs);
    expect(result).toEqual([debriefs[0]!.data]);
  });

  it('falls back to level when neither trip has a startDate', () => {
    const debriefs = [debrief('trip:3', ['Lower level']), debrief('trip:4', ['Higher level — excluded'])];
    const result = pastDebriefsFor(trips[3]!, trips, debriefs);
    expect(result).toEqual([debriefs[0]!.data]);
  });

  it('never includes the trip itself', () => {
    const debriefs = [debrief('trip:2', ['Own debrief'])];
    expect(pastDebriefsFor(trips[1]!, trips, debriefs)).toEqual([]);
  });
});

describe('generateChecklist', () => {
  it('pulls template items, trip gear (in gearIds order) and forgot items, each in its own group', () => {
    const templates = [{ id: 't1', data: template({ kind: 'all', name: 'Core', items: [{ id: 'a', text: 'Map' }, { id: 'b', text: 'First aid kit' }] }) }];
    const gearRows = [
      { id: 'gear:1', data: gear({ name: 'Tent' }) },
      { id: 'gear:2', data: gear({ name: 'Stove' }) },
    ];
    const items = generateChecklist('trip:x', trip({ gearIds: ['gear:2', 'gear:1'] }), templates, gearRows, [
      { tripId: 'trip:earlier', forgot: ['Bug spray'], neverUsed: [], wentWell: '', improve: '', notes: '', photoIds: [] },
    ]);
    expect(items.map((i) => [i.text, i.group, i.source])).toEqual([
      ['Map', 'Core', 'template'],
      ['First aid kit', 'Core', 'template'],
      ['Stove', 'Gear', 'gear'],
      ['Tent', 'Gear', 'gear'],
      ['Bug spray', 'Forgot last time', 'forgot'],
    ]);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2, 3, 4]);
    expect(items.every((i) => i.tripId === 'trip:x')).toBe(true);
  });

  it('dedupes text case- and space-insensitively, keeping the first source', () => {
    const templates = [{ id: 't1', data: template({ items: [{ id: 'a', text: '  Bug Spray ' }] }) }];
    const gearRows = [{ id: 'gear:1', data: gear({ name: 'bug   spray' }) }];
    const items = generateChecklist('trip:x', trip({ gearIds: ['gear:1'] }), templates, gearRows, [
      { tripId: 't', forgot: ['BUG SPRAY'], neverUsed: [], wentWell: '', improve: '', notes: '', photoIds: [] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: 'Bug Spray', source: 'template' });
  });

  it('is stable and reproducible for the same inputs', () => {
    const templates = [{ id: 't1', data: template() }];
    const a = generateChecklist('trip:x', trip(), templates, [], []);
    const b = generateChecklist('trip:x', trip(), templates, [], []);
    expect(a).toEqual(b);
  });
});

describe('missingChecklistItems', () => {
  const item = (text: string, order: number, checked = false): import('../../model/schemas').TripChecklistItem => ({
    tripId: 'trip:x',
    text,
    source: 'template',
    sourceId: null,
    group: 'Core',
    checked,
    checkedBy: checked ? 'user:1' : null,
    order,
  });

  it('adds only lines missing from the existing checklist, continuing the order sequence', () => {
    const existing = [item('Map', 0, true), item('Custom flashlight', 1)];
    const generated = generateChecklist(
      'trip:x',
      trip(),
      [{ id: 't1', data: template({ items: [{ id: 'a', text: 'Map' }, { id: 'b', text: 'First aid kit' }] }) }],
      [],
      [],
    );
    const missing = missingChecklistItems(existing, generated);
    expect(missing.map((i) => i.text)).toEqual(['First aid kit']);
    expect(missing[0]!.order).toBe(2);
  });

  it('never reports an already-checked or custom item as missing', () => {
    const existing = [item('Map', 0, true)];
    const generated = generateChecklist('trip:x', trip(), [{ id: 't1', data: template({ items: [{ id: 'a', text: 'map' }] }) }], [], []);
    expect(missingChecklistItems(existing, generated)).toEqual([]);
  });
});
