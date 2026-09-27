import { describe, expect, it } from 'vitest';
import { buyNext, itemCost } from '../../calc/budget';
import type { Gear } from '../../model/schemas';
import { costLabel, formatUsd, gearForLoad, priorityLabel, splitBuyNext } from './format';

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

describe('formatUsd', () => {
  it('rounds and adds thousands separators', () => {
    expect(formatUsd(725)).toBe('$725');
    expect(formatUsd(1234.6)).toBe('$1,235');
  });
});

describe('costLabel', () => {
  it('shows a range, a single actual/estimate price, or "no price yet"', () => {
    expect(costLabel(itemCost(gear({ costLowUsd: 550, costHighUsd: 900 })))).toBe('$550–900');
    expect(costLabel(itemCost(gear({ costLowUsd: 475, costHighUsd: 475 })))).toBe('$475');
    expect(costLabel(itemCost(gear({ costActualUsd: 449 })))).toBe('$449');
    expect(costLabel(itemCost(gear()))).toBe('no price yet');
  });
});

describe('priorityLabel', () => {
  it('formats P1–P5 or a dash', () => {
    expect(priorityLabel(1)).toBe('P1');
    expect(priorityLabel(null)).toBe('—');
  });
});

describe('splitBuyNext', () => {
  it('keeps priced items in buying order and groups unpriced ones separately', () => {
    const items = [
      gear({ name: 'Fridge', priority: 1, costLowUsd: 475, costHighUsd: 475 }),
      gear({ name: 'Straps', priority: 1 }), // unpriced
      gear({ name: 'Awning', priority: 2, costLowUsd: 389, costHighUsd: 499 }),
      gear({ name: 'Table', priority: 3 }), // unpriced
    ];
    const { priced, unpriced } = splitBuyNext(buyNext(items, 1000));
    expect(priced.map((r) => r.item.name)).toEqual(['Fridge', 'Awning']);
    expect(unpriced.map((r) => r.item.name)).toEqual(['Straps', 'Table']);
    // Unpriced items don't interrupt the running total.
    expect(priced.map((r) => r.cumulative)).toEqual([475, 919]);
  });
});

describe('gearForLoad', () => {
  const items = [
    { id: 'a', name: 'Owned', quantity: 1, weightLb: 1, location: 'cargo' as const, status: 'own' as const },
    { id: 'b', name: 'Ordered', quantity: 1, weightLb: 1, location: 'cargo' as const, status: 'ordered' as const },
    { id: 'c', name: 'Wishlist', quantity: 1, weightLb: 1, location: 'cargo' as const, status: 'wishlist' as const },
  ];

  it('always includes own/ordered, and wishlist only when asked', () => {
    expect(gearForLoad(items, false).map((i) => i.id)).toEqual(['a', 'b']);
    expect(gearForLoad(items, true).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
