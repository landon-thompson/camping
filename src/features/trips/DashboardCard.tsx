import { Link } from 'react-router-dom';
import { useRecord, useRecords } from '../../db/records';
import { Card } from '../../components/ui';
import { buyNext, totals } from '../../calc/budget';
import { costLabel, formatUsd } from '../gear/format';
import { daysUntil, formatOpensAt, resolveBooking } from '../reservations/booking';
import { reservationForTrip, useBookingRules, useCampgrounds, useReservations } from '../reservations/data';
import { compareTripOrder } from './utils';
import { computeReadiness } from './readiness';

/**
 * Home-screen "Up next" card: replaces the old separate trip/booking/gear cards
 * with one concise summary — the next trip and its readiness, the next booking
 * window to open, and a one-line budget status. Reuses each phase's own hooks
 * and pure calculators (readiness.ts, calc/budget.ts, reservations/booking.ts).
 */
export function UpNextCard() {
  const trips = useRecords('trip');
  const checklist = useRecords('trip_checklist_item');
  const gear = useRecords('gear');
  const vehicle = useRecords('vehicle');
  const trailer = useRecords('trailer');
  const loadProfiles = useRecords('load_profile');
  const powerProfiles = useRecords('power_profile');
  const settings = useRecord('settings', 'settings');
  const { rows: campgrounds } = useCampgrounds();
  const { byAgency } = useBookingRules();
  const { rows: reservations } = useReservations();

  if (trips.loading) return null;

  const upcoming = trips.rows
    .filter((t) => t.data.status !== 'done' && t.data.status !== 'cancelled')
    .sort((a, b) => compareTripOrder(a.data, b.data))[0];

  const now = new Date();
  const nextBooking = trips.rows
    .map((t) => {
      const campground = campgrounds.find((c) => c.id === t.data.campgroundId);
      const rule = campground ? byAgency[campground.data.agency]?.data : undefined;
      const resolved = campground && rule ? resolveBooking(now, t.data.startDate, rule, campground.data) : null;
      const reservation = reservationForTrip(reservations, t.id);
      return { trip: t, rule, resolved, reservation };
    })
    .filter(
      (r) =>
        r.resolved &&
        r.rule &&
        (r.resolved.state === 'not-open' || r.resolved.state === 'opens-today' || r.resolved.state === 'open') &&
        r.reservation?.data.status !== 'booked',
    )
    .sort((a, b) => (a.resolved!.opensAt?.getTime() ?? 0) - (b.resolved!.opensAt?.getTime() ?? 0))[0];

  const items = gear.rows.map((g) => ({ ...g.data, id: g.id }));
  const budget = settings.data ? totals(items, settings.data.seasonBudgetUsd) : null;
  const buyNextItems = settings.data ? buyNext(items, settings.data.seasonBudgetUsd).slice(0, 3) : [];

  let tripBody: { level: number; name: string; sub: string; readinessPct: number } | null = null;
  if (upcoming) {
    const checklistItems = checklist.rows.filter((i) => i.data.tripId === upcoming.id).map((i) => i.data);
    const checked = checklistItems.filter((i) => i.checked).length;
    const reservation = reservations.find((r) => r.data.tripId === upcoming.id)?.data ?? null;
    const campground = upcoming.data.campgroundId
      ? (campgrounds.find((c) => c.id === upcoming.data.campgroundId)?.data ?? null)
      : null;
    const tripGear = upcoming.data.gearIds
      .map((gid) => gear.rows.find((g) => g.id === gid)?.data)
      .filter((g): g is NonNullable<typeof g> => !!g);
    const readiness = computeReadiness({
      trip: upcoming.data,
      checklistItems,
      reservation,
      campground,
      tripGear,
      vehicle: vehicle.rows[0]?.data ?? null,
      trailer: trailer.rows[0]?.data ?? null,
      loadProfile: loadProfiles.rows[0]?.data ?? null,
      powerProfile: powerProfiles.rows[0]?.data ?? null,
    });
    const days = upcoming.data.startDate
      ? Math.ceil((Date.parse(`${upcoming.data.startDate}T00:00:00`) - Date.now()) / 86_400_000)
      : null;
    const when = days !== null ? (days >= 0 ? `${days} day${days === 1 ? '' : 's'} away` : 'In progress or past') : upcoming.data.targetWindow || 'No dates yet';
    const checklistSub = checklistItems.length ? ` · Checklist ${checked}/${checklistItems.length}` : '';
    tripBody = { level: upcoming.data.level, name: upcoming.data.name, sub: `${when}${checklistSub}`, readinessPct: readiness.score };
  }

  return (
    <Card title="Up next">
      <div className="space-y-4">
        {tripBody ? (
          <Link to={`/trips/${upcoming!.id}`} className="block">
            <p className="text-lg font-bold">
              Level {tripBody.level} · {tripBody.name}
            </p>
            <p className="text-ink-2">
              {tripBody.sub} · Readiness {tripBody.readinessPct}%
            </p>
          </Link>
        ) : (
          <div>
            <p className="text-ink-2">No trips planned yet.</p>
            <Link to="/trips" className="mt-1 inline-block font-semibold text-brand">
              Plan the season
            </Link>
          </div>
        )}

        {nextBooking && (
          <Link to={`/trips/${nextBooking.trip.id}`} className="block border-t border-line pt-3">
            <p className="text-sm font-semibold text-ink-2">Booking window · {nextBooking.trip.data.name}</p>
            {nextBooking.resolved!.state === 'open' || nextBooking.resolved!.state === 'opens-today' ? (
              <p className="font-semibold text-ok">Book now{nextBooking.resolved!.state === 'opens-today' ? ' — opens today' : ''}</p>
            ) : (
              nextBooking.resolved!.opensAt && (
                <p className="text-info">
                  Opens in {daysUntil(now, nextBooking.resolved!.opensAt, nextBooking.rule!.timeZone)} days — {formatOpensAt(nextBooking.resolved!.opensAt, nextBooking.rule!.timeZone)}
                </p>
              )
            )}
          </Link>
        )}

        {budget && (
          <div className="border-t border-line pt-3">
            <Link to="/gear/budget" className="block">
              <p className="text-sm font-semibold text-ink-2">Gear budget</p>
              <p className="font-semibold">
                {formatUsd(budget.spent)} spent · {formatUsd(budget.planned)} planned ·{' '}
                <span className={budget.remaining < 0 ? 'text-bad' : ''}>{formatUsd(budget.remaining)} left</span>
              </p>
            </Link>
            {buyNextItems.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {buyNextItems.map((r) => (
                  <li key={r.item.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{r.item.name}</span>
                    <span className="shrink-0 text-ink-2">{costLabel(r.cost)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
