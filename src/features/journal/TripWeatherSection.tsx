import { useEffect, useRef, useState } from 'react';
import { getMeta, setMeta } from '../../db/local';
import { useRecord } from '../../db/records';
import { Button, Card } from '../../components/ui';
import { NwsError, fetchNwsForecast, formatAsOf, formatPeriod, type NwsForecast } from './nws';

const MAX_PERIODS_SHOWN = 6;

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Shown on each trip page (Phase 2 places it). NWS forecast for trip.location, cached offline. */
export function TripWeatherSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const metaKey = `weather:${tripId}`;
  const campground = useRecord('campground', trip.data?.campgroundId ?? '');
  const location =
    trip.data?.location ??
    (campground.data?.location ? { ...campground.data.location, label: campground.data.name } : null);

  const [cached, setCached] = useState<NwsForecast | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());
  const autoFetchedFor = useRef<string | null>(null);

  useEffect(() => {
    setCacheLoaded(false);
    setError(null);
    let cancelled = false;
    void getMeta<NwsForecast>(metaKey).then((v) => {
      if (cancelled) return;
      setCached(v ?? null);
      setCacheLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [metaKey]);

  useEffect(() => {
    const update = () => setOnline(isOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function refresh() {
    if (!location) return;
    if (!isOnline()) {
      setOnline(false);
      setError(cached ? null : 'Offline, and no forecast has been saved for this trip yet.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNwsForecast(location.lat, location.lng);
      setCached(result);
      await setMeta(metaKey, result);
    } catch (e) {
      if (e instanceof NwsError) setError(e.message);
      else setError('Could not load the forecast.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!location || !cacheLoaded) return;
    if (autoFetchedFor.current === tripId) return;
    autoFetchedFor.current = tripId;
    void refresh();
    // Intentionally only re-runs when the trip or its known location/cache-load
    // state changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, cacheLoaded, tripId]);

  if (trip.loading || !trip.data) return null;

  if (!location) {
    return (
      <Card title="Weather">
        <p className="text-ink-2">Add a location to this trip to see its forecast.</p>
      </Card>
    );
  }

  const periods = cached?.periods.slice(0, MAX_PERIODS_SHOWN) ?? [];

  return (
    <Card
      title="Weather"
      action={
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading} className="px-3 text-sm">
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    >
      <p className="mb-2 text-sm text-ink-2">
        National Weather Service forecast for {location.label || `${location.lat.toFixed(2)}, ${location.lng.toFixed(2)}`}. Covers
        about 7 days out.
      </p>
      {cached && (
        <p className="mb-3 text-sm text-ink-2">
          {formatAsOf(cached.fetchedAt)}
          {!online ? ' — offline, showing the last saved forecast' : ''}
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn" role="alert">
          {error}
        </p>
      )}
      {!error && !cached && !loading && (
        <p className="text-ink-2">{online ? 'No forecast saved yet.' : 'Offline, and no forecast has been saved for this trip yet.'}</p>
      )}
      {periods.length > 0 && (
        <ul className="space-y-2">
          {periods.map((p) => (
            <li key={`${p.name}-${p.startTime}`} className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
              {formatPeriod(p)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
