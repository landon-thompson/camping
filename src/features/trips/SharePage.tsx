import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MN_CENTER } from '../../lib/map';
import type { Campground, LatLng, Trip } from '../../model/schemas';
import { TripMap, type TripMapMarker } from './TripMap';

interface SharePayload {
  trip: Trip;
  campground: Campground | null;
  reservation: { status: string; arrivalDate: string | null; nights: number | null; site: string } | null;
  routes: { name: string; geometry: { type: 'LineString' | 'MultiLineString'; coordinates: unknown } }[];
  pins: { name: string; kind: string; position: LatLng }[];
}

type Loaded = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: SharePayload };

/**
 * Public read-only trip page at /s/:token (no sign-in). Fetches the trip from
 * the server and renders it; writes nothing locally.
 */
export function SharePage() {
  const { token = '' } = useParams();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoaded({ state: 'loading' });
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setLoaded({ state: 'error', message: 'This shared trip link isn’t available. It may have been revoked or never existed.' });
          return;
        }
        if (!res.ok) {
          setLoaded({ state: 'error', message: 'Couldn’t load this trip right now. Try again in a moment.' });
          return;
        }
        const data = (await res.json()) as SharePayload;
        setLoaded({ state: 'ok', data });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: 'error', message: 'Couldn’t reach the server. Check your connection and try again.' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loaded.state === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-ink-2" aria-busy="true">
        Loading…
      </div>
    );
  }
  if (loaded.state === 'error') {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <h1 className="text-2xl font-bold text-brand">Camp Planner</h1>
        <p className="text-ink-2">{loaded.message}</p>
      </div>
    );
  }

  const { trip, campground, reservation, routes, pins } = loaded.data;
  const markers: TripMapMarker[] = [];
  if (trip.location) markers.push({ id: 'trip', lat: trip.location.lat, lng: trip.location.lng, label: String(trip.level) });
  for (const [i, pin] of pins.entries()) markers.push({ id: `pin-${i}`, lat: pin.position.lat, lng: pin.position.lng, label: '•', variant: 'plain' });
  const center: [number, number] = trip.location ? [trip.location.lng, trip.location.lat] : MN_CENTER;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <h1 className="text-xl font-bold text-brand">Camp Planner</h1>
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm font-semibold text-ink-2">Level {trip.level}</p>
        <h2 className="text-2xl font-bold">{trip.name}</h2>
        <p className="mt-1 text-ink-2">
          {trip.startDate && trip.endDate ? `${trip.startDate} – ${trip.endDate}` : trip.targetWindow || 'Dates not set yet'}
        </p>

        {campground && (
          <p className="mt-3">
            <span className="font-semibold">{campground.name}</span>
            {campground.unit && <span className="text-ink-2"> · {campground.unit}</span>}
          </p>
        )}
        {reservation?.site && <p className="text-ink-2">Site {reservation.site}</p>}
        {reservation?.nights != null && <p className="text-ink-2">{reservation.nights} night{reservation.nights === 1 ? '' : 's'}</p>}

        {(trip.location || routes.length > 0 || pins.length > 0) && (
          <div className="mt-4">
            <TripMap center={center} zoom={trip.location ? 10 : 6} markers={markers} tripId={null} className="h-56 w-full" />
            {trip.location?.label && <p className="mt-1 text-sm text-ink-2">{trip.location.label}</p>}
          </div>
        )}

        {trip.notes && <p className="mt-4 whitespace-pre-wrap text-ink-2">{trip.notes}</p>}
      </div>
      <p className="text-center text-xs text-ink-2">Read-only itinerary shared from Camp Planner.</p>
    </div>
  );
}
