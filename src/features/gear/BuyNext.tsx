import { Link } from 'react-router-dom';
import { saveRecord, useRecord, useRecords } from '../../db/records';
import { Button, Card, PageTitle } from '../../components/ui';
import { buyNext, totals, type BuyNextRow } from '../../calc/budget';
import type { Gear } from '../../model/schemas';
import { costLabel, formatUsd, priorityLabel, splitBuyNext } from './format';
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
      <PageTitle sub="Wishlist in buying order, cheapest first within each priority.">Buy next</PageTitle>
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
  const { priced, unpriced } = splitBuyNext(rows);
  const cutoffIndex = priced.findIndex((r) => !r.fits);
  const spent = totals(gear, seasonBudget).spent;
  const remainingBudget = seasonBudget - spent;

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-ink-2">Nothing on the wishlist yet.</p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">{formatUsd(remainingBudget)}</span> left in the season budget ({formatUsd(spent)}{' '}
          of {formatUsd(seasonBudget)} already spent or ordered).
        </p>
      </Card>

      {priced.length > 0 && (
        <Card>
          <ul className="divide-y divide-line">
            {priced.map((r, i) => (
              <li key={r.item.id}>
                {i === cutoffIndex && (
                  <div className="my-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-warn">
                    <span className="h-px flex-1 bg-warn" />
                    Budget runs out here
                    <span className="h-px flex-1 bg-warn" />
                  </div>
                )}
                <BuyNextItemRow row={r} showRunningTotal />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {unpriced.length > 0 && (
        <Card>
          <details>
            <summary className="min-h-11 cursor-pointer list-none py-1 font-semibold marker:content-none">
              No price yet ({unpriced.length})
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {unpriced.map((r) => (
                <li key={r.item.id}>
                  <BuyNextItemRow row={r} showRunningTotal={false} />
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}
    </>
  );
}

function BuyNextItemRow({ row, showRunningTotal }: { row: BuyNextRow<Gear & { id: string }>; showRunningTotal: boolean }) {
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link to={`/gear/${row.item.id}`} className="block break-words font-semibold hover:underline">
          {row.item.name}
        </Link>
        <p className="text-sm text-ink-2">
          {priorityLabel(row.item.priority)} · {costLabel(row.cost)}
          {showRunningTotal && <> · running total {formatUsd(row.cumulative)}</>}
        </p>
      </div>
      <Button variant="secondary" className="self-start sm:shrink-0" onClick={() => void markOrdered(row.item)}>
        Mark ordered
      </Button>
    </div>
  );
}
