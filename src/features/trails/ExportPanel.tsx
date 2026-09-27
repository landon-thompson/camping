import { useState } from 'react';
import { Button, Card } from '../../components/ui';
import { useRecords } from '../../db/records';
import { downloadGpx, buildGpxDocument, gpxFileName } from './gpxExport';

/** Export selected routes + pins to GPX, for re-import into onX Offroad (or Gaia). */
export function ExportPanel({ tripId }: { tripId: string | null }) {
  const { rows: routeRows } = useRecords('route');
  const { rows: pinRows } = useRecords('pin');
  const { rows: trips } = useRecords('trip');
  const routes = routeRows.filter((r) => (tripId ? r.data.tripId === tripId : true));
  const pins = pinRows.filter((p) => (tripId ? p.data.tripId === tripId : true));
  const tripName = (id: string | null) => (id ? (trips.find((t) => t.id === id)?.data.name ?? 'Unknown trip') : 'no trip yet');

  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedRoutes = routes.filter((r) => !excluded.has(r.id));
  const selectedPins = pins.filter((p) => !excluded.has(p.id));

  function exportSelected() {
    const xml = buildGpxDocument(
      selectedRoutes.map((r) => r.data),
      selectedPins.map((p) => p.data),
    );
    downloadGpx(xml, gpxFileName());
  }

  if (routes.length === 0 && pins.length === 0) {
    return (
      <Card title="Export to onX">
        <p className="text-sm text-ink-2">Nothing to export yet.</p>
      </Card>
    );
  }

  return (
    <Card title="Export to onX">
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          Exports a single .gpx file for onX Offroad (app or web map) or Gaia GPS. Uncheck anything you don't want to include.
        </p>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {routes.map((r) => (
            <li key={r.id}>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="h-6 w-6 shrink-0" checked={!excluded.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="text-sm">
                  {r.data.name}{' '}
                  <span className="text-ink-2">
                    ({r.data.distanceMi.toFixed(1)} mi · {tripName(r.data.tripId)})
                  </span>
                </span>
              </label>
            </li>
          ))}
          {pins.map((p) => (
            <li key={p.id}>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="h-6 w-6 shrink-0" checked={!excluded.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="text-sm">
                  {p.data.name || 'Unnamed pin'} <span className="text-ink-2">({tripName(p.data.tripId)})</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <Button onClick={exportSelected} disabled={selectedRoutes.length === 0 && selectedPins.length === 0}>
          Export {selectedRoutes.length + selectedPins.length} item(s) as GPX
        </Button>
      </div>
    </Card>
  );
}
