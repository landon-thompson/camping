import { useRecord } from '../../db/records';
import { TrailsScope } from './TrailsScope';

/** Shown on each trip page's Trails tab. Shares its layout with `/trails` — see TrailsScope. */
export function TripTrailsSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const tripLocation = trip.data?.location ? { lat: trip.data.location.lat, lng: trip.data.location.lng } : null;

  return <TrailsScope tripId={tripId} tripLocation={tripLocation} />;
}
