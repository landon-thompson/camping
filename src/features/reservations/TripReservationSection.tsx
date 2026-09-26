import { useState } from 'react';
import { newId, saveRecord, useRecord } from '../../db/records';
import { Card, inputClass } from '../../components/ui';
import type { Reservation, ReservationStatus } from '../../model/schemas';
import { campgroundTakesReservations, cancelDeadlineInfo, checkMaxNights, daysBetween, daysUntil, formatOpensAt, resolveBooking } from './booking';
import { reservationForTrip, useBookingRules, useCampgrounds, useReservations } from './data';
import { BookingStateBadge, ExternalLinkButton, numOrNull, SaveRow, useDraft } from './shared';

const PERMIT_ID = 'permit:mn-state-park-annual-2027';

/** Shown on each trip page (Phase 2 places it): campground choice, booking window, Book-now link, reservation details. */
export function TripReservationSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const { rows: campgrounds } = useCampgrounds();
  const { byAgency } = useBookingRules();
  const { rows: reservations } = useReservations();
  const permit = useRecord('permit', PERMIT_ID);

  if (trip.loading) return <p className="text-ink-2">Loading…</p>;
  if (!trip.data) return null;
  const tripData = trip.data;

  const campground = campgrounds.find((c) => c.id === tripData.campgroundId);
  const rule = campground ? byAgency[campground.data.agency]?.data : undefined;
  const reservation = reservationForTrip(reservations, tripId);
  const now = new Date();
  const resolved = campground && rule ? resolveBooking(now, tripData.startDate, rule, campground.data) : null;
  const nights = tripData.startDate && tripData.endDate ? daysBetween(tripData.startDate, tripData.endDate) : null;

  return (
    <Card title="Reservation">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Campground</span>
          <select
            className={inputClass}
            value={tripData.campgroundId ?? ''}
            onChange={(e) => void saveRecord('trip', tripId, { ...tripData, campgroundId: e.target.value || null })}
          >
            <option value="">Choose a campground…</option>
            {campgrounds
              .slice()
              .sort((a, b) => a.data.name.localeCompare(b.data.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.data.name}
                </option>
              ))}
          </select>
        </label>

        {campground && rule && resolved && (
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <BookingStateBadge state={resolved.state} />
              {campgroundTakesReservations(campground.data.bookingSystem) && (
                <ExternalLinkButton href={campground.data.bookingUrl} variant="secondary">
                  Book now
                </ExternalLinkButton>
              )}
            </div>
            {resolved.state === 'not-open' && resolved.opensAt && (
              <p className="mt-2 text-sm text-info">
                Booking opens in {daysUntil(now, resolved.opensAt, rule.timeZone)} day{daysUntil(now, resolved.opensAt, rule.timeZone) === 1 ? '' : 's'} —{' '}
                {formatOpensAt(resolved.opensAt, rule.timeZone)}
              </p>
            )}
            {!campgroundTakesReservations(campground.data.bookingSystem) && (
              <p className="mt-2 text-sm text-ink-2">
                {campground.data.bookingSystem === 'dispersed' ? 'Dispersed camping — no booking needed.' : 'First-come, first-served — no advance booking.'}
              </p>
            )}
            {reservation?.data.status === 'waitlisted' && (
              <p className="mt-2 rounded-lg bg-warn-bg p-2 text-sm text-warn">
                Waitlisted — set the official “notify me” cancellation alert on {rule.bookingSystem === 'reservemn' ? 'ReserveMN' : 'Recreation.gov'} so you hear
                about a cancellation the moment it opens up.
              </p>
            )}
            {nights !== null && !checkMaxNights(nights, rule.maxNights).ok && (
              <p className="mt-2 rounded-lg bg-warn-bg p-2 text-sm text-warn">{checkMaxNights(nights, rule.maxNights).message}</p>
            )}
          </div>
        )}

        {campground?.data.agency === 'mn-state-park' && permit.data && (
          <p className={`text-sm ${permit.data.have ? 'text-ok' : 'text-warn'}`}>
            State park vehicle permit: {permit.data.have ? 'have it' : 'not marked as purchased yet — required in addition to the campsite reservation'}.
          </p>
        )}

        <ReservationForm
          tripId={tripId}
          existing={reservation}
          defaultArrival={tripData.startDate}
          defaultNights={nights}
          campgroundId={tripData.campgroundId}
        />
      </div>
    </Card>
  );
}

