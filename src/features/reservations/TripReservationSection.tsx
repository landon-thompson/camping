import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { newId, saveRecord, useRecord } from '../../db/records';
import { Button, Card, inputClass } from '../../components/ui';
import type { Campground, Reservation, ReservationStatus, Trip } from '../../model/schemas';
import { campgroundTakesReservations, cancelDeadlineInfo, checkMaxNights, daysBetween, daysUntil, formatOpensAt, resolveBooking } from './booking';
import { useCampgroundLookup } from '../places/useCampgroundLookup';
import { db } from '../../db/local';
import { locationForCampground, parseConfirmation, tripUpdateFromReservation } from './confirmation';
import { reservationForTrip, useBookingRules, useCampgrounds, useReservations } from './data';
import { BookingStateBadge, bookingLink, ExternalLinkButton, GenericLinkHint, isGenericBookingUrl, numOrNull, SaveRow, useDraft } from './shared';

const PERMIT_ID = 'permit:mn-state-park-annual-2027';

// Remembers that Book now was tapped, so coming back to the app can ask "did you book?".
const bookingKey = (tripId: string) => `camp.bookingStarted.${tripId}`;
function readBookingFlag(tripId: string): boolean {
  try {
    const t = Number(sessionStorage.getItem(bookingKey(tripId)));
    return t > 0 && Date.now() - t < 12 * 3600_000;
  } catch {
    return false;
  }
}
function setBookingFlag(tripId: string, on: boolean) {
  try {
    if (on) sessionStorage.setItem(bookingKey(tripId), String(Date.now()));
    else sessionStorage.removeItem(bookingKey(tripId));
  } catch {
    /* private mode: no prompt, nothing else lost */
  }
}

