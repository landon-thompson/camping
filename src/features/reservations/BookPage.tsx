import { Link } from 'react-router-dom';
import { Card, PageTitle } from '../../components/ui';
import { useRecord, useRecords, type Row } from '../../db/records';
import type { BookingRule, Campground, Permit, Reservation, Trip } from '../../model/schemas';
import { daysUntil, formatOpensAt, resolveBooking, type ResolvedBooking } from './booking';
import { reservationForTrip, useBookingRules, useCampgrounds, useReservations } from './data';
import { BookingStateBadge, NavButton } from './shared';

const PERMIT_ID = 'permit:mn-state-park-annual-2027';

/** Sort weight — lower sorts first. "Action needed" (book now, or a countdown ticking) floats to the top. */
function urgency(resolved: ResolvedBooking | null, reservationStatus: string | undefined): number {
  if (!resolved) return 0; // no campground chosen yet
  if (resolved.state === 'open' || resolved.state === 'opens-today') return reservationStatus === 'booked' ? 4 : 1;
  if (reservationStatus === 'waitlisted') return 1;
  if (resolved.state === 'not-open') return 2;
  if (resolved.state === 'no-booking-needed') return reservationStatus ? 4 : 3;
  return 5; // past
}

interface TripRowData {
  trip: Row<Trip>;
  campground: Row<Campground> | undefined;
  rule: BookingRule | undefined;
  resolved: ResolvedBooking | null;
  reservation: Row<Reservation> | undefined;
}

/** /book — every trip's booking status, action-needed first. */
export function BookPage() {
  const trips = useRecords('trip');
  const { rows: campgrounds } = useCampgrounds();
  const { byAgency } = useBookingRules();
  const { rows: reservations } = useReservations();
  const permit = useRecord('permit', PERMIT_ID);
  const now = new Date();

  const rows: TripRowData[] = trips.rows
    .map((t) => {
      const campground = campgrounds.find((c) => c.id === t.data.campgroundId);
      const rule = campground ? byAgency[campground.data.agency]?.data : undefined;
      const resolved = campground && rule ? resolveBooking(now, t.data.startDate, rule, campground.data) : null;
      const reservation = reservationForTrip(reservations, t.id);
      return { trip: t, campground, rule, resolved, reservation };
    })
    .sort((a, b) => urgency(a.resolved, a.reservation?.data.status) - urgency(b.resolved, b.reservation?.data.status));

  return (
    <div className="space-y-4">
      <PageTitle sub="Booking windows, deep links and reservation tracking for every trip.">Book</PageTitle>

      <PermitCard permit={permit.data} />

      <div className="flex gap-3">
        <NavButton to="/book/campgrounds" variant="secondary">
          Campground directory
        </NavButton>
        <NavButton to="/book/rules" variant="secondary">
          Booking rules
        </NavButton>
      </div>

      {trips.loading && <p className="text-ink-2">Loading…</p>}
      {!trips.loading && rows.length === 0 && <p className="text-ink-2">No trips yet — add one on the Trips tab, then come back here to book it.</p>}

      <div className="space-y-3">
        {rows.map((row) => (
          <TripRow key={row.trip.id} {...row} />
        ))}
      </div>
    </div>
  );
}

function PermitCard({ permit }: { permit: Permit | undefined }) {
  if (!permit) return null;
  return (
    <Card title="MN state park vehicle permit">
      <p className={permit.have ? 'text-ok' : 'text-warn'}>
        {permit.have ? `Have it${permit.expires ? ` — expires ${permit.expires}` : ''}.` : 'Not marked as purchased yet.'}
      </p>
      <p className="mt-1 text-sm text-ink-2">{permit.notes}</p>
    </Card>
  );
}

function TripRow({ trip, campground, rule, resolved, reservation }: TripRowData) {
  const now = new Date();
  return (
    <Link to={`/trips/${encodeURIComponent(trip.id)}`} className="block">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{trip.data.name}</p>
            <p className="text-sm text-ink-2">
              {campground ? campground.data.name : 'No campground chosen yet'}
              {trip.data.startDate && ` · arriving ${trip.data.startDate}`}
            </p>
            {resolved?.state === 'not-open' && resolved.opensAt && rule && (
              <p className="mt-1 text-sm font-semibold text-info">
                Booking opens in {daysUntil(now, resolved.opensAt, rule.timeZone)} day{daysUntil(now, resolved.opensAt, rule.timeZone) === 1 ? '' : 's'} —{' '}
                {formatOpensAt(resolved.opensAt, rule.timeZone)}
              </p>
            )}
            {reservation && <p className="mt-1 text-sm text-ink-2">Reservation: {reservation.data.status}</p>}
          </div>
          {resolved && <BookingStateBadge state={resolved.state} />}
        </div>
      </Card>
    </Link>
  );
}
