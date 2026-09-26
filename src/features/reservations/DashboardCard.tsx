import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';
import { useRecords } from '../../db/records';
import { daysUntil, formatOpensAt, resolveBooking } from './booking';
import { reservationForTrip, useBookingRules, useCampgrounds, useReservations } from './data';

/** Home-screen card for Phase 3: the next few booking windows and anything needing action. */
export function BookingDashboardCard() {
  const trips = useRecords('trip');
  const { rows: campgrounds } = useCampgrounds();
  const { byAgency } = useBookingRules();
  const { rows: reservations } = useReservations();
  const now = new Date();

  const upcoming = trips.rows
    .map((t) => {
      const campground = campgrounds.find((c) => c.id === t.data.campgroundId);
      const rule = campground ? byAgency[campground.data.agency]?.data : undefined;
      const resolved = campground && rule ? resolveBooking(now, t.data.startDate, rule, campground.data) : null;
      const reservation = reservationForTrip(reservations, t.id);
      return { trip: t, rule, resolved, reservation };
    })
    .filter((r) => r.resolved && r.rule && (r.resolved.state === 'not-open' || r.resolved.state === 'opens-today' || r.resolved.state === 'open') && r.reservation?.data.status !== 'booked')
    .sort((a, b) => (a.resolved!.opensAt?.getTime() ?? 0) - (b.resolved!.opensAt?.getTime() ?? 0))
    .slice(0, 3);

  if (trips.loading || upcoming.length === 0) return null;

  return (
    <Card title="Booking windows">
      <ul className="space-y-3">
        {upcoming.map(({ trip, rule, resolved }) => (
          <li key={trip.id}>
            <p className="font-semibold">{trip.data.name}</p>
            {resolved!.state === 'open' || resolved!.state === 'opens-today' ? (
              <p className="text-sm font-semibold text-ok">Book now{resolved!.state === 'opens-today' ? ' — opens today' : ''}</p>
            ) : (
              resolved!.opensAt && rule && (
                <p className="text-sm text-info">
                  Opens in {daysUntil(now, resolved!.opensAt, rule.timeZone)} days — {formatOpensAt(resolved!.opensAt, rule.timeZone)}
                </p>
              )
            )}
          </li>
        ))}
      </ul>
      <Link to="/book" className="mt-3 inline-block min-h-11 content-center font-semibold text-brand">
        See all bookings
      </Link>
    </Card>
  );
}
