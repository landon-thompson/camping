import { Link } from 'react-router-dom';
import { useRecords } from '../../db/records';
import { Card } from '../../components/ui';
import { compareTripOrder } from './utils';
import { computeReadiness } from './readiness';

/** Home-screen card for Phase 2 (next trip, readiness). */
export function TripsDashboardCard() {
  const trips = useRecords('trip');
  const checklist = useRecords('trip_checklist_item');
  const reservations = useRecords('reservation');
  const campgrounds = useRecords('campground');
  const gear = useRecords('gear');
  const vehicle = useRecords('vehicle');
  const trailer = useRecords('trailer');
  const loadProfiles = useRecords('load_profile');
  const powerProfiles = useRecords('power_profile');

  if (trips.loading) return null;

  const upcoming = trips.rows
    .filter((t) => t.data.status !== 'done' && t.data.status !== 'cancelled')
    .sort((a, b) => compareTripOrder(a.data, b.data))[0];

  if (!upcoming) {
    return (
      <Card title="Next trip">
        <p className="text-ink-2">No trips planned yet.</p>
        <Link to="/trips" className="mt-2 inline-block font-semibold text-brand">
          Plan the season
        </Link>
      </Card>
    );
  }

  const items = checklist.rows.filter((i) => i.data.tripId === upcoming.id).map((i) => i.data);
  const checked = items.filter((i) => i.checked).length;
  const reservation = reservations.rows.find((r) => r.data.tripId === upcoming.id)?.data ?? null;
  const campground = upcoming.data.campgroundId ? (campgrounds.rows.find((c) => c.id === upcoming.data.campgroundId)?.data ?? null) : null;
  const tripGear = upcoming.data.gearIds.map((gid) => gear.rows.find((g) => g.id === gid)?.data).filter((g): g is NonNullable<typeof g> => !!g);
  const readiness = computeReadiness({
    trip: upcoming.data,
    checklistItems: items,
    reservation,
    campground,
    tripGear,
    vehicle: vehicle.rows[0]?.data ?? null,
    trailer: trailer.rows[0]?.data ?? null,
    loadProfile: loadProfiles.rows[0]?.data ?? null,
    powerProfile: powerProfiles.rows[0]?.data ?? null,
  });

  const days = upcoming.data.startDate ? Math.ceil((Date.parse(`${upcoming.data.startDate}T00:00:00`) - Date.now()) / 86_400_000) : null;

  return (
    <Card title="Next trip" action={<Link to={`/trips/${upcoming.id}`} className="min-h-11 content-center font-semibold text-brand">Open</Link>}>
      <p className="text-lg font-bold">
        Level {upcoming.data.level} · {upcoming.data.name}
      </p>
      <p className="text-ink-2">
        {days !== null ? (days >= 0 ? `${days} day${days === 1 ? '' : 's'} away` : 'In progress or past') : upcoming.data.targetWindow || 'No dates yet'}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-surface-2 p-2">
          <dt className="text-sm text-ink-2">Readiness</dt>
          <dd className="text-lg font-bold">{readiness.score}%</dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <dt className="text-sm text-ink-2">Checklist</dt>
          <dd className="text-lg font-bold">
            {items.length ? `${checked}/${items.length}` : '—'}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