/** Shown on each trip page (Phase 2 places it): campground choice, booking window, Book-now link, reservation details. */
export function TripReservationSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const { rows: campgrounds } = useCampgrounds();
  const { byAgency } = useBookingRules();
  const { rows: reservations } = useReservations();
  const permit = useRecord('permit', PERMIT_ID);
  const [backFromBooking, setBackFromBooking] = useState(() => readBookingFlag(tripId));
  const [pasteOpen, setPasteOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const { status: lookupStatus, lookup } = useCampgroundLookup();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setBackFromBooking(readBookingFlag(tripId));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [tripId]);

  if (trip.loading) return <p className="text-ink-2">Loading…</p>;
  if (!trip.data) return null;
  const tripData = trip.data;

  const campground = campgrounds.find((c) => c.id === tripData.campgroundId);
  const rule = campground ? byAgency[campground.data.agency]?.data : undefined;
  const reservation = reservationForTrip(reservations, tripId);
  const now = new Date();
  const resolved = campground && rule ? resolveBooking(now, tripData.startDate, rule, campground.data) : null;
  const nights = tripData.startDate && tripData.endDate ? daysBetween(tripData.startDate, tripData.endDate) : null;
  const booked = reservation?.data.status === 'booked';
  const findLocation = (cgId: string, cg: Campground) =>
    lookup(cgId, cg, async (found) => {
      // Only move the pin if the trip still uses this campground.
      const latest = (await db.records.get(tripId))?.data as Trip | undefined;
      if (!latest || latest.campgroundId !== cgId || !found.location) return;
      await saveRecord('trip', tripId, { ...latest, location: { ...found.location, label: found.name } });
    });
  const startBooking = () => {
    setBookingFlag(tripId, true);
    setBackFromBooking(false); // shown when the app comes back into view
  };
  const openPaste = () => {
    setPasteOpen(true);
    setBackFromBooking(false);
    setBookingFlag(tripId, false);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <Card title="Reservation">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Campground</span>
          <select
            className={inputClass}
            value={tripData.campgroundId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const next = campgrounds.find((c) => c.id === id)?.data;
              // The trip's map pin and weather follow the chosen campground.
              const location = locationForCampground(tripData.location, campground?.data, next);
              void saveRecord('trip', tripId, { ...tripData, campgroundId: id, location });
              if (reservation && reservation.data.status !== 'booked') {
                void saveRecord('reservation', reservation.id, { ...reservation.data, campgroundId: id });
              }
              // No pin yet: look it up in official data, then move the trip there.
              if (id && next && !next.location) void findLocation(id, next);
            }}
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
          {lookupStatus.state === 'busy' && (
            <span role="status" className="mt-1 block text-sm text-ink-2">
              Looking up the campground’s location in official data…
            </span>
          )}
          {lookupStatus.state === 'found' && campground?.data.location && (
            <span role="status" className="mt-1 block text-sm text-ok">
              Location found ({lookupStatus.source}). The trip’s map pin moved there.
            </span>
          )}
          {campground && !campground.data.location && lookupStatus.state !== 'busy' && (
            <span className="mt-1 block text-sm text-ink-2">
              {lookupStatus.state === 'failed' ? `${lookupStatus.message} ` : 'No map pin for this campground yet. '}
              <button type="button" className="min-h-11 font-semibold text-brand underline" onClick={() => void findLocation(campground.id, campground.data)}>
                {lookupStatus.state === 'failed' ? 'Try again' : 'Find location'}
              </button>
              , add it in the{' '}
              <Link to={`/book/campgrounds/${encodeURIComponent(campground.id)}`} className="font-semibold text-brand underline">
                campground directory
              </Link>
              , or tap the map on the Plan tab.
            </span>
          )}
        </label>

        {backFromBooking && !booked && (
          <div role="status" className="rounded-xl border border-brand bg-surface-2 p-3">
            <p className="font-semibold">Back from booking?</p>
            <p className="mt-1 text-sm text-ink-2">
              If you made the reservation, paste the confirmation email and the details fill in for you.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={openPaste}>
                Paste confirmation
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setBookingFlag(tripId, false);
                  setBackFromBooking(false);
                }}
              >
                Not booked yet
              </Button>
            </div>
          </div>
        )}

        {campground && !resolved && campgroundTakesReservations(campground.data.bookingSystem) && (
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-ink-2">Set trip dates to see when booking opens.</span>
              <ExternalLinkButton href={bookingLink(campground.data.bookingUrl)} variant="secondary" onClick={startBooking}>
                Book now
              </ExternalLinkButton>
            </div>
            {isGenericBookingUrl(campground.data.bookingUrl) && <GenericLinkHint name={campground.data.name} />}
          </div>
        )}

        {campground && rule && resolved && (
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <BookingStateBadge state={resolved.state} />
              {campgroundTakesReservations(campground.data.bookingSystem) && (
                <ExternalLinkButton href={bookingLink(campground.data.bookingUrl)} variant="secondary" onClick={startBooking}>
                  Book now
                </ExternalLinkButton>
              )}
            </div>
            {campgroundTakesReservations(campground.data.bookingSystem) && isGenericBookingUrl(campground.data.bookingUrl) && (
              <GenericLinkHint name={campground.data.name} />
            )}
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

        {campground || reservation ? (
          <div ref={formRef} className="scroll-mt-32">
            <ReservationForm
              tripId={tripId}
              trip={tripData}
              existing={reservation}
              defaultArrival={tripData.startDate}
              defaultNights={nights}
              campgroundId={tripData.campgroundId}
              pasteOpen={pasteOpen}
              setPasteOpen={setPasteOpen}
              onBooked={() => {
                setBookingFlag(tripId, false);
                setBackFromBooking(false);
              }}
            />
          </div>
        ) : (
          <p className="border-t border-line pt-4 text-sm text-ink-2">Choose a campground above to add reservation details.</p>
        )}
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
  trip,
  existing,
  defaultArrival,
  defaultNights,
  campgroundId,
  pasteOpen,
  setPasteOpen,
  onBooked,
}: {
  tripId: string;
  trip: Trip;
  existing: { id: string; data: Reservation } | undefined;
  defaultArrival: string | null;
  defaultNights: number | null;
  campgroundId: string | null;
  pasteOpen: boolean;
  setPasteOpen: (open: boolean) => void;
  onBooked: () => void;
}) {
  const [newId_] = useState(() => newId('reservation'));
  const id = existing?.id ?? newId_;
  const initial = existing?.data ?? BLANK_RESERVATION(tripId, campgroundId, defaultArrival, defaultNights);
  const [tripNote, setTripNote] = useState<string | null>(null);
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('reservation', id, initial, async (r) => {
    // A booked reservation is the source of truth for the trip's dates and status.
    const update = tripUpdateFromReservation(trip, r);
    if (update) await saveRecord('trip', tripId, update.trip);
    setTripNote(update ? `Trip updated: ${update.changes.join(', ')}.` : null);
    if (r.status === 'booked') onBooked();
  });
  const today = new Date().toISOString().slice(0, 10);
  const cancel = cancelDeadlineInfo(today, draft.cancelDeadline);

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-2">{existing ? 'Reservation details' : 'Add reservation details'}</p>
        {!pasteOpen && (
          <Button type="button" variant="secondary" onClick={() => setPasteOpen(true)}>
            Paste confirmation
          </Button>
        )}
      </div>
      {pasteOpen && (
        <PasteConfirmation
          onClose={() => setPasteOpen(false)}
          onParsed={(fields) => {
            setDraft({ ...draft, ...fields, campgroundId: draft.campgroundId ?? campgroundId });
            setTripNote(null);
          }}
        />
      )}
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
          <input
            className={inputClass}
            value={draft.confirmation}
            onChange={(e) => {
              const confirmation = e.target.value;
              // Typing a confirmation number means it's booked.
              const status = draft.status === 'planned' && confirmation.trim() ? 'booked' : draft.status;
              setDraft({ ...draft, confirmation, status });
            }}
          />
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
          <input className={inputClass} inputMode="decimal" type="number" min={0} step="0.01" value={draft.costUsd ?? ''} onChange={(e) => setDraft({ ...draft, costUsd: numOrNull(e.target.value) })} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Fees (USD)</span>
          <input className={inputClass} inputMode="decimal" type="number" min={0} step="0.01" value={draft.feesUsd ?? ''} onChange={(e) => setDraft({ ...draft, feesUsd: numOrNull(e.target.value) })} />
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

      {draft.status === 'booked' && dirty && (
        <p className="text-sm text-ink-2">Saving also sets the trip’s dates from the arrival date and nights, and marks the trip booked.</p>
      )}
      <SaveRow dirty={dirty} saved={saved} error={error} />
      {tripNote && saved && !dirty && <p className="text-sm text-ok">{tripNote}</p>}
    </form>
  );
}

