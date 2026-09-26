import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId, saveRecord, useRecords } from '../../db/records';
import { Button, Card, PageTitle } from '../../components/ui';
import { MN_CENTER } from '../../lib/map';
import type { Trip, TripStatus } from '../../model/schemas';
import { TripMap, type TripMapMarker } from './TripMap';
import { compareTripOrder, tripNights } from './utils';
import { computeReadiness } from './readiness';

const statusLabel: Record<TripStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  booked: 'Booked',
  done: 'Done',
  cancelled: 'Cancelled',
};

const statusStyle: Record<TripStatus, string> = {
  idea: 'bg-surface-2 text-ink-2',
  planned: 'bg-info-bg text-info',
  booked: 'bg-ok/10 text-ok',
  done: 'bg-surface-2 text-ink-2',
  cancelled: 'bg-bad-bg text-bad',
};

function formatDates(trip: Trip): string {
  if (trip.startDate && trip.endDate) {
    const nights = tripNights(trip);
    const start = new Date(`${trip.startDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const end = new Date(`${trip.endDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${start} – ${end}${nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}`;
  }
  return trip.targetWindow || 'No dates yet';
}

export function TripsListPage() {
  const navigate = useNavigate();
  const settings = useRecords('settings');
  const trips = useRecords('trip');
  const checklist = useRecords('trip_checklist_item');
  const reservations = useRecords('reservation');
  const campgrounds = useRecords('campground');
  const gear = useRecords('gear');
  const vehicle = useRecords('vehicle');
  const trailer = useRecords('trailer');
  const loadProfiles = useRecords('load_profile');
  const powerProfiles = useRecords('power_profile');

  const homeBase = settings.rows[0]?.data.homeBase ?? null;
  const vehicleData = vehicle.rows[0]?.data ?? null;
  const trailerData = trailer.rows[0]?.data ?? null;
  const loadProfile = loadProfiles.rows[0]?.data ?? null;
  const powerProfile = powerProfiles.rows[0]?.data ?? null;

  const sorted = useMemo(() => [...trips.rows].sort((a, b) => compareTripOrder(a.data, b.data)), [trips.rows]);

  const markers: TripMapMarker[] = useMemo(() => {
    const out: TripMapMarker[] = [];
    if (homeBase?.lat != null && homeBase.lng != null) {
      out.push({ id: 'home', lat: homeBase.lat, lng: homeBase.lng, label: '⌂', variant: 'home' });
    }
    for (const t of sorted) {
      if (t.data.location) out.push({ id: t.id, lat: t.data.location.lat, lng: t.data.location.lng, label: String(t.data.level) });
    }
    return out;
  }, [homeBase, sorted]);

  const center: [number, number] = homeBase?.lat != null && homeBase.lng != null ? [homeBase.lng, homeBase.lat] : MN_CENTER;

  async function addTrip() {
    const id = newId('trip');
    const nextLevel = trips.rows.length ? Math.max(...trips.rows.map((t) => t.data.level)) : 1;
    const data: Trip = {
      name: 'New trip',
      level: Math.min(5, nextLevel || 1),
      status: 'idea',
      targetWindow: '',
      startDate: null,
      endDate: null,
      kinds: [],
      towing: false,
      campgroundId: null,
      location: null,
      boatLaunch: null,
      gearIds: [],
      peakSunHours: null,
      notes: '',
    };
    await saveRecord('trip', id, data);
    navigate(`/trips/${id}`);
  }

  return (
    <div className="space-y-4">
      <PageTitle sub="The 2027 season, one trip per progression level">Trips</PageTitle>

      <Card title="Season map">
        <TripMap center={center} zoom={6} markers={markers} tripId={null} className="h-64 w-full" />
      </Card>

      <div className="space-y-3">
        {sorted.map((t) => {
          const items = checklist.rows.filter((i) => i.data.tripId === t.id).map((i) => i.data);
          const checked = items.filter((i) => i.checked).length;
          const reservation = reservations.rows.find((r) => r.data.tripId === t.id)?.data ?? null;
          const campground = t.data.campgroundId ? (campgrounds.rows.find((c) => c.id === t.data.campgroundId)?.data ?? null) : null;
          const tripGear = t.data.gearIds.map((gid) => gear.rows.find((g) => g.id === gid)?.data).filter((g): g is NonNullable<typeof g> => !!g);
          const readiness = computeReadiness({
            trip: t.data,
            checklistItems: items,
            reservation,
            campground,
            tripGear,
            vehicle: vehicleData,
            trailer: trailerData,
            loadProfile,
            powerProfile,
          });
          return (
            <button
              key={t.id}
              onClick={() => navigate(`/trips/${t.id}`)}
              className="block min-h-16 w-full rounded-2xl border border-line bg-surface p-4 text-left shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-2">Level {t.data.level}</p>
                  <p className="text-lg font-bold">{t.data.name}</p>
                  <p className="text-sm text-ink-2">{formatDates(t.data)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${statusStyle[t.data.status]}`}>
                  {statusLabel[t.data.status]}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm text-ink-2">
                <span>Readiness {readiness.score}%</span>
                {items.length > 0 && (
                  <span>
                    Checklist {checked}/{items.length}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {sorted.length === 0 && !trips.loading && <Card>No trips yet — add the first one below.</Card>}
      </div>

      <Button onClick={() => void addTrip()} className="w-full">
        + New trip
      </Button>
    </div>
  );
}
