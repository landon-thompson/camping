import { Link } from 'react-router-dom';
import { saveRecord, useRecord, useRecords } from '../../db/records';
import { Button, Card, PageTitle } from '../../components/ui';
import { buyNext } from '../../calc/budget';
import type { Gear } from '../../model/schemas';
import { costLabel, formatUsd, priorityLabel } from './format';
import { GearSubNav } from './nav';

async function markOrdered(item: Gear & { id: string }) {
  const { id, ...data } = item;
  await saveRecord('gear', id, { ...data, status: 'ordered' });
}

export function BuyNextPage() {
  const settings = useRecord('settings', 'settings');
  const gear = useRecords('gear');

  return (
    <div className="space-y-4">
      <PageTitle sub="Wishlist items in buying order, cheapest-first within each priority.">Buy next</PageTitle>
      <GearSubNav />
      {settings.loading || gear.loading || !settings.data ? (
        <p className="text-ink-2">Loading…</p>
      ) : (
        <BuyNextList seasonBudget={settings.data.seasonBudgetUsd} gear={gear.rows.map((g) => ({ ...g.data, id: g.id }))} />
      )}
    </div>
  );
}

function BuyNextList({ seasonBudget, gear }: { seasonBudget: number; gear: (Gear & { id: string })[] }) {
  const rows = buyNext(gear, seasonBudget);
  const cutoffIndex = rows.findIndex((r) => !r.fits);

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-ink-2">Nothing on the wishlist yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((r, i) => (
          <li key={r.item.id}>
            {i === cutoffIndex && (
              <div className="my-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-warn">
                <span className="h-px flex-1 bg-warn" />
                Budget runs out here
                <span className="h-px flex-1 bg-warn" />
              </div>
            )}
            <div className="flex min-h-12 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Link to={`/gear/${r.item.id}`} className="truncate font-semibold hover:underline">
                  {r.item.name}
                </Link>
                <p className="text-sm text-ink-2">
                  {priorityLabel(r.item.priority)} · {costLabel(r.cost)} · running total {formatUsd(r.cumulative)}
                </p>
              </div>
              <Button variant="secondary" className="shrink-0" onClick={() => void markOrdered(r.item)}>
                Mark ordered
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
