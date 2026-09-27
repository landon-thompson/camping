import { useEffect, useRef, useState } from 'react';
import { saveRecord, useRecord, useRecords } from '../../db/records';
import { db } from '../../db/local';
import { Button, Card, inputClass } from '../../components/ui';
import type { BoatLaunchSite, NearbyLake, Trip, TripNearby } from '../../model/schemas';
import { viaAppServer } from '../reservations/stateParks';
import { distanceKm, errText } from '../places/arcgis';
import { findBoatLaunches, LAUNCH_SEARCH_KM } from '../places/waterAccess';
import { fetchLakesNear, parseDowInput } from './lakeSurvey';
import { LakeFishing } from './LakeFishing';

const miles = (km: number) => `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi`;
const REFRESH_WHEN_MOVED_KM = 0.3;

/** Lakes to offer: LakeFinder's nearby lakes plus the lakes the nearby launches go into. */
export function lakesFrom(nearby: NearbyLake[], launches: BoatLaunchSite[]): NearbyLake[] {
  const out = [...nearby];
  for (const l of launches) {
    if (l.dow && !out.some((x) => x.dow === l.dow)) out.push({ dow: l.dow, name: l.water || l.name, county: '' });
  }
  return out;
}

/** Default fishing lakes: the one the nearest launch goes into, else the nearest lake. */
export function defaultLakes(lakes: NearbyLake[], launches: BoatLaunchSite[]): string[] {
  const viaLaunch = launches.find((l) => l.dow)?.dow;
  if (viaLaunch) return [viaLaunch];
  return lakes[0] ? [lakes[0].dow] : [];
}

