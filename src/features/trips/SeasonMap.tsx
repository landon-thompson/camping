import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecords } from '../../db/records';
import { MN_CENTER } from '../../lib/map';
import { TripMap, type TripMapMarker } from './TripMap';
import { compareTripOrder } from './utils';

/** Every trip with a place (its own pin, else its campground's), plus home base. */
export function useSeasonMarkers(): { markers: TripMapMarker[]; center: [number, number]; missing: number } {
  const settings = useRecords('settings');
  const trips = useRecords('trip');
  const campgrounds = useRecords('campground');
  const homeBase = settings.rows[0]?.data.homeBase ?? null;

  return useMemo(() => {
    const cgLoc = new Map(campgrounds.rows.flatMap((c) => (c.data.location ? [[c.id, c.data.location] as const] : [])));
    const out: TripMapMarker[] = [];
    if (homeBase?.lat != null && homeBase.lng != null) {
      out.push({ id: 'home', lat: homeBase.lat, lng: homeBase.lng, label: '⌂', variant: 'home', title: homeBase.name || 'Home' });
    }
    let missing = 0;
    for (const t of [...trips.rows].sort((a, b) => compareTripOrder(a.data, b.data))) {
      if (t.data.status === 'cancelled') continue;
      const loc = t.data.location ?? cgLoc.get(t.data.campgroundId ?? '') ?? null;
      if (loc) out.push({ id: t.id, lat: loc.lat, lng: loc.lng, label: String(t.data.level), title: t.data.name });
      else missing++;
    }
    const center: [number, number] = homeBase?.lat != null && homeBase.lng != null ? [homeBase.lng, homeBase.lat] : MN_CENTER;
    return { markers: out, center, missing };
  }, [homeBase, trips.rows, campgrounds.rows]);
}

/** Season map: every trip pinned; tap a pin to open that trip. */
export function SeasonMap({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { markers, center, missing } = useSeasonMarkers();
  return (
    <div className="space-y-2">
      <TripMap
        center={center}
        zoom={6}
        markers={markers}
        tripId={null}
        fitMarkers
        onMarkerClick={(id) => {
          if (id !== 'home') navigate(`/trips/${id}`);
        }}
        className={className}
      />
      <p className="text-sm text-ink-2">
        Tap a trip’s pin to open it.
        {missing > 0 && ` ${missing} trip${missing === 1 ? ' has' : 's have'} no place yet — pick a campground in its Book tab.`}
      </p>
    </div>
  );
}