const FOUND_LABEL = (found: string[]) => found.join(', ').replace(/, ([^,]*)$/, ' and $1');

/** Paste a ReserveMN / Recreation.gov confirmation email; the details fill the form for checking. */
function PasteConfirmation({ onParsed, onClose }: { onParsed: (fields: Partial<Reservation>) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const canReadClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  const run = (value: string) => {
    const { fields, found } = parseConfirmation(value);
    if (!found.length) {
      setResult({ ok: false, message: 'Couldn’t find booking details in that text. Fill them in below by hand.' });
      return;
    }
    onParsed(fields);
    setResult({ ok: true, message: `Filled in ${FOUND_LABEL(found)}. Check them against the email, then Save.` });
  };

  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3">
      <p className="text-sm text-ink-2">
        Open the confirmation email from ReserveMN or Recreation.gov, select all the text and copy it, then paste it here. It stays on your phone.
      </p>
      <textarea
        aria-label="Confirmation email text"
        className={`${inputClass} min-h-28 py-2`}
        placeholder="Paste the confirmation email here"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {canReadClipboard && (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                const v = await navigator.clipboard.readText();
                setText(v);
                run(v);
              } catch {
                setResult({ ok: false, message: 'Couldn’t read the clipboard. Long-press in the box and choose Paste.' });
              }
            }}
          >
            Paste from clipboard
          </Button>
        )}
        <Button type="button" disabled={!text.trim()} onClick={() => run(text)}>
          Fill in details
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {result && (
        <p role="status" className={`text-sm ${result.ok ? 'text-ok' : 'text-warn'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
