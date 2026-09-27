import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { newId, saveRecord, useRecord, useRecords } from '../../db/records';
import { getCachedUser } from '../../auth/identity';
import { Button, Card, Field, inputClass, PageTitle } from '../../components/ui';
import { MN_CENTER } from '../../lib/map';
import type { LatLng, Trip, TripChecklistItem, TripKind, TripStatus } from '../../model/schemas';
import { TripMap, type TripMapMarker } from './TripMap';
import { generateChecklist, missingChecklistItems, pastDebriefsFor, templatesForTrip } from './checklist';
import { computeReadiness, type ReadinessPart } from './readiness';
import { defaultGearIds, tripNights } from './utils';
import { TripReservationSection } from '../reservations/TripReservationSection';
import { TripWeatherSection } from '../journal/TripWeatherSection';
import { TripTrailsSection } from '../trails/TripTrailsSection';
import { TripDebriefSection } from '../journal/TripDebriefSection';
import { useSyncStatus } from '../../sync/useSync';

const KIND_OPTIONS: { value: TripKind; label: string }[] = [
  { value: 'electric', label: 'Electric site' },
  { value: 'no-hookup', label: 'No hookup' },
  { value: 'boat', label: 'Boat' },
  { value: 'off-grid', label: 'Off-grid' },
  { value: 'toddler', label: 'Toddler' },
];

const SECTIONS: [string, string][] = [
  ['t-details', 'Plan'],
  ['t-gear', 'Gear'],
  ['t-checklist', 'Checklist'],
  ['t-reservation', 'Book'],
  ['t-weather', 'Weather'],
  ['t-trails', 'Trails'],
  ['t-debrief', 'Debrief'],
  ['t-share', 'Share'],
];

function readTab(): string {
  try {
    const t = sessionStorage.getItem('tripTab');
    return t && SECTIONS.some(([k]) => k === t) ? t : 't-details';
  } catch {
    return 't-details';
  }
}

