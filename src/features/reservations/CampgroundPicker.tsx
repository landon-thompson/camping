import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, inputClass } from '../../components/ui';
import type { Campground, LatLng } from '../../model/schemas';
import { MN_CENTER } from '../../lib/map';
import { TripMap, type TripMapMarker } from '../trips/TripMap';
import { AGENCY_LABEL } from './data';
import { SYSTEM_LABEL } from './shared';
import { filterCampgrounds, KIND_LABEL, kindOf, NO_FILTER, type CampgroundFilter, type Kind, type StateCode } from './campgroundFilter';

const PIN: Record<Kind, string> = { 'state-park': 'P', 'national-forest': 'F', 'state-forest': 'SF', other: '•' };
const miles = (km: number) => `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi`;

function readView(): 'list' | 'map' {
  try {
    return sessionStorage.getItem('campgroundPickerView') === 'map' ? 'map' : 'list';
  } catch {
    return 'list';
  }
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${on ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
    >
      {children}
    </button>
  );
}

/** Full-screen campground finder: search, filters, nearest-first list, and a map of every campground with a pin. */
export function CampgroundPicker({
  campgrounds,
  selectedId,
  near,
  nearLabel,
  onPick,
  onClose,
}: {
  campgrounds: { id: string; data: Campground }[];
  selectedId: string | null;
  near: LatLng | null;
  nearLabel: string;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<CampgroundFilter>(NO_FILTER);
  const [view, setViewState] = useState<'list' | 'map'>(readView);
  const [focus, setFocus] = useState<string | null>(selectedId);
  const hits = useMemo(() => filterCampgrounds(campgrounds, f, near), [campgrounds, f, near]);
  const pinned = useMemo(() => hits.filter((h) => h.data.location), [hits]);
  const focused = hits.find((h) => h.id === focus) ?? null;

  const setView = (v: 'list' | 'map') => {
    setViewState(v);
    try {
      sessionStorage.setItem('campgroundPickerView', v);
    } catch {
      /* per-visit preference only */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const markers: TripMapMarker[] = useMemo(
    () => [
      ...(near ? [{ id: '__near', lat: near.lat, lng: near.lng, label: '★', variant: 'plain' as const, title: nearLabel }] : []),
      ...pinned.map((h) => ({
        id: h.id,
        lat: h.data.location!.lat,
        lng: h.data.location!.lng,
        label: PIN[kindOf(h.data)],
        variant: h.id === selectedId || h.id === focus ? ('accent' as const) : ('trip' as const),
        title: h.data.name,
      })),
    ],
    [pinned, near, nearLabel, selectedId, focus],
  );

  const toggle = <K extends keyof CampgroundFilter>(k: K, v: CampgroundFilter[K]) => setF((cur) => ({ ...cur, [k]: cur[k] === v ? NO_FILTER[k] : v }));

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose a campground" className="fixed inset-0 z-[60] flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-lg font-bold">Choose a campground</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-full text-2xl text-ink-2">
          ×
        </button>
      </header>

      <div className="space-y-2 border-b border-line px-4 py-3">
        <input
          className={inputClass}
          type="search"
          value={f.q}
          placeholder="Search name or park / forest"
          aria-label="Search campgrounds"
          enterKeyHint="search"
          onChange={(e) => setF({ ...f, q: e.target.value })}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filters">
          {(['MN', 'SD'] as StateCode[]).map((st) => (
            <Chip key={st} on={f.state === st} onClick={() => toggle('state', st)}>
              {st === 'MN' ? 'Minnesota' : 'South Dakota'}
            </Chip>
          ))}
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <Chip key={k} on={f.kind === k} onClick={() => toggle('kind', k)}>
              {KIND_LABEL[k]}
            </Chip>
          ))}
          <Chip on={f.electric} onClick={() => setF({ ...f, electric: !f.electric })}>
            Electric
          </Chip>
          <Chip on={f.boatLaunch} onClick={() => setF({ ...f, boatLaunch: !f.boatLaunch })}>
            Boat launch
          </Chip>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-ink-2">
            {hits.length} campground{hits.length === 1 ? '' : 's'}
            {near ? ` · nearest to ${nearLabel}` : ''}
          </p>
          <div role="group" aria-label="View" className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {(['list', 'map'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${view === v ? 'bg-brand text-brand-ink' : 'text-ink'}`}
              >
                {v === 'list' ? 'List' : 'Map'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <ul className="flex-1 divide-y divide-line overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onPick(h.id)}
                aria-current={h.id === selectedId ? 'true' : undefined}
                className={`flex min-h-16 w-full items-start justify-between gap-3 py-3 text-left ${h.id === selectedId ? 'font-semibold' : ''}`}
              >
                <CampgroundSummary cg={h.data} distanceKm={h.distanceKm} selected={h.id === selectedId} />
              </button>
            </li>
          ))}
          {!hits.length && <li className="py-6 text-ink-2">No campgrounds match. Clear a filter, or add one below.</li>}
          <li className="flex flex-wrap gap-3 py-4">
            {selectedId && (
              <Button type="button" variant="secondary" onClick={() => onPick(null)}>
                No campground
              </Button>
            )}
            <Link to="/book/campgrounds" className="inline-flex min-h-12 items-center font-semibold text-brand underline" onClick={onClose}>
              Campground directory (add or import)
            </Link>
          </li>
        </ul>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <TripMap
            center={near ? [near.lng, near.lat] : MN_CENTER}
            zoom={6}
            markers={markers}
            tripId={null}
            fitMarkers
            labels={false}
            trailTools={false}
            onMarkerClick={(id) => id !== '__near' && setFocus(id)}
            className="h-full min-h-0 w-full flex-1 rounded-none border-0"
          />
          {pinned.length < hits.length && (
            <p className="absolute left-2 top-2 rounded-lg bg-surface/90 px-2 py-1 text-xs font-semibold text-ink-2">
              {hits.length - pinned.length} without a map pin — see List
            </p>
          )}
          {focused && (
            <div className="absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] rounded-2xl border border-line bg-surface p-3 shadow-lg">
              <CampgroundSummary cg={focused.data} distanceKm={focused.distanceKm} selected={focused.id === selectedId} />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" onClick={() => onPick(focused.id)}>
                  {focused.id === selectedId ? 'Keep this one' : 'Choose'}
                </Button>
                <Link
                  to={`/book/campgrounds/${encodeURIComponent(focused.id)}`}
                  onClick={onClose}
                  className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface-2 px-4 font-semibold"
                >
                  Details
                </Link>
                <Button type="button" variant="ghost" onClick={() => setFocus(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
          {!focused && pinned.length > 0 && (
            <p className="absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] rounded-xl bg-surface/90 p-2 text-center text-sm text-ink-2">
              Tap a pin · P state park · F national forest · SF state forest · ★ {nearLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CampgroundSummary({ cg, distanceKm, selected }: { cg: Campground; distanceKm: number | null; selected: boolean }) {
  const features = [cg.electric === true && 'Electric', cg.boatLaunch === true && 'Boat launch'].filter(Boolean) as string[];
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {cg.name}
          {selected && <span className="ml-2 rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">Chosen</span>}
        </span>
        <span className="block text-sm font-normal text-ink-2">
          {[cg.unit !== cg.name && cg.unit, AGENCY_LABEL[cg.agency], SYSTEM_LABEL[cg.bookingSystem]].filter(Boolean).join(' · ')}
        </span>
        {(features.length > 0 || !cg.location) && (
          <span className="mt-1 flex flex-wrap gap-1 text-xs font-normal">
            {features.map((x) => (
              <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5">
                {x}
              </span>
            ))}
            {!cg.location && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-warn">No map pin</span>}
          </span>
        )}
      </span>
      {distanceKm !== null && <span className="shrink-0 text-sm font-normal tabular-nums text-ink-2">{miles(distanceKm)}</span>}
    </>
  );
}