const BLANK_RESERVATION = (tripId: string, campgroundId: string | null, arrivalDate: string | null, nights: number | null): Reservation => ({
  tripId,
  campgroundId,
  status: 'planned',
  arrivalDate,
  nights,
  confirmation: '',
  site: '',
  costUsd: null,
  feesUsd: null,
  cancelDeadline: null,
  notifyMeSet: false,
  notes: '',
});

function ReservationForm({
  tripId,
  existing,
  defaultArrival,
  defaultNights,
  campgroundId,
}: {
  tripId: string;
  existing: { id: string; data: Reservation } | undefined;
  defaultArrival: string | null;
  defaultNights: number | null;
  campgroundId: string | null;
}) {
  const [newId_] = useState(() => newId('reservation'));
  const id = existing?.id ?? newId_;
  const initial = existing?.data ?? BLANK_RESERVATION(tripId, campgroundId, defaultArrival, defaultNights);
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('reservation', id, initial);
  const today = new Date().toISOString().slice(0, 10);
  const cancel = cancelDeadlineInfo(today, draft.cancelDeadline);

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-line pt-4">
      <p className="text-sm font-semibold text-ink-2">{existing ? 'Reservation details' : 'Add reservation details'}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Status</span>
          <select className={inputClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ReservationStatus })}>
            <option value="planned">Planned</option>
            <option value="booked">Booked</option>
            <option value="waitlisted">Waitlisted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Confirmation #</span>
          <input className={inputClass} value={draft.confirmation} onChange={(e) => setDraft({ ...draft, confirmation: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Arrival date</span>
          <input
            className={inputClass}
            type="date"
            value={draft.arrivalDate ?? ''}
            onChange={(e) => setDraft({ ...draft, arrivalDate: e.target.value || null })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Nights</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={draft.nights ?? ''}
            onChange={(e) => setDraft({ ...draft, nights: e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))) })}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Site #</span>
        <input className={inputClass} value={draft.site} onChange={(e) => setDraft({ ...draft, site: e.target.value })} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Cost (USD)</span>
          <input className={inputClass} inputMode="decimal" type="number" min={0} value={draft.costUsd ?? ''} onChange={(e) => setDraft({ ...draft, costUsd: numOrNull(e.target.value) })} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Fees (USD)</span>
          <input className={inputClass} inputMode="decimal" type="number" min={0} value={draft.feesUsd ?? ''} onChange={(e) => setDraft({ ...draft, feesUsd: numOrNull(e.target.value) })} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Cancellation deadline</span>
        <input
          className={inputClass}
          type="date"
          value={draft.cancelDeadline ?? ''}
          onChange={(e) => setDraft({ ...draft, cancelDeadline: e.target.value || null })}
        />
        {cancel.daysLeft !== null && (
          <span className={`mt-1 block text-sm ${cancel.overdue ? 'text-bad' : cancel.warn ? 'text-warn' : 'text-ink-2'}`}>
            {cancel.overdue ? 'This deadline has passed.' : `${cancel.daysLeft} day${cancel.daysLeft === 1 ? '' : 's'} left to cancel penalty-free.`}
          </span>
        )}
      </label>

      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="h-5 w-5" checked={draft.notifyMeSet} onChange={(e) => setDraft({ ...draft, notifyMeSet: e.target.checked })} />
        <span>Official “notify me” cancellation alert set</span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Notes</span>
        <textarea className={`${inputClass} min-h-20 py-2`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>

      <SaveRow dirty={dirty} saved={saved} error={error} />
    </form>
  );
}
