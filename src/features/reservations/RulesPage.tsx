import { useState } from 'react';
import { Button, Card, inputClass, PageTitle, StatusChip } from '../../components/ui';
import type { BookingRule } from '../../model/schemas';
import type { Row } from '../../db/records';
import { useBookingRules } from './data';
import { SaveRow, SpecEditor, SYSTEM_LABEL, useDraft } from './shared';

/** /book/rules — the four agency-level booking rules: a compact summary each, "Edit" expands the full form. */
export function RulesPage() {
  const { loading, rows } = useBookingRules();
  return (
    <div className="space-y-4">
      <PageTitle sub="Agency facts, kept as editable data so they can be corrected the moment the official page changes.">Booking rules</PageTitle>
      {loading && <p className="text-ink-2">Loading…</p>}
      {rows.map((r) => (
        <RuleCard key={r.id} row={r} />
      ))}
    </div>
  );
}

function RuleCard({ row }: { row: Row<BookingRule> }) {
  const [editing, setEditing] = useState(false);
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('booking_rule', row.id, row.data);
  const months = draft.windowMonths?.value ?? null;
  const windowSpec = months !== null ? draft.windowMonths! : draft.windowDays;
  const windowText = months !== null ? `${months} months` : draft.windowDays.value !== null ? `${draft.windowDays.value} days` : 'None (same-day only)';

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {draft.label} <StatusChip status={draft.status === 'verified' ? 'verified' : 'verify'} />
        </span>
      }
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
        <div>
          <dt className="text-ink-2">Booking system</dt>
          <dd className="font-semibold">{SYSTEM_LABEL[draft.bookingSystem]}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Advance window</dt>
          <dd className="font-semibold">
            {windowText} <StatusChip status={windowSpec.status} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">Opens at</dt>
          <dd className="font-semibold">{draft.openTime ? `${draft.openTime} ${draft.timeZone}` : 'Same-day / no fixed time'}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Max nights</dt>
          <dd className="font-semibold">
            {draft.maxNights.value ?? '—'} <StatusChip status={draft.maxNights.status} />
          </dd>
        </div>
      </dl>

      <Button type="button" variant="secondary" className="mt-3" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
        {editing ? 'Close' : 'Edit'}
      </Button>

      {editing && (
        <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-line pt-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink-2">Booking system</span>
            <select
              className={inputClass}
              value={draft.bookingSystem}
              onChange={(e) => setDraft({ ...draft, bookingSystem: e.target.value as BookingRule['bookingSystem'] })}
            >
              <option value="reservemn">ReserveMN</option>
              <option value="recreation-gov">Recreation.gov</option>
              <option value="first-come">First-come, pay on arrival</option>
              <option value="dispersed">Dispersed (no booking)</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink-2">Reservation required?</span>
            <select
              className={inputClass}
              value={draft.reservationRequired === null ? '' : String(draft.reservationRequired)}
              onChange={(e) => setDraft({ ...draft, reservationRequired: e.target.value === '' ? null : e.target.value === 'true' })}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
              <option value="">Unknown</option>
            </select>
          </label>
        </div>

        <SpecEditor label="Advance window (days)" unit="days" spec={draft.windowDays} onChange={(s) => setDraft({ ...draft, windowDays: s })} />
        <SpecEditor
          label="Advance window (calendar months, e.g. Recreation.gov's rolling window)"
          unit="months"
          spec={draft.windowMonths ?? { value: null, status: 'verify' }}
          onChange={(s) => setDraft({ ...draft, windowMonths: s })}
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink-2">Opens at (local time)</span>
            <input
              className={inputClass}
              type="time"
              value={draft.openTime ?? ''}
              onChange={(e) => setDraft({ ...draft, openTime: e.target.value || null })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink-2">Timezone (IANA)</span>
            <input className={inputClass} value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })} />
          </label>
        </div>

        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={draft.rolling} onChange={(e) => setDraft({ ...draft, rolling: e.target.checked })} />
          <span>Rolling window (new dates release daily, not all at once)</span>
        </label>

        <SpecEditor label="Max nights per reservation" unit="nights" spec={draft.maxNights} onChange={(s) => setDraft({ ...draft, maxNights: s })} />

        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Official URL</span>
          <input className={inputClass} value={draft.officialUrl} onChange={(e) => setDraft({ ...draft, officialUrl: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Phone</span>
          <input className={inputClass} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Notes (one per line)</span>
          <textarea
            className={`${inputClass} min-h-24 py-2`}
            value={draft.notes.join('\n')}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value.split('\n') })}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Source</span>
          <textarea className={`${inputClass} min-h-16 py-2`} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Confidence</span>
          <select className={inputClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as BookingRule['status'] })}>
            <option value="verified">Verified on the official page</option>
            <option value="verify">Needs verifying</option>
          </select>
        </label>

        <SaveRow dirty={dirty} saved={saved} error={error} />
        </form>
      )}
    </Card>
  );
}