const STATUS_OPTIONS: TripStatus[] = ['idea', 'planned', 'booked', 'done', 'cancelled'];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
        active ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'
      }`}
    >
      {children}
    </button>
  );
}

export function TripPage() {
  const { id = '' } = useParams();
  const trip = useRecord('trip', id);

  if (trip.loading) return <p className="text-ink-2">Loading…</p>;
  if (!trip.data) {
    return (
      <div className="space-y-4">
        <PageTitle>Trip not found</PageTitle>
        <Card>
          <p className="text-ink-2">This trip may have been deleted.</p>
          <Link to="/trips" className="mt-3 inline-block font-semibold text-brand">
            Back to trips
          </Link>
        </Card>
      </div>
    );
  }

  return <TripEditor id={id} trip={trip.data} />;
}

function TripEditor({ id, trip }: { id: string; trip: Trip }) {
  // Edits are kept as a patch over the live record: saving writes only the
  // fields changed here, so a campground chosen in the reservation section or
  // an edit synced from the other phone is never overwritten.
  const [patch, setPatch] = useState<Partial<Trip>>({});
  const [saved, setSaved] = useState(false);
  const [tab, setTabState] = useState(readTab);
  const setTab = (t: string) => {
    setTabState(t);
    try {
      sessionStorage.setItem('tripTab', t);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  };
  const draft: Trip = { ...trip, ...patch };
  const dirty = (Object.keys(patch) as (keyof Trip)[]).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(trip[k]));

  const settings = useRecords('settings');
  const campgrounds = useRecords('campground');
  const gear = useRecords('gear');
  const templates = useRecords('checklist_template');
  const allTrips = useRecords('trip');
  const debriefs = useRecords('debrief');
  const checklist = useRecords('trip_checklist_item');
  const reservations = useRecords('reservation');
  const vehicle = useRecords('vehicle');
  const trailer = useRecords('trailer');
  const loadProfiles = useRecords('load_profile');
  const powerProfiles = useRecords('power_profile');
  const shareLinks = useRecords('share_link');
  const syncState = useSyncStatus().state;

  const homeBase = settings.rows[0]?.data.homeBase ?? null;
  const items = useMemo(() => checklist.rows.filter((r) => r.data.tripId === id), [checklist.rows, id]);
  const reservation = reservations.rows.find((r) => r.data.tripId === id)?.data ?? null;
  const campground = draft.campgroundId ? (campgrounds.rows.find((c) => c.id === draft.campgroundId)?.data ?? null) : null;
  const tripGear = draft.gearIds.map((gid) => gear.rows.find((g) => g.id === gid)?.data).filter((g): g is NonNullable<typeof g> => !!g);
  const activeShare = shareLinks.rows.find((s) => s.data.tripId === id && !s.data.revoked);

  const readiness = useMemo(
    () =>
      computeReadiness({
        trip: draft,
        checklistItems: items.map((i) => i.data),
        reservation,
        campground,
        tripGear,
        vehicle: vehicle.rows[0]?.data ?? null,
        trailer: trailer.rows[0]?.data ?? null,
        loadProfile: loadProfiles.rows[0]?.data ?? null,
        powerProfile: powerProfiles.rows[0]?.data ?? null,
      }),
    [draft, items, reservation, campground, tripGear, vehicle.rows, trailer.rows, loadProfiles.rows, powerProfiles.rows],
  );

  async function save() {
    await saveRecord('trip', id, draft);
    setPatch({});
    setSaved(true);
  }

  function update(change: Partial<Trip>) {
    setSaved(false);
    setPatch((p) => ({ ...p, ...change }));
  }

  function toggleKind(kind: TripKind) {
    update({ kinds: draft.kinds.includes(kind) ? draft.kinds.filter((k) => k !== kind) : [...draft.kinds, kind] });
  }

  const nights = tripNights(draft);
  const mapCenter: [number, number] = draft.location
    ? [draft.location.lng, draft.location.lat]
    : homeBase?.lat != null && homeBase.lng != null
      ? [homeBase.lng, homeBase.lat]
      : MN_CENTER;
  const markers: TripMapMarker[] = draft.location ? [{ id, lat: draft.location.lat, lng: draft.location.lng, label: String(draft.level) }] : [];

  return (
    <div className="space-y-4">
      <PageTitle sub={`Level ${draft.level} · readiness ${readiness.score}%${dirty ? ' · unsaved changes' : ''}`}>
        <Link to="/trips" className="mr-2 text-ink-2">
          ←
        </Link>
        {draft.name || 'Trip'}
      </PageTitle>

      <nav aria-label="Trip sections" className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-30 -mx-4 overflow-x-auto border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        <ul className="flex gap-2 whitespace-nowrap">
          {SECTIONS.map(([key, label]) => (
            <li key={key}>
              <button
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${
                  tab === key ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink'
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 't-details' && (
      <Card>
        <TripMap
          center={mapCenter}
          zoom={draft.location ? 11 : 6}
          markers={markers}
          tripId={id}
          onPick={(lat, lng) => update({ location: { lat, lng, label: draft.location?.label ?? '' } })}
        />
      </Card>
      )}

      {tab === 't-details' && (
      <section id="t-details">
      <Card title="Details">
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputClass} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Level">
              <select className={inputClass} value={draft.level} onChange={(e) => update({ level: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass} value={draft.status} onChange={(e) => update({ status: e.target.value as TripStatus })}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Target window" hint="Free text, e.g. “late May / early June” — used until firm dates are set.">
            <input className={inputClass} value={draft.targetWindow} onChange={(e) => update({ targetWindow: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                className={inputClass}
                value={draft.startDate ?? ''}
                onChange={(e) => update({ startDate: e.target.value || null })}
              />
            </Field>
            <Field label="End date">
              <input type="date" className={inputClass} value={draft.endDate ?? ''} onChange={(e) => update({ endDate: e.target.value || null })} />
            </Field>
          </div>
          {nights !== null && <p className="text-sm text-ink-2">{nights} night{nights === 1 ? '' : 's'}</p>}

          <div>
            <span className="mb-1 block text-sm font-semibold text-ink-2">Trip kinds</span>
            <div className="flex flex-wrap gap-2">
              {KIND_OPTIONS.map((k) => (
                <Chip key={k.value} active={draft.kinds.includes(k.value)} onClick={() => toggleKind(k.value)}>
                  {k.label}
                </Chip>
              ))}
            </div>
          </div>

          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="h-6 w-6" checked={draft.towing} onChange={(e) => update({ towing: e.target.checked })} />
            <span className="font-semibold">Towing the boat</span>
          </label>

          <p className="text-sm text-ink-2">
            Campground:{' '}
            <span className="font-semibold text-ink">
              {campground?.name ?? 'none chosen yet'}
            </span>{' '}
            — pick it in{' '}
            <button type="button" onClick={() => setTab('t-reservation')} className="font-semibold text-brand underline">
              Book
            </button>
            .
          </p>

          <LocationFields
            label="Location"
            value={draft.location}
            onChange={(v) => update({ location: v })}
            hint="Tap the map above, or type coordinates."
            withName={false}
          />
          <LocationFields
            label="Boat launch"
            value={draft.boatLaunch}
            onChange={(v) => update({ boatLaunch: v as (LatLng & { name: string }) | null })}
            withName
          />

          <Field label="Peak sun hours" hint="For the power calculator on this trip, if different from the usual estimate.">
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              className={inputClass}
              value={draft.peakSunHours ?? ''}
              onChange={(e) => update({ peakSunHours: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>

          <Field label="Notes">
            <textarea className={`${inputClass} min-h-24 py-2`} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
          </Field>

          <div className="flex items-center gap-3">
            <Button type="button" disabled={!dirty} onClick={() => void save()}>
              Save
            </Button>
            {saved && !dirty && <span className="text-sm text-ok">Saved</span>}
          </div>
        </div>
      </Card>
      </section>
      )}

      {tab === 't-gear' && (
      <section id="t-gear">
        <GearCard trip={draft} gearRows={gear.rows} onChange={(gearIds) => update({ gearIds })} />
      </section>
      )}

      {tab === 't-checklist' && (
      <section id="t-checklist">
      <ChecklistCard
        tripId={id}
        trip={draft}
        items={items}
        templates={templates.rows}
        gearRows={gear.rows}
        allTrips={allTrips.rows}
        debriefs={debriefs.rows}
      />
      </section>
      )}

      {tab === 't-details' && (
      <section id="t-readiness">
        <ReadinessCard parts={readiness.parts} score={readiness.score} />
      </section>
      )}

      {tab === 't-reservation' && (
      <section id="t-reservation">
        <TripReservationSection tripId={id} />
      </section>
      )}
      {tab === 't-weather' && (
      <section id="t-weather">
        <TripWeatherSection tripId={id} />
      </section>
      )}
      {tab === 't-trails' && (
      <section id="t-trails">
        <TripTrailsSection tripId={id} />
        <Link to="/trails" className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand">
          All routes &amp; pins →
        </Link>
      </section>
      )}
      {tab === 't-debrief' && (
      <section id="t-debrief">
        <TripDebriefSection tripId={id} />
      </section>
      )}
      {tab === 't-share' && (
      <section id="t-share">
        {syncState === 'local-only' ? (
          <Card title="Share">
            <p className="text-ink-2">Read-only share links need the sync database, which isn’t set up yet.</p>
          </Card>
        ) : (
          <ShareCard tripId={id} activeShare={activeShare} />
        )}
      </section>
      )}

      {dirty && (
        <div role="status" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg">
          <span className="font-semibold">Unsaved trip changes</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setPatch({})}>
              Discard
            </Button>
            <Button type="button" onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function LocationFields({
  label,
  value,
  onChange,
  hint,
  withName,
}: {
  label: string;
  value: (LatLng & { name?: string; label?: string }) | null;
  onChange: (v: (LatLng & { name: string; label: string }) | null) => void;
  hint?: string;
  withName: boolean;
}) {
  if (!value) {
    return (
      <div>
        <span className="mb-1 block text-sm font-semibold text-ink-2">{label}</span>
        <Button type="button" variant="secondary" onClick={() => onChange({ lat: 0, lng: 0, name: '', label: '' })}>
          Add {label.toLowerCase()}
        </Button>
      </div>
    );
  }
  return (
    <fieldset className="rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink-2">{label}</legend>
      {hint && <p className="mb-2 text-sm text-ink-2">{hint}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input
          aria-label={`${label} latitude`}
          className={inputClass}
          inputMode="decimal"
          type="number"
          placeholder="Latitude"
          value={value.lat || ''}
          onChange={(e) => onChange({ ...value, name: value.name ?? '', label: value.label ?? '', lat: num(e.target.value) ?? 0 })}
        />
        <input
          aria-label={`${label} longitude`}
          className={inputClass}
          inputMode="decimal"
          type="number"
          placeholder="Longitude"
          value={value.lng || ''}
          onChange={(e) => onChange({ ...value, name: value.name ?? '', label: value.label ?? '', lng: num(e.target.value) ?? 0 })}
        />
      </div>
      <input
        aria-label={`${label} name`}
        className={`${inputClass} mt-3`}
        placeholder={withName ? 'Name' : 'Label'}
        value={withName ? (value.name ?? '') : (value.label ?? '')}
        onChange={(e) =>
          onChange(withName ? { ...value, name: e.target.value, label: value.label ?? '' } : { ...value, label: e.target.value, name: value.name ?? '' })
        }
      />
      <Button type="button" variant="ghost" className="mt-2" onClick={() => onChange(null)}>
        Remove
      </Button>
    </fieldset>
  );
}

function GearCard({
  trip,
  gearRows,
  onChange,
}: {
  trip: Trip;
  gearRows: { id: string; data: { name: string; packFor: TripKind[] } }[];
  onChange: (ids: string[]) => void;
}) {
  const suggested = useMemo(() => new Set(defaultGearIds(trip, gearRows)), [trip, gearRows]);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? gearRows : gearRows.filter((g) => trip.gearIds.includes(g.id));
  if (gearRows.length === 0) {
    return (
      <Card title="Gear to bring">
        <p className="text-ink-2">No gear items yet — add some in Gear (Phase 1) and they’ll show up here.</p>
      </Card>
    );
  }
  return (
    <Card
      title="Gear to bring"
      action={
        <Button type="button" variant="secondary" onClick={() => onChange(Array.from(suggested))}>
          Use suggested
        </Button>
      }
    >
      <p className="mb-2 text-sm text-ink-2">
        {trip.gearIds.length} of {gearRows.length} items packed for this trip.
      </p>
      <ul className="space-y-1">
        {visible.map((g) => {
          const checked = trip.gearIds.includes(g.id);
          return (
            <li key={g.id}>
              <label className="flex min-h-12 items-center gap-3 rounded-lg px-1">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={checked}
                  onChange={(e) => onChange(e.target.checked ? [...trip.gearIds, g.id] : trip.gearIds.filter((id) => id !== g.id))}
                />
                <span className="flex-1">{g.data.name}</span>
                {suggested.has(g.id) && !checked && <span className="text-xs font-semibold text-info">suggested</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="secondary" className="mt-2 w-full" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Show only packed items' : `Choose from all ${gearRows.length} items`}
      </Button>
    </Card>
  );
}

function ChecklistCard({
  tripId,
  trip,
  items,
  templates,
  gearRows,
  allTrips,
  debriefs,
}: {
  tripId: string;
  trip: Trip;
  items: { id: string; data: TripChecklistItem }[];
  templates: { id: string; data: import('../../model/schemas').ChecklistTemplate }[];
  gearRows: { id: string; data: import('../../model/schemas').Gear }[];
  allTrips: { id: string; data: Trip }[];
  debriefs: { data: import('../../model/schemas').Debrief }[];
}) {
  const [customText, setCustomText] = useState('');
  const sorted = useMemo(() => [...items].sort((a, b) => a.data.order - b.data.order), [items]);
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof sorted>();
    for (const item of sorted) {
      if (!byGroup.has(item.data.group)) {
        byGroup.set(item.data.group, []);
        order.push(item.data.group);
      }
      byGroup.get(item.data.group)!.push(item);
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [sorted]);
  const checked = items.filter((i) => i.data.checked).length;
  const pct = items.length ? Math.round((checked / items.length) * 100) : 0;

  async function toggle(item: { id: string; data: TripChecklistItem }) {
    const nowChecked = !item.data.checked;
    await saveRecord('trip_checklist_item', item.id, {
      ...item.data,
      checked: nowChecked,
      checkedBy: nowChecked ? (getCachedUser()?.userId ?? null) : null,
    });
  }

  async function refresh() {
    const generated = generateChecklist(
      tripId,
      trip,
      templatesForTrip(trip, templates),
      gearRows,
      pastDebriefsFor({ id: tripId, data: trip }, allTrips, debriefs),
    );
    const missing = missingChecklistItems(
      items.map((i) => i.data),
      generated,
    );
    for (const m of missing) {
      await saveRecord('trip_checklist_item', newId('trip_checklist_item'), { ...m, checked: false, checkedBy: null });
    }
  }

  async function addCustom() {
    const text = customText.trim();
    if (!text) return;
    const order = items.reduce((max, i) => Math.max(max, i.data.order), -1) + 1;
    await saveRecord('trip_checklist_item', newId('trip_checklist_item'), {
      tripId,
      text,
      source: 'custom',
      sourceId: null,
      group: 'Custom',
      checked: false,
      checkedBy: null,
      order,
    });
    setCustomText('');
  }

  return (
    <Card
      title="Checklist"
      action={
        <Button type="button" variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      }
    >
      <div className="mb-3">
        <div className="flex justify-between text-sm text-ink-2">
          <span>
            {checked} of {items.length} checked
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {groups.length === 0 && <p className="text-ink-2">No checklist yet — tap Refresh to generate one.</p>}

      <div className="space-y-4">
        {groups.map(({ group, items: groupItems }) => (
          <div key={group}>
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-2">{group}</h3>
            <ul className="space-y-1">
              {groupItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void toggle(item)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-1 text-left"
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border-2 ${
                        item.data.checked ? 'border-brand bg-brand text-brand-ink' : 'border-line'
                      }`}
                      aria-hidden
                    >
                      {item.data.checked && '✓'}
                    </span>
                    <span className={item.data.checked ? 'text-ink-2 line-through' : ''}>{item.data.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          className={inputClass}
          placeholder="Add an item"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addCustom()}
        />
        <Button type="button" variant="secondary" onClick={() => void addCustom()}>
          Add
        </Button>
      </div>
    </Card>
  );
}

