import type { Gear } from '../model/schemas';

export interface Cost {
  low: number;
  high: number;
  mid: number;
  /** false when the item has no price yet */
  known: boolean;
  actual: boolean;
}

/** Price of an item × quantity: what we paid if known, otherwise the research range. */
export function itemCost(g: Pick<Gear, 'costLowUsd' | 'costHighUsd' | 'costActualUsd' | 'quantity'>): Cost {
  const q = g.quantity;
  if (g.costActualUsd !== null) {
    const v = g.costActualUsd * q;
    return { low: v, high: v, mid: v, known: true, actual: true };
  }
  const lo = g.costLowUsd ?? g.costHighUsd;
  const hi = g.costHighUsd ?? g.costLowUsd;
  if (lo === null || hi === null) return { low: 0, high: 0, mid: 0, known: false, actual: false };
  return { low: lo * q, high: hi * q, mid: ((lo + hi) / 2) * q, known: true, actual: false };
}

export interface Totals {
  budget: number;
  /** Bought or ordered this season (actual price, or mid estimate). */
  spent: number;
  /** Still to buy (wishlist, not optional) at mid estimate, with range. */
  planned: number;
  plannedLow: number;
  plannedHigh: number;
  /** Optional wishlist extras, not counted in `planned`. */
  optional: number;
  remaining: number;
  /** Wishlist items with no price yet — the plan will cost more than shown. */
  unpriced: number;
}

function isSpent(g: Gear) {
  return g.inBudget && (g.status === 'own' || g.status === 'ordered');
}
function isPlanned(g: Gear) {
  return g.inBudget && g.status === 'wishlist';
}

export function totals(items: Gear[], budget: number): Totals {
  const t: Totals = { budget, spent: 0, planned: 0, plannedLow: 0, plannedHigh: 0, optional: 0, remaining: 0, unpriced: 0 };
  for (const g of items) {
    const c = itemCost(g);
    if (isSpent(g)) t.spent += c.mid;
    else if (isPlanned(g)) {
      if (!c.known) t.unpriced++;
      else if (g.optional) t.optional += c.mid;
      else {
        t.planned += c.mid;
        t.plannedLow += c.low;
        t.plannedHigh += c.high;
      }
    }
  }
  t.remaining = budget - t.spent - t.planned;
  return t;
}

export interface CategoryTotals extends Totals {
  categoryId: string;
}

export function totalsByCategory(
  items: (Gear & { id?: string })[],
  categories: { id: string; budgetUsd: number }[],
): CategoryTotals[] {
  return categories.map((c) => ({
    categoryId: c.id,
    ...totals(
      items.filter((g) => g.categoryId === c.id),
      c.budgetUsd,
    ),
  }));
}

export interface BuyNextRow<T> {
  item: T;
  cost: Cost;
  /** Running total of mid-estimates, in priority order. */
  cumulative: number;
  /** Still inside the season budget after everything above it. */
  fits: boolean;
}

/**
 * The wishlist in buying order: priority (1 first, unranked last), then
 * cheaper first. `fits` shows how far down the list the budget reaches.
 */
export function buyNext<T extends Gear>(items: T[], budget: number): BuyNextRow<T>[] {
  const spent = totals(items, budget).spent;
  const wish = items
    .filter((g) => isPlanned(g) && !g.optional)
    .map((item) => ({ item, cost: itemCost(item) }))
    .sort(
      (a, b) =>
        (a.item.priority ?? 99) - (b.item.priority ?? 99) ||
        a.cost.mid - b.cost.mid ||
        a.item.name.localeCompare(b.item.name),
    );
  let running = spent;
  return wish.map(({ item, cost }) => {
    running += cost.mid;
    return { item, cost, cumulative: running - spent, fits: running <= budget };
  });
}
