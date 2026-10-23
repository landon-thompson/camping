import { useMemo, useState } from 'react';
import { Button, Card, Field, inputClass } from '../../../components/ui';
import { useRecords } from '../../../db/records';
import { CampgroundPicker } from '../../reservations/CampgroundPicker';
import { LakeRecsList } from './LakeRecsList';

type Source = { kind: 'trip' | 'campground'; id: string | null; towing: boolean };
const KEY = 'lakeRecs:panel';

function readSource(): Source & { open: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Source & { open: boolean }> | null;
    return {
      kind: v?.kind === 'campground' ? 'campground' : 'trip',
      id: typeof v?.id === 'string' ? v.id : null,
      towing: v?.towing === true,
      open: v?.open === true,
    };
  } catch {
    return { kind: 'trip', id: null, towing: false, open: false };
  }
}

const fmtDates = (a: string | null, b: string | null) => {
  if (!a) return 'no dates';
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return b && b !== a ? `${f(a)} – ${f(b)}` : f(a);
};

/** Tools › Fishing: pick a campsite (one of your trips, or any campground) and see the best lakes near it. */
export function RecommendPanel() {
  const saved = useMemo(readSource, []);
  const [open, setOpenState] = useState(saved.open);
  const [src, setSrcState] = useState<Source>(saved);
  const [picking, setPicking] = useState(false);
  const trips = useRecords('trip');
  const campgrounds = useRecords('campground');

  const persist = (s: Source, o: boolean) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...s, open: o }));
    } catch {
      /* remembered for this visit only */
    }
  };
  const setSrc = (patch: Partial<Source>) => {
    const next = { ...src, ...patch };
    setSrcState(next);
    persist(next, open);
  };
  const setOpen = (o: boolean) => {
    setOpenState(o);
    persist(src, o);
  };

  const cgById = useMemo(() => new Map(campgrounds.rows.map((c) => [c.id, c.data])), [campgrounds.rows]);
  const tripOptions = useMemo(
    () =>
      trips.rows
        .map((r) => {
          const cg = r.data.campgroundId ? cgById.get(r.data.campgroundId) : undefined;
          const at = r.data.location ?? cg?.location ?? null;
          return at ? { id: r.id, trip: r.data, at, label: r.data.location?.label || cg?.name || r.data.name } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x && x.trip.status !== 'cancelled')
        .sort((a, b) => (a.trip.startDate ?? '9999').localeCompare(b.trip.startDate ?? '9999')),
    [trips.rows, cgById],
  );

  const chosenTrip = src.kind === 'trip' ? (tripOptions.find((t) => t.id === src.id) ?? tripOptions[0] ?? null) : null;
  const chosenCg = src.kind === 'campground' && src.id ? (campgrounds.rows.find((c) => c.id === src.id) ?? null) : null;
  const origin = useMemo(() => {
    if (chosenTrip) return { lat: chosenTrip.at.lat, lng: chosenTrip.at.lng, label: chosenTrip.label };
    if (chosenCg?.data.location) return { lat: chosenCg.data.location.lat, lng: chosenCg.data.location.lng, label: chosenCg.data.name };
    return null;
  }, [chosenTrip?.at.lat, chosenTrip?.at.lng, chosenTrip?.label, chosenCg]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      title="Recommend lakes"
      action={
        <Button type="button" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {!open ? (
        <p className="text-sm text-ink-2">Pick a campsite and see which lakes within 25 miles are worth fishing, and why.</p>
      ) : (
        <div className="space-y-3">
          <div role="group" aria-label="Campsite from" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {(['trip', 'campground'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={src.kind === k}
                onClick={() => setSrc({ kind: k, id: null })}
                className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${src.kind === k ? 'bg-brand text-brand-ink' : 'text-ink'}`}
              >
                {k === 'trip' ? 'One of our trips' : 'A campground'}
              </button>
            ))}
          </div>

          {src.kind === 'trip' ? (
            tripOptions.length ? (
              <Field label="Trip">
                <select className={inputClass} value={chosenTrip?.id ?? ''} onChange={(e) => setSrc({ id: e.target.value })}>
                  {tripOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.trip.name} · {fmtDates(t.trip.startDate, t.trip.endDate)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p className="text-sm text-ink-2">
                {trips.loading ? 'Loading trips…' : 'No trips with a campsite yet. Set a trip’s location or campground, or pick a campground instead.'}
              </p>
            )
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" onClick={() => setPicking(true)}>
                  {chosenCg ? 'Change campground' : 'Choose a campground'}
                </Button>
                {chosenCg && <span className="min-w-0 font-semibold">{chosenCg.data.name}</span>}
              </div>
              {chosenCg && !chosenCg.data.location && (
                <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">This campground has no map pin, so we can’t measure distances. Pick another or add its location.</p>
              )}
              <button
                type="button"
                aria-pressed={src.towing}
                onClick={() => setSrc({ towing: !src.towing })}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${src.towing ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
              >
                {src.towing ? 'Towing the boat ✓' : 'Towing the boat'}
              </button>
              <p className="text-xs text-ink-2">No trip dates here, so the time of year isn’t counted.</p>
            </div>
          )}

          {origin && (
            <LakeRecsList
              key={`${origin.lat},${origin.lng}`}
              origin={origin}
              startDate={chosenTrip?.trip.startDate ?? null}
              endDate={chosenTrip?.trip.endDate ?? null}
              towing={chosenTrip ? chosenTrip.trip.towing : src.towing}
              tripId={chosenTrip?.id ?? null}
              prefsKey={chosenTrip ? `lakeRecs:trip:${chosenTrip.id}` : 'lakeRecs:panel:prefs'}
            />
          )}

          {picking && (
            <CampgroundPicker
              campgrounds={campgrounds.rows}
              selectedId={chosenCg?.id ?? null}
              near={origin}
              nearLabel={origin?.label ?? ''}
              onPick={(id) => {
                setSrc({ kind: 'campground', id });
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
    </Card>
  );
}