function partColor(score: number): string {
  if (score >= 80) return 'text-ok';
  if (score >= 50) return 'text-warn';
  return 'text-bad';
}

function ReadinessCard({ parts, score }: { parts: ReadinessPart[]; score: number }) {
  return (
    <Card title="Readiness">
      <p className={`text-3xl font-bold ${partColor(score)}`}>{score}%</p>
      <ul className="mt-3 space-y-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-ink-2">{p.reason}</span>
            <span className={`shrink-0 font-bold ${partColor(p.score)}`}>{p.score}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ShareCard({
  tripId,
  activeShare,
}: {
  tripId: string;
  activeShare: { id: string; data: import('../../model/schemas').ShareLink } | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tripId }) });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? 'Could not create the link.');
      await saveRecord('share_link', newId('share_link'), { tripId, token: body.token, revoked: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!activeShare) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${activeShare.data.token}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('Could not revoke the link.');
      await saveRecord('share_link', activeShare.id, { ...activeShare.data, revoked: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the link.');
    } finally {
      setBusy(false);
    }
  }

  const url = activeShare ? `${location.origin}/s/${activeShare.data.token}` : null;

  return (
    <Card title="Share">
      {url ? (
        <div className="space-y-3">
          <p className="text-ink-2">Anyone with this link can see a read-only itinerary — no sign-in, no confirmation numbers.</p>
          <input readOnly aria-label="Share link" className={inputClass} value={url} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setError('Could not copy — select the link above and copy it manually.'))
              }
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void revoke()}>
              Revoke
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" disabled={busy} onClick={() => void create()}>
          Create share link
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      )}
    </Card>
  );
}
