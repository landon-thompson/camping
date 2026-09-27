import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRecords, type Row } from '../../db/records';
import { Card, PageTitle, inputClass } from '../../components/ui';
import { itemCost } from '../../calc/budget';
import type { Gear, GearLocation, GearStatus } from '../../model/schemas';
import { costLabel, formatUsd, locationLabel, priorityLabel, statusLabel } from './format';
import { GearSubNav, NavButton } from './nav';

const LOCATIONS = Object.keys(locationLabel) as GearLocation[];

export function GearListPage() {
  const categories = useRecords('budget_category');
  const gear = useRecords('gear');
  const [statusFilter, setStatusFilter] = useState<'all' | GearStatus>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | GearLocation>('all');

  const sortedCategories = [...categories.rows].sort((a, b) => a.data.order - b.data.order);
  const filtered = gear.rows.filter(
    (g) =>
      (statusFilter === 'all' || g.data.status === statusFilter) &&
      (locationFilter === 'all' || g.data.location === locationFilter),
  );
  const categorized = new Set(categories.rows.map((c) => c.id));
  const uncategorized = filtered.filter((g) => !categorized.has(g.data.categoryId));

  return (
    <div className="space-y-4">
      <PageTitle sub="Everything to buy, own or track for the season.">Gear</PageTitle>
      <GearSubNav />

      <Card>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink-2">Status</span>
            <select
              className={inputClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | GearStatus)}
            >
              <option value="all">All</option>
              <option value="own">Own</option>
              <option value="ordered">Ordered</option>
              <option value="wishlist">Wishlist</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink-2">Location</span>
            <select
              className={inputClass}
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value as 'all' | GearLocation)}
            >
              <option value="all">All</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {locationLabel[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className="flex justify-end">
        <NavButton to="/gear/new">+ Add gear</NavButton>
      </div>

      {sortedCategories.map((cat) => {
        const items = filtered
          .filter((g) => g.data.categoryId === cat.id)
          .sort((a, b) => a.data.name.localeCompare(b.data.name));
        if (items.length === 0) return null;
        return <CategorySection key={cat.id} name={cat.data.name} items={items} />;
      })}

      {uncategorized.length > 0 && <CategorySection name="Uncategorized" items={uncategorized} />}

      {!gear.loading && filtered.length === 0 && <p className="text-center text-ink-2">No gear matches these filters.</p>}
    </div>
  );
}

/** A collapsible category: header shows item count and the total of priced items, tap to expand. */
function CategorySection({ name, items }: { name: string; items: Row<Gear>[] }) {
  const knownTotal = items.reduce((sum, g) => {
    const c = itemCost(g.data);
    return c.known ? sum + c.mid : sum;
  }, 0);
  const anyKnown = items.some((g) => itemCost(g.data).known);

  return (
    <Card>
      <details>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 marker:content-none">
          <span className="font-semibold">{name}</span>
          <span className="shrink-0 text-sm text-ink-2">
            {items.length} item{items.length === 1 ? '' : 's'}
            {anyKnown && <> · {formatUsd(knownTotal)}</>}
          </span>
        </summary>
        <ul className="mt-2 divide-y divide-line">
          {items.map((g) => (
            <GearRow key={g.id} id={g.id} data={g.data} />
          ))}
        </ul>
      </details>
    </Card>
  );
}

function GearRow({ id, data }: { id: string; data: Gear }) {
  const cost = itemCost(data);
  return (
    <li>
      <Link to={`/gear/${id}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{data.name}</p>
          <p className="truncate text-sm text-ink-2">
            {statusLabel[data.status]} · {priorityLabel(data.priority)}
            {data.location && ` · ${locationLabel[data.location]}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data.verify && (
            <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-warn">
              verify
            </span>
          )}
          <span className={`text-sm ${cost.known ? 'font-semibold text-ink-2' : 'italic text-ink-2/60'}`}>{costLabel(cost)}</span>
        </div>
      </Link>
    </li>
  );
}
