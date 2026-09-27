import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageTitle } from '../../components/ui';
import { useRecord, useRecords, type Row } from '../../db/records';
import type { BookingRule, Campground, Permit, Reservation, Trip } from '../../model/schemas';
import { bookingRowStatus, resolveBooking, type BookingRowStatus, type ResolvedBooking } from './booking';
import { reservationForTrip, useBookingRules, useCampgrounds, useReservations } from './data';
import { NavButton } from './shared';

const PERMIT_ID = 'permit:mn-state-park-annual-2027';

interface TripRowData {
  trip: Row<Trip>;
  campground: Row<Campground> | undefined;
  rule: BookingRule | undefined;
  resolved: ResolvedBooking | null;
  reservation: Row<Reservation> | undefined;
  status: BookingRowStatus;
}

const TONE_CLASS: Record<BookingRowStatus['tone'], string> = {
  attention: 'text-warn',
  ok: 'text-ok',
  info: 'text-info',
  neutral: 'text-ink-2',
};

/** Sets the trip page's remembered tab to Book before navigating there, so the row opens straight to it. */
function goToBookTab() {
  try {
    sessionStorage.setItem('tripTab', 't-reservation');
  } catch {
    /* private mode: the trip page just opens on its usual first tab */
  }
}

/** /book — every trip's booking status, sorted by what needs attention first. */
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
      const status = bookingRowStatus(now, !!campground, resolved, rule?.timeZone, reservation?.data);
      return { trip: t, campground, rule, resolved, reservation, status };
    })
    .sort((a, b) => a.status.urgency - b.status.urgency);

  return (
    <div className="space-y-4">
      <PageTitle sub="Where each trip stands with booking, most urgent first.">Book</PageTitle>

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
  const [open, setOpen] = useState(false);
  if (!permit) return null;
  return (
    <Card>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`font-semibold ${permit.have ? 'text-ok' : 'text-warn'}`}>
          State park vehicle permit: {permit.have ? `have it${permit.expires ? ` — expires ${permit.expires}` : ''}` : 'not purchased yet'}
        </span>
        <span className="text-sm text-ink-2">{open ? 'Hide' : 'Details'}</span>
      </button>
      {open && <p className="mt-2 text-sm text-ink-2">{permit.notes}</p>}
    </Card>
  );
}

function TripRow({ trip, campground, status }: TripRowData) {
  return (
    <Link to={`/trips/${encodeURIComponent(trip.id)}`} onClick={goToBookTab} className="block">
      <Card>
        <p className="font-semibold">{trip.data.name}</p>
        {campground && <p className="text-sm text-ink-2">{campground.data.name}</p>}
        <p className={`mt-1 text-sm font-semibold ${TONE_CLASS[status.tone]}`}>{status.label}</p>
      </Card>
    </Link>
  );
}
