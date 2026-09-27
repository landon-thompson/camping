import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { newId, saveRecord, useRecord } from '../../db/records';
import { Card, inputClass, PageTitle, StatusChip } from '../../components/ui';
import type { Agency, BookingSystem, Campground } from '../../model/schemas';
import { AGENCY_LABEL, useBookingRules } from './data';
import { campgroundTakesReservations } from './booking';
import { bookingLink, ExternalLinkButton, GenericLinkHint, isGenericBookingUrl, NavButton, numOrNull, SaveRow, SpecEditor, useDraft } from './shared';
import { RidbImport } from './RidbImport';

/** /book/campgrounds/:id — details for one campground, or (:id === "new") the add-campground flow. */
export function CampgroundDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  if (id === 'new') return <NewCampground />;
  return <ExistingCampground id={id} />;
}

function ExistingCampground({ id }: { id: string }) {
  const record = useRecord('campground', id);
  const { byAgency } = useBookingRules();
  if (record.loading) return <p className="text-ink-2">Loading…</p>;
  if (!record.data) return <p className="text-ink-2">This campground isn’t in the directory (any more).</p>;

  const rule = byAgency[record.data.agency]?.data;

  return (
    <div className="space-y-4">
      <PageTitle sub={record.data.unit}>{record.data.name}</PageTitle>

      <BookingCard campground={record.data} bookingUrl={record.data.bookingUrl} />

      {rule && <RuleSummaryCard campground={record.data} rule={rule} />}

      {record.data.verify && (
        <Card title="Needs verifying">
          <p className="text-ink-2">{record.data.verify}</p>
        </Card>
      )}

      {record.data.source && (
        <Card title="Source">
          <p className="whitespace-pre-line text-sm text-ink-2">{record.data.source}</p>
        </Card>
      )}

      <EditCampgroundForm id={id} initial={record.data} />
    </div>
  );
}

function BookingCard({ campground, bookingUrl }: { campground: Campground; bookingUrl: string }) {
  const reservable = campgroundTakesReservations(campground.bookingSystem);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        {reservable ? (
          <ExternalLinkButton href={bookingLink(bookingUrl)}>Book now (official site)</ExternalLinkButton>
        ) : (
          <span className="rounded-xl bg-surface-2 px-4 py-3 font-semibold text-ink-2">
            No booking needed — {campground.bookingSystem === 'dispersed' ? 'dispersed camping' : 'first-come, first-served'}
          </span>
        )}
        <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="min-h-11 content-center text-sm font-semibold text-brand">
          Official page ↗
        </a>
      </div>
      {reservable && isGenericBookingUrl(bookingUrl) && <GenericLinkHint name={campground.name} />}
    </Card>
  );
}

