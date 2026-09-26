import { Link } from 'react-router-dom';
import { useRecord, useRecords } from '../../db/records';
import { Card } from '../../components/ui';
import { buyNext, totals } from '../../calc/budget';
import { costLabel, formatUsd } from './format';

/** Home-screen card for Phase 1 (budget summary, buy next). */
export function GearDashboardCard() {
  const settings = useRecord('settings', 'settings');
  const gear = useRecords('gear');
  if (settings.loading || gear.loading || !settings.data) return null;

  const items = gear.rows.map((g) => ({ ...g.data, id: g.id }));
  const t = totals(items, settings.data.seasonBudgetUsd);
  const next = buyNext(items, settings.data.seasonBudgetUsd).slice(0, 3);

  return (
    <Card
      title="Gear budget"
      action={
        <Link to="/gear" className="min-h-11 content-center font-semibold text-brand">
          View all
        </Link>
      }
    >
      <dl className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Spent" value={formatUsd(t.spent)} />
        <Stat label="Planned" value={formatUsd(t.planned)} />
        <Stat label="Remaining" value={formatUsd(t.remaining)} bad={t.remaining < 0} />
      </dl>
      {next.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold text-ink-2">Buy next</p>
          <ul className="space-y-1 text-sm">
            {next.map((r) => (
              <li key={r.item.id} className="flex justify-between gap-2">
                <span className="truncate">{r.item.name}</span>
                <span className="shrink-0 text-ink-2">{costLabel(r.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className={`text-lg font-bold ${bad ? 'text-bad' : ''}`}>{value}</dd>
    </div>
  );
}
