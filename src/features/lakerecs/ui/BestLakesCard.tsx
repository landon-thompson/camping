import { useMemo } from 'react';
import { Card } from '../../../components/ui';
import { useRecord, useRecords } from '../../../db/records';
import { LakeRecsList } from './LakeRecsList';

/** Trip › Lake & fish: the lakes worth fishing near this trip's campsite, best first. */
export function BestLakesCard({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const campgrounds = useRecords('campground');
  const t = trip.data;
  const cg = t?.campgroundId ? campgrounds.rows.find((c) => c.id === t.campgroundId)?.data : undefined;
  const at = t?.location ?? cg?.location ?? null;
  const label = t?.location?.label || cg?.name || 'Campsite';
  const origin = useMemo(() => (at ? { lat: at.lat, lng: at.lng, label } : null), [at?.lat, at?.lng, label]); // eslint-disable-line react-hooks/exhaustive-deps

  if (trip.loading || !t || !origin) return null;
  return (
    <Card title="Best lakes">
      <p className="-mt-2 mb-3 text-sm text-ink-2">Within 25 miles of {label}, best first. Tap a lake to see why.</p>
      <LakeRecsList
        origin={origin}
        startDate={t.startDate}
        endDate={t.endDate}
        towing={t.towing}
        tripId={tripId}
        prefsKey={`lakeRecs:trip:${tripId}`}
      />
    </Card>
  );
}
