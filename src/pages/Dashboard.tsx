import { Link } from 'react-router-dom';
import { useRecord } from '../db/records';
import { Card, PageTitle, StatusChip } from '../components/ui';
import { InstallHint } from '../components/InstallHint';
import { describeSync } from '../components/SyncBadge';
import { useSyncStatus } from '../sync/useSync';
import type { SpecNumber } from '../model/schemas';
import { TripsDashboardCard } from '../features/trips/DashboardCard';
import { BookingDashboardCard } from '../features/reservations/DashboardCard';
import { GearDashboardCard } from '../features/gear/DashboardCard';

const fmtLb = (s: SpecNumber) =>
  s.value === null ? <span aria-label="not set">—</span> : (
    <>
      {s.value.toLocaleString()}
      <span className="text-sm font-semibold"> lb</span>
    </>
  );

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
        <Card title={`${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`} action={<Link to="/settings" className="min-h-11 content-center font-semibold text-brand" aria-label="Edit vehicle limits">Edit</Link>}>
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

      <TripsDashboardCard />
      <BookingDashboardCard />
      <GearDashboardCard />
    </div>
  );
}