function RuleSummaryCard({ campground, rule }: { campground: Campground; rule: NonNullable<ReturnType<typeof useBookingRules>['byAgency'][Agency]>['data'] }) {
  // A campground's own bookingSystem — not just its managing agency — decides
  // whether the agency rule's advance-booking window/contact actually apply
  // here (e.g. a first-come USFS rustic site shares an agency with reservable
  // Recreation.gov campgrounds, but none of that rule's window/phone apply to it).
  const reservable = campgroundTakesReservations(campground.bookingSystem);
  const months = campground.windowMonthsOverride?.value ?? rule.windowMonths?.value ?? null;
  const days = campground.windowDaysOverride?.value ?? (months === null ? rule.windowDays.value : null);

  return (
    <Card title={`${AGENCY_LABEL[campground.agency]} rule`}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {reservable && (
          <>
            <div>
              <dt className="text-ink-2">Advance window</dt>
              <dd className="font-semibold">{months !== null ? `${months} months` : days !== null ? `${days} days` : 'None (same-day only)'}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Phone</dt>
              <dd className="font-semibold">{rule.phone || '—'}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-ink-2">Max nights</dt>
          <dd className="font-semibold">{rule.maxNights.value ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Confidence</dt>
          <dd>
            <StatusChip status={rule.status === 'verified' ? 'verified' : 'verify'} />
          </dd>
        </div>
      </dl>
      {rule.notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
          {rule.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <NavButton to="/book/rules" variant="secondary">
        Edit this rule
      </NavButton>
    </Card>
  );
}

function EditCampgroundForm({ id, initial }: { id: string; initial: Campground }) {
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('campground', id, initial);
  return (
    <Card title="Edit">
      <form onSubmit={onSubmit} className="space-y-3">
        <CampgroundFields draft={draft} setDraft={setDraft} />
        <SaveRow dirty={dirty} saved={saved} error={error} />
      </form>
    </Card>
  );
}

/** Shared field set for both editing an existing campground and adding a custom one. */
function CampgroundFields({ draft, setDraft }: { draft: Campground; setDraft: (c: Campground) => void }) {
  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Name</span>
        <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Unit (park / forest name)</span>
        <input className={inputClass} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Agency</span>
          <select className={inputClass} value={draft.agency} onChange={(e) => setDraft({ ...draft, agency: e.target.value as Agency })}>
            {(Object.keys(AGENCY_LABEL) as Agency[]).map((a) => (
              <option key={a} value={a}>
                {AGENCY_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Booking system</span>
          <select className={inputClass} value={draft.bookingSystem} onChange={(e) => setDraft({ ...draft, bookingSystem: e.target.value as BookingSystem })}>
            <option value="reservemn">ReserveMN</option>
            <option value="recreation-gov">Recreation.gov</option>
            <option value="first-come">First-come, pay on arrival</option>
            <option value="dispersed">Dispersed (no booking)</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Official / booking URL</span>
        <input className={inputClass} value={draft.bookingUrl} onChange={(e) => setDraft({ ...draft, bookingUrl: e.target.value })} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Recreation.gov (RIDB) facility id</span>
        <input
          className={inputClass}
          value={draft.ridbFacilityId ?? ''}
          onChange={(e) => setDraft({ ...draft, ridbFacilityId: e.target.value || null })}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Latitude</span>
          <input
            className={inputClass}
            type="number"
            step="any"
            value={draft.location?.lat ?? ''}
            onChange={(e) => {
              const lat = numOrNull(e.target.value);
              setDraft({ ...draft, location: lat === null ? null : { lat, lng: draft.location?.lng ?? 0 } });
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Longitude</span>
          <input
            className={inputClass}
            type="number"
            step="any"
            value={draft.location?.lng ?? ''}
            onChange={(e) => {
              const lng = numOrNull(e.target.value);
              setDraft({ ...draft, location: lng === null ? null : { lat: draft.location?.lat ?? 0, lng } });
            }}
          />
        </label>
      </div>
      <p className="text-sm text-ink-2">Leave latitude/longitude blank unless you're entering coordinates read from an official page.</p>

      <div className="flex flex-wrap gap-4">
        <TriState label="Electric sites" value={draft.electric} onChange={(v) => setDraft({ ...draft, electric: v })} />
        <TriState label="Boat launch" value={draft.boatLaunch} onChange={(v) => setDraft({ ...draft, boatLaunch: v })} />
      </div>

      <SpecEditor
        label="Advance window override (days)"
        unit="days"
        spec={draft.windowDaysOverride ?? { value: null, status: 'verify' }}
        onChange={(s) => setDraft({ ...draft, windowDaysOverride: s })}
      />
      <SpecEditor
        label="Advance window override (calendar months)"
        unit="months"
        spec={draft.windowMonthsOverride ?? { value: null, status: 'verify' }}
        onChange={(s) => setDraft({ ...draft, windowMonthsOverride: s })}
      />

      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Notes</span>
        <textarea className={`${inputClass} min-h-20 py-2`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Needs verifying (leave blank once confirmed)</span>
        <textarea className={`${inputClass} min-h-20 py-2`} value={draft.verify} onChange={(e) => setDraft({ ...draft, verify: e.target.value })} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink-2">Source</span>
        <textarea className={`${inputClass} min-h-20 py-2`} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
      </label>
    </>
  );
}

function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-ink-2">{label}</span>
      <select className={inputClass} value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}>
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}

const BLANK: Campground = {
  name: '',
  agency: 'mn-state-park',
  bookingSystem: 'reservemn',
  unit: '',
  location: null,
  bookingUrl: '',
  ridbFacilityId: null,
  windowDaysOverride: null,
  windowMonthsOverride: null,
  electric: null,
  boatLaunch: null,
  rules: [],
  verify: 'Newly added — confirm every fact against the official page before relying on it.',
  source: '',
  notes: '',
};

function NewCampground() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Campground>(BLANK);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const id = newId('campground');
      await saveRecord('campground', id, draft);
      navigate(`/book/campgrounds/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle>Add a campground</PageTitle>

      <RidbImport
        onImport={(f) =>
          setDraft({
            ...draft,
            name: f.name,
            agency: 'usfs',
            bookingSystem: 'recreation-gov',
            bookingUrl: f.reservationUrl,
            ridbFacilityId: f.id,
            location: f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : null,
            notes: f.description,
            verify: 'Imported from a Recreation.gov (RIDB) search — confirm electric/boat-launch details, unit name and the exact window on the official page.',
          })
        }
      />

      <Card title="Details">
        <form onSubmit={onSubmit} className="space-y-3">
          <CampgroundFields draft={draft} setDraft={setDraft} />
          {error && (
            <p role="alert" className="text-sm text-bad">
              Couldn’t save: {error}
            </p>
          )}
          <button type="submit" disabled={!draft.name.trim()} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-brand-ink disabled:opacity-50">
            Add campground
          </button>
        </form>
      </Card>
    </div>
  );
}
