import { useEffect, useRef, useState } from 'react';
import { saveRecord, useRecord, useRecords } from '../../db/records';
import { db } from '../../db/local';
import { Button, Card, inputClass } from '../../components/ui';
import type { BoatLaunchSite, NearbyLake, Trip, TripNearby } from '../../model/schemas';
import { viaAppServer } from '../reservations/stateParks';
import { distanceKm, errText } from '../places/arcgis';
import { CURRENT_LAUNCH_SOURCES, findBoatLaunches, LAUNCH_SEARCH_KM } from '../places/waterAccess';
import { fetchLakesNear, LAKE_RADIUS_KM } from './lakeSurvey';
import { LakePicker } from './LakePicker';
import { defaultLakes, inSouthDakota, lakeRows, lakesFrom, SD_FISHERY_REPORTS, watersFromLaunches } from './lakeList';
import { LakeFishing } from './LakeFishing';

const miles = (km: number) => `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi`;
const REFRESH_WHEN_MOVED_KM = 0.3;
const MI = 1.609344;
const RADII_MI = [5, 10, 25] as const;

/** Trip tab: public boat launches near the trip, lakes within 25 miles of its launch, and DNR fish surveys. */
export function TripLakeSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const campgrounds = useRecords('campground');
  const nearbyId = `trip_nearby:${tripId}`;
  const nearby = useRecord('trip_nearby', nearbyId);
  const [busy, setBusy] = useState(false);
  const [showAllLaunches, setShowAllLaunches] = useState(false);
  const [radiusMi, setRadiusMi] = useState<(typeof RADII_MI)[number]>(25);
  const [lakeFilter, setLakeFilter] = useState('');
  const [showAllLakes, setShowAllLakes] = useState(false);
  const triedFor = useRef<string | null>(null);

  const t = trip.data;
  const cg = t?.campgroundId ? campgrounds.rows.find((c) => c.id === t.campgroundId)?.data : undefined;
  const anchor = t?.location ?? cg?.location ?? null;
  const anchorKey = anchor ? `${anchor.lat.toFixed(4)},${anchor.lng.toFixed(4)}` : null;
  const data = nearby.data;
  // Refetch when the trip moved, when an earlier try used an older source, or before the 25-mile lake list existed.
  const stale =
    !!anchor &&
    (!data ||
      distanceKm(data.anchor, anchor) > REFRESH_WHEN_MOVED_KM ||
      data.radiusKm !== LAKE_RADIUS_KM ||
      (!data.launches.length && !data.report.some((r) => CURRENT_LAUNCH_SOURCES.some((l) => r.startsWith(`${l}:`)))));

  async function refresh() {
    if (!anchor) return;
    setBusy(true);
    try {
      await load({ lat: anchor.lat, lng: anchor.lng });
    } finally {
      setBusy(false);
    }
  }

  async function load(at: { lat: number; lng: number }) {
    const [launchRes, lakeRes] = await Promise.all([
      findBoatLaunches(at, viaAppServer).catch((e) => ({ launches: [] as BoatLaunchSite[], report: [`Boat launches: ${errText(e)}`] })),
      fetchLakesNear(at.lat, at.lng, viaAppServer)
        .then((lakes) => ({ lakes, line: `LakeFinder: ${lakes.length} lake${lakes.length === 1 ? '' : 's'} within 25 mi` }))
        .catch((e) => ({ lakes: [] as NearbyLake[], line: `LakeFinder: ${errText(e)}` })),
    ]);
    const lakes = lakesFrom(lakeRes.lakes, launchRes.launches);
    const prev = (await db.records.get(nearbyId))?.data as TripNearby | undefined;
    // Keep lakes the owner picked (including ones typed in), else pick sensible defaults.
    const kept = (prev?.selectedLakes ?? []).filter((d) => lakes.some((l) => l.dow === d) || prev?.lakes.every((l) => l.dow !== d));
    const record: TripNearby = {
      tripId,
      anchor: at,
      fetchedAt: new Date().toISOString(),
      launches: launchRes.launches,
      lakes: [...lakes, ...(prev?.lakes.filter((l) => kept.includes(l.dow) && !lakes.some((x) => x.dow === l.dow)) ?? [])],
      selectedLakes: kept.length ? kept : defaultLakes(lakes, launchRes.launches),
      report: [...launchRes.report, lakeRes.line],
      radiusKm: LAKE_RADIUS_KM,
    };
    await saveRecord('trip_nearby', nearbyId, record);
    // Fill the trip's boat launch with the nearest one if it has none yet.
    const latest = (await db.records.get(tripId))?.data as Trip | undefined;
    const first = launchRes.launches[0];
    if (latest && !latest.boatLaunch && first && first.distanceKm <= LAUNCH_SEARCH_KM) {
      await saveRecord('trip', tripId, { ...latest, boatLaunch: { lat: first.lat, lng: first.lng, name: first.name } });
    }
  }

  useEffect(() => {
    if (!stale || busy || !anchorKey || triedFor.current === anchorKey || !navigator.onLine || nearby.loading) return;
    triedFor.current = anchorKey;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, anchorKey, nearby.loading]);

  if (trip.loading || !t) return null;
  if (!anchor) {
    return (
      <Card title="Lake & fishing">
        <p className="text-ink-2">Pick a campground in the Book tab (or set the trip’s location on the Plan tab) to see boat launches and fishing nearby.</p>
      </Card>
    );
  }

  const allLaunches = data?.launches ?? [];
  const closeLaunches = allLaunches.filter((l) => l.distanceKm <= LAUNCH_SEARCH_KM);
  const shownLaunches = showAllLaunches ? closeLaunches : closeLaunches.slice(0, 5);
  const selected = data?.selectedLakes ?? [];
  const setLaunch = (l: BoatLaunchSite) => void saveRecord('trip', tripId, { ...t, boatLaunch: { lat: l.lat, lng: l.lng, name: l.name } });

  // Lakes are measured from the trip's launch when it has one.
  const origin = t.boatLaunch ?? anchor;
  const originName = t.boatLaunch?.name || t.location?.label || cg?.name || 'the trip';
  const rows = data ? lakeRows(data.lakes, allLaunches, origin, radiusMi * MI) : [];
  const q = lakeFilter.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.lake.name.toLowerCase().includes(q)) : rows;
  const shownLakes = showAllLakes || q ? filtered : filtered.slice(0, 10);
  const southDakota = inSouthDakota(origin);
  const sdWaters = southDakota ? watersFromLaunches(allLaunches, origin, radiusMi * MI) : [];

  async function saveSelection(next: string[], extraLake?: NearbyLake) {
    if (!data) return;
    const lakes = extraLake && !data.lakes.some((l) => l.dow === extraLake.dow) ? [...data.lakes, extraLake] : data.lakes;
    await saveRecord('trip_nearby', nearbyId, { ...data, lakes, selectedLakes: next });
  }
  const toggleLake = (dow: string) => void saveSelection(selected.includes(dow) ? selected.filter((d) => d !== dow) : [...selected, dow]);

  return (
    <div className="space-y-4">
      <Card
        title="Boat launches nearby"
        action={
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Loading…' : 'Refresh'}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Public water accesses within {miles(LAUNCH_SEARCH_KM)} of {t.location?.label || cg?.name || 'the trip'}, from {southDakota ? 'South Dakota GFP’s boat ramp data' : 'the DNR’s official list'}.
          </p>
          {busy && !data && <p role="status" className="text-sm text-ink-2">Looking for boat launches and lakes…</p>}
          {data && !closeLaunches.length && !busy && (
            <div className="text-sm text-ink-2">
              <p>
                No public launches within {miles(LAUNCH_SEARCH_KM)}.{allLaunches.length ? ' See the lakes below for launches farther out.' : ' What each source said:'}
              </p>
              {!allLaunches.length && (
                <ul className="list-disc pl-5">
                  {data.report.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <ul className="space-y-2">
            {shownLaunches.map((l) => (
              <LaunchItem key={`${l.name}-${l.lat}-${l.lng}`} l={l} trip={t} onUse={() => setLaunch(l)} />
            ))}
          </ul>
          {closeLaunches.length > 5 && (
            <Button type="button" variant="ghost" onClick={() => setShowAllLaunches(!showAllLaunches)}>
              {showAllLaunches ? 'Show fewer' : `Show all ${closeLaunches.length}`}
            </Button>
          )}
          {data && allLaunches.length > 0 && (
            <details className="text-sm text-ink-2">
              <summary className="min-h-11 cursor-pointer content-center">Data sources · updated {new Date(data.fetchedAt).toLocaleDateString()}</summary>
              <ul className="list-disc pl-5">
                {data.report.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-1">Check ramp conditions and any launch fees on site; the state’s printed water access maps are the reference.</p>
            </details>
          )}
        </div>
      </Card>

      {southDakota && (
        <Card title={`South Dakota waters near ${originName}`}>
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              The DNR fish survey view is Minnesota-only. South Dakota GFP publishes its lake survey reports (with catch per net and sizes) in its Fishery
              Reports site — search the lake name there.
            </p>
            <a
              href={SD_FISHERY_REPORTS}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-brand-ink"
            >
              GFP Fishery Reports ↗
            </a>
            {sdWaters.length > 0 ? (
              <ul className="divide-y divide-line">
                {sdWaters.map((w) => (
                  <li key={w.water} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block font-semibold">{w.water}</span>
                      <span className="block text-sm text-ink-2">
                        {miles(w.distanceKm)} · {w.launches.length} public ramp{w.launches.length === 1 ? '' : 's'} · nearest: {w.launches[0]!.name}
                      </span>
                    </span>
                    {!sameSpot(t.boatLaunch, w.launches[0]!) && (
                      <Button type="button" variant="ghost" className="min-h-11 px-1" onClick={() => setLaunch(w.launches[0]!)}>
                        Use ramp
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              data && !busy && <p className="text-sm text-ink-2">No GFP boat ramps found within {radiusMi} miles — see “Data sources” above.</p>
            )}
            <div role="group" aria-label="Distance" className="flex gap-2">
              {RADII_MI.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={radiusMi === r}
                  onClick={() => setRadiusMi(r)}
                  className={`min-h-11 flex-1 rounded-full border text-sm font-semibold ${radiusMi === r ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
                >
                  {r} mi
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {(!southDakota || rows.length > 0) && (
      <Card title={`Lakes near ${originName}`}>
        <div className="space-y-3">
          <div role="group" aria-label="Distance" className="flex gap-2">
            {RADII_MI.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={radiusMi === r}
                onClick={() => setRadiusMi(r)}
                className={`min-h-11 flex-1 rounded-full border text-sm font-semibold ${radiusMi === r ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
              >
                {r} mi
              </button>
            ))}
          </div>
          {rows.length > 10 && (
            <input className={inputClass} value={lakeFilter} placeholder={`Search ${rows.length} lakes`} aria-label="Search lakes" onChange={(e) => setLakeFilter(e.target.value)} />
          )}
          {data && !rows.length && !busy && <p className="text-sm text-ink-2">No lakes found within {radiusMi} miles. Add one below.</p>}
          <ul className="divide-y divide-line">
            {shownLakes.map((r) => {
              const on = selected.includes(r.lake.dow);
              const nearest = r.launches[0];
              return (
                <li key={r.lake.dow} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{r.lake.name}</p>
                      <p className="text-sm text-ink-2">
                        {[
                          r.distanceKm === null ? 'distance unknown' : miles(r.distanceKm),
                          r.launches.length ? `${r.launches.length} public launch${r.launches.length === 1 ? '' : 'es'}` : 'no public launch listed',
                          r.lake.county,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleLake(r.lake.dow)}
                      className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold ${on ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
                    >
                      {on ? 'Fish info ✓' : 'Fish info'}
                    </button>
                  </div>
                  {nearest && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-ink-2">Nearest launch: {nearest.name}</span>
                      {!sameSpot(t.boatLaunch, nearest) && (
                        <Button type="button" variant="ghost" className="min-h-11 px-1" onClick={() => setLaunch(nearest)}>
                          Use it
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!q && filtered.length > 10 && (
            <Button type="button" variant="ghost" onClick={() => setShowAllLakes(!showAllLakes)}>
              {showAllLakes ? 'Show fewer' : `Show all ${filtered.length} lakes`}
            </Button>
          )}

          <LakePicker
            selected={selected}
            onPick={(lake) => {
              if (!data) return;
              void saveSelection(selected.includes(lake.dow) ? selected : [...selected, lake.dow], lake);
            }}
          />
          {!data && <p className="text-sm text-ink-2">Lakes can be added once this trip’s nearby data has loaded.</p>}
        </div>
      </Card>

      )}

      {selected.length > 0 && (
        <Card title="Fishing">
          <div className="space-y-3">
            {selected.map((dow) => (
              <LakeFishing key={dow} dow={dow} name={data?.lakes.find((l) => l.dow === dow)?.name ?? `Lake ${dow}`} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const sameSpot = (a: { lat: number; lng: number } | null | undefined, b: { lat: number; lng: number }) =>
  !!a && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

function LaunchItem({ l, trip, onUse }: { l: BoatLaunchSite; trip: Trip; onUse: () => void }) {
  return (
    <li className="rounded-xl bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{l.name}</span>
        <span className="text-sm tabular-nums text-ink-2">{miles(l.distanceKm)}</span>
      </div>
      <p className="text-sm text-ink-2">{[l.water, l.ramp && `ramp: ${l.ramp}`, l.manager].filter(Boolean).join(' · ') || 'No details in the data'}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sameSpot(trip.boatLaunch, l) ? (
          <span className="inline-flex min-h-11 items-center rounded-xl bg-ok/15 px-3 text-sm font-semibold text-ok">This trip’s launch ✓</span>
        ) : (
          <Button type="button" variant="secondary" onClick={onUse}>
            Use for this trip
          </Button>
        )}
        <a
          href={`https://maps.apple.com/?daddr=${l.lat},${l.lng}&q=${encodeURIComponent(l.name)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold"
        >
          Directions ↗
        </a>
      </div>
    </li>
  );
}
