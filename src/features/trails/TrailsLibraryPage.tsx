import { useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { Card, PageTitle } from '../../components/ui';
import { ExportPanel } from './ExportPanel';
import { ImportPanel } from './ImportPanel';
import { MVUM_LEGAL_NOTE } from './mvum';
import { OfflinePanel } from './OfflinePanel';
import { PinsPanel } from './PinsPanel';
import { RoutesPanel } from './RoutesPanel';
import { TrailsMap } from './TrailsMap';

/** `/trails` — every imported route and pin across all trips, plus a full map. Optional per contract. */
export function TrailsLibraryPage() {
  const [map, setMap] = useState<MapLibreMap | null>(null);

  return (
    <div className="space-y-4">
      <PageTitle sub="Every route and pin imported from onX/Gaia, across all trips">Trails</PageTitle>
      <Card>
        <p className="text-sm text-ink-2">{MVUM_LEGAL_NOTE}</p>
      </Card>
      <TrailsMap tripId={null} zoom={7} onReady={setMap} />
      <ImportPanel tripId={null} />
      <RoutesPanel tripId={null} />
      <PinsPanel tripId={null} />
      <ExportPanel tripId={null} />
      <OfflinePanel tripId={null} map={map} />
    </div>
  );
}
