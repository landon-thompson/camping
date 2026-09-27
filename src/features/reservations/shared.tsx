import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { saveRecord } from '../../db/records';
import { Button, inputClass, StatusChip } from '../../components/ui';
import type { BookingSystem, RecordData, RecordType, SpecNumber, SpecStatus } from '../../model/schemas';
import type { BookingState } from './booking';

export const SYSTEM_LABEL: Record<BookingSystem, string> = {
  reservemn: 'ReserveMN',
  campsd: 'Camp SD',
  'recreation-gov': 'Recreation.gov',
  'first-come': 'First-come',
  dispersed: 'Dispersed',
  other: 'Other',
};

/** An internal-navigation counterpart to ui.tsx's `LinkButton` (which is for external/absolute hrefs). */
export function NavButton({ to, children, variant = 'primary' }: { to: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  const styles = variant === 'primary' ? 'bg-brand text-brand-ink' : 'border border-line bg-surface-2 text-ink';
  return (
    <Link to={to} className={`inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold ${styles}`}>
      {children}
    </Link>
  );
}

/**
 * Local draft of a record with a Save button, matching the pattern in
 * src/pages/Settings.tsx: an in-progress edit is never clobbered by an
 * incoming sync, but a fresh sync is picked up once you've saved.
 */
export function useDraft<T extends RecordType>(type: T, id: string, initial: RecordData<T>, onSaved?: (data: RecordData<T>) => void | Promise<void>) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialJson = JSON.stringify(initial);
  useEffect(() => {
    if (JSON.stringify(base) === initialJson) return;
    if (JSON.stringify(draft) === JSON.stringify(base)) setDraft(initial);
    setBase(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);
  const dirty = JSON.stringify(draft) !== initialJson;
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveRecord(type, id, draft);
      setError(null);
      setSaved(true);
      await onSaved?.(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return { draft, setDraft, dirty, saved, error, onSubmit };
}

export function SaveRow({ dirty, saved, error }: { dirty: boolean; saved: boolean; error: string | null }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <Button type="submit" disabled={!dirty}>
        Save
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-bad">
          Couldn’t save: check the values.
        </span>
      ) : (
        saved && !dirty && <span className="text-sm text-ok">Saved on this phone</span>
      )}
    </div>
  );
}

export function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function intOrNull(v: string): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

/** A SpecNumber editor (value + confidence + source/note), for windows and night limits. */
export function SpecEditor({
  label,
  spec,
  unit,
  onChange,
}: {
  label: string;
  spec: SpecNumber;
  unit?: string;
  onChange: (s: SpecNumber) => void;
}) {
  return (
    <fieldset className="rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink-2">
        {label} <StatusChip status={spec.status} />
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <input
          aria-label={`${label}${unit ? ` (${unit})` : ''}`}
          className={inputClass}
          inputMode="decimal"
          type="number"
          step="any"
          placeholder={unit ?? 'value'}
          value={spec.value ?? ''}
          onChange={(e) => onChange({ ...spec, value: numOrNull(e.target.value) })}
        />
        <select
          aria-label={`${label} confidence`}
          className={inputClass}
          value={spec.status}
          onChange={(e) => onChange({ ...spec, status: e.target.value as SpecStatus })}
        >
          <option value="verified">Verified</option>
          <option value="verify">Needs verifying</option>
          <option value="estimate">Estimate</option>
        </select>
      </div>
      {(spec.note || spec.source) && (
        <p className="mt-2 text-sm text-ink-2">
          {spec.note}
          {spec.source && <span className="block">Source: {spec.source}</span>}
        </p>
      )}
    </fieldset>
  );
}

const STATE_LABEL: Record<BookingState, string> = {
  'no-booking-needed': 'No booking needed',
  'not-open': 'Not open yet',
  'opens-today': 'Opens today',
  open: 'Open — book now',
  past: 'Arrival date has passed',
};

const STATE_CLASS: Record<BookingState, string> = {
  'no-booking-needed': 'bg-surface-2 text-ink-2',
  'not-open': 'bg-info-bg text-info',
  'opens-today': 'bg-warn-bg text-warn',
  open: 'bg-surface-2 text-ok',
  past: 'bg-surface-2 text-ink-2',
};

export function BookingStateBadge({ state }: { state: BookingState }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>;
}

/** An external "Book now" style link — ui.tsx's LinkButton has no target/rel, and an official booking page always needs `target="_blank" rel="noopener"`. */
export function ExternalLinkButton({
  href,
  children,
  variant = 'primary',
  onClick,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}) {
  const styles = variant === 'primary' ? 'bg-brand text-brand-ink' : 'border border-line bg-surface-2 text-ink';
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={`inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold ${styles}`}>
      {children}
    </a>
  );
}

export function money(v: number | null): string {
  return v === null ? '—' : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** True when a booking link is just an agency's front page rather than this campground's own page. */
export function isGenericBookingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return (
      (/(^|\.)mndnr\.gov$/.test(u.hostname) && path === '/reservations') ||
      (/reservemn\.usedirect\.com$/.test(u.hostname) && path.split('/').filter(Boolean).length <= 1) ||
      (/recreation\.gov$/.test(u.hostname) && path === '') ||
      (/(^|\.)campsd\.com$/.test(u.hostname) && path === '')
    );
  } catch {
    return true;
  }
}

/** Shown next to "Book now" when the link is generic: how to make it go straight to this park. */
export function GenericLinkHint({ name, editHref }: { name: string; editHref?: string }) {
  return (
    <p className="mt-2 text-sm text-ink-2">
      This link opens the general reservation site. Find <strong>{name}</strong> there, then copy that page’s address from
      Safari (Share → Copy) and paste it as this campground’s booking link. After that, “Book now” goes straight to it.
      {editHref && (
        <>
          {' '}
          <a href={editHref} className="font-semibold text-brand underline">
            Edit booking link
          </a>
        </>
      )}
    </p>
  );
}

/**
 * The link "Book now" should open. A DNR state park page goes straight to its
 * Reservations section (e.g. park.html?id=spk00100#reservations).
 */
export function bookingLink(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)dnr\.state\.mn\.us$/.test(u.hostname) && u.pathname === '/state_parks/park.html' && u.searchParams.get('id') && !u.hash) {
      u.hash = 'reservations';
      return u.toString();
    }
  } catch {
    /* not a URL — leave as is */
  }
  return url;
}