/** Trip tab: public boat launches near the trip and the DNR fish survey for its lake(s). */
export function TripLakeSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const campgrounds = useRecords('campground');
  const nearbyId = `trip_nearby:${tripId}`;
  const nearby = useRecord('trip_nearby', nearbyId);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [addText, setAddText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const triedFor = useRef<string | null>(null);

  const t = trip.data;
  const cg = t?.campgroundId ? campgrounds.rows.find((c) => c.id === t.campgroundId)?.data : undefined;
  const anchor = t?.location ?? cg?.location ?? null;
  const anchorKey = anchor ? `${anchor.lat.toFixed(4)},${anchor.lng.toFixed(4)}` : null;
  const data = nearby.data;
  const stale = !!anchor && (!data || distanceKm(data.anchor, anchor) > REFRESH_WHEN_MOVED_KM);

  async function refresh() {
    if (!anchor) return;
    setBusy(true);
    try {
      await load(anchor);
    } finally {
      setBusy(false);
    }
  }

  async function load(anchor: { lat: number; lng: number }) {
    const at = { lat: anchor.lat, lng: anchor.lng };
    const [launchRes, lakeRes] = await Promise.all([
      findBoatLaunches(at, viaAppServer).catch((e) => ({ launches: [] as BoatLaunchSite[], report: [`Boat launches: ${errText(e)}`] })),
      fetchLakesNear(at.lat, at.lng, viaAppServer)
        .then((lakes) => ({ lakes, line: `LakeFinder: ${lakes.length} lake${lakes.length === 1 ? '' : 's'} nearby` }))
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
    };
    await saveRecord('trip_nearby', nearbyId, record);
    // Fill the trip's boat launch with the nearest one if it has none yet.
    const latest = (await db.records.get(tripId))?.data as Trip | undefined;
    const first = launchRes.launches[0];
    if (latest && !latest.boatLaunch && first) {
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

  const launches = data?.launches ?? [];
  const shown = showAll ? launches : launches.slice(0, 5);
  const selected = data?.selectedLakes ?? [];

  async function saveSelection(next: string[], extraLake?: NearbyLake) {
    if (!data) return;
    const lakes = extraLake && !data.lakes.some((l) => l.dow === extraLake.dow) ? [...data.lakes, extraLake] : data.lakes;
    await saveRecord('trip_nearby', nearbyId, { ...data, lakes, selectedLakes: next });
  }

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
            Public water accesses within {miles(LAUNCH_SEARCH_KM)} of {t.location?.label || cg?.name || 'the trip'}, from the DNR’s official list.
          </p>
          {busy && !data && <p role="status" className="text-sm text-ink-2">Looking for boat launches and lakes…</p>}
          {data && !launches.length && <p className="text-sm text-ink-2">No public launches found nearby.</p>}
          <ul className="space-y-2">
            {shown.map((l) => {
              const isTrip = t.boatLaunch && Math.abs(t.boatLaunch.lat - l.lat) < 1e-5 && Math.abs(t.boatLaunch.lng - l.lng) < 1e-5;
              return (
                <li key={`${l.name}-${l.lat}-${l.lng}`} className="rounded-xl bg-surface-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{l.name}</span>
                    <span className="text-sm tabular-nums text-ink-2">{miles(l.distanceKm)}</span>
                  </div>
                  <p className="text-sm text-ink-2">{[l.water, l.ramp && `ramp: ${l.ramp}`, l.manager].filter(Boolean).join(' · ') || 'No details in the data'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isTrip ? (
                      <span className="inline-flex min-h-11 items-center rounded-xl bg-ok/15 px-3 text-sm font-semibold text-ok">This trip’s launch ✓</span>
                    ) : (
                      <Button type="button" variant="secondary" onClick={() => void saveRecord('trip', tripId, { ...t, boatLaunch: { lat: l.lat, lng: l.lng, name: l.name } })}>
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
            })}
          </ul>
          {launches.length > 5 && (
            <Button type="button" variant="ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${launches.length}`}
            </Button>
          )}
          {data && (
            <details className="text-sm text-ink-2">
              <summary className="min-h-11 cursor-pointer content-center">Data sources · updated {new Date(data.fetchedAt).toLocaleDateString()}</summary>
              <ul className="list-disc pl-5">
                {data.report.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-1">Check ramp conditions and any launch fees on site; the printed DNR water access maps are the reference.</p>
            </details>
          )}
        </div>
      </Card>

      <Card title="Fishing">
        <div className="space-y-3">
          {data && data.lakes.length > 0 && (
            <div>
              <span className="mb-1 block text-sm font-semibold text-ink-2">Lakes nearby — tap to show fishing info</span>
              <div className="flex flex-wrap gap-2">
                {data.lakes.map((l) => {
                  const on = selected.includes(l.dow);
                  return (
                    <button
                      key={l.dow}
                      type="button"
                      aria-pressed={on}
                      onClick={() => void saveSelection(on ? selected.filter((d) => d !== l.dow) : [...selected, l.dow])}
                      className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {data && !data.lakes.length && <p className="text-sm text-ink-2">No lakes found nearby in LakeFinder. Add one below.</p>}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const dow = parseDowInput(addText);
              if (!dow) {
                setAddError('Paste the lake’s LakeFinder link, or its 8-digit DNR lake number (e.g. 69-0254-00).');
                return;
              }
              setAddError(null);
              setAddText('');
              if (!data) return;
              void saveSelection(selected.includes(dow) ? selected : [...selected, dow], { dow, name: `Lake ${dow}`, county: '' });
            }}
          >
            <label className="block min-w-0 flex-1 text-sm">
              <span className="mb-1 block font-semibold text-ink-2">Add another lake</span>
              <input className={inputClass} value={addText} placeholder="LakeFinder link or lake number" onChange={(e) => setAddText(e.target.value)} />
            </label>
            <Button type="submit" variant="secondary" disabled={!addText.trim() || !data}>
              Add
            </Button>
          </form>
          {addError && <p className="text-sm text-warn">{addError}</p>}

          {selected.map((dow) => (
            <LakeFishing key={dow} dow={dow} name={data?.lakes.find((l) => l.dow === dow)?.name ?? `Lake ${dow}`} />
          ))}
        </div>
      </Card>
    </div>
  );
}
