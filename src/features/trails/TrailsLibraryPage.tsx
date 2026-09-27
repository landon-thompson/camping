import { PageTitle } from '../../components/ui';
import { TrailsScope } from './TrailsScope';

/** `/trails` — every imported route and pin across all trips, plus a full map. Optional per contract. */
export function TrailsLibraryPage() {
  return (
    <div className="space-y-4">
      <PageTitle sub="Every route and pin imported from onX/Gaia, across all trips">Trails</PageTitle>
      <TrailsScope tripId={null} mapZoom={7} />
    </div>
  );
}
