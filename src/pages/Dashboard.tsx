import { Link } from 'react-router-dom';
import { useRecord } from '../db/records';
import { Card, PageTitle, StatusChip } from '../components/ui';
import { InstallHint } from '../components/InstallHint';
import { describeSync } from '../components/SyncBadge';
import { useSyncStatus } from '../sync/useSync';
import type { SpecNumber } from '../model/schemas';

const fmtLb = (s: SpecNumber) =>
  s.value === null ? '—' : (
    <>
      {s.value.toLocaleString()}
      <span className="text-sm font-semibold"> lb</span>
    </>
  );

const ROADMAP = [
  { phase: 'Phase 1', text: 'Gear list & budget, load/tow and power calculators, checklists' },
  { phase: 'Phase 2', text: 'Trips on a season map, trip pages, readiness score, share link' },
  { phase: 'Phase 3', text: 'Campground directory, booking-window countdowns, reservation tracking' },
  { phase: 'Phase 4', text: 'onX GPX/KML import & export, MVUM roads, pins, offline map download' },
  { phase: 'Phase 5', text: 'Weather, trip debriefs with photos, polish' },
];

export function Dashboard() {
  const settings = useRecord('settings', 'settings').data;
  const vehicle = useRecord('vehicle', 'vehicle:gx550').data;
  const sync = useSyncStatus();

  return (
    <div className="space-y-4">
      <PageTitle sub={settings ? `${settings.seasonYear} season · home base ${settings.homeBase.name}` : undefined}>
        {settings?.householdName ?? 'Camp Planner'}
      </PageTitle>

      <InstallHint />

      <Card title="Sync">
        <p className="text-ink-2">{describeSync(sync.state, sync.message)}</p>
        {sync.lastSyncedAt && (
          <p className="mt-2 text-sm text-ink-2">Last synced {new Date(sync.lastSyncedAt).toLocaleString()}</p>
        )}
      </Card>

      {vehicle && (
        <Card title={`${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`} action={<Link to="/settings" className="min-h-11 content-center font-semibold text-brand">Edit</Link>}>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {(
              [
                ['Payload', vehicle.payloadLb],
                ['Tow rating', vehicle.towRatingLb],
                ['Roof limit', vehicle.roofLimitLb],
              ] as const
            ).map(([label, spec]) => (
              <div key={label} className="rounded-xl bg-surface-2 p-2">
                <dt className="text-sm text-ink-2">{label}</dt>
                <dd className="whitespace-nowrap text-lg font-bold">{fmtLb(spec)}</dd>
                <dd>
                  <StatusChip status={spec.status} />
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {settings && (
        <Card title="Gear budget">
          <p className="text-3xl font-bold">${settings.seasonBudgetUsd.toLocaleString()}</p>
          <p className="text-ink-2">Season total — spending and category budgets arrive with the gear list in Phase 1.</p>
        </Card>
      )}

      <Card title="Coming next">
        <ol className="space-y-2">
          {ROADMAP.map((r) => (
            <li key={r.phase} className="flex gap-3">
              <span className="shrink-0 font-semibold text-brand">{r.phase}</span>
              <span className="text-ink-2">{r.text}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
