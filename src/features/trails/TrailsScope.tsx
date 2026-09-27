import { useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { newId, saveRecord, useRecords } from '../../db/records';
import type { PinKind } from '../../model/trails';
import { ExportPanel } from './ExportPanel';
import { ImportPanel } from './ImportPanel';
import { KIND_LABEL } from './PinsPanel';
import { MVUM_LEGAL_NOTE } from './mvum';
import { OfflinePanel } from './OfflinePanel';
import { PinsPanel } from './PinsPanel';
import { RoutesPanel } from './RoutesPanel';
import { TrailsMap } from './TrailsMap';

function NewPinForm({ tripId, lngLat, onDone }: { tripId: string | null; lngLat: { lng: number; lat: number }; onDone: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PinKind>('dispersed');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await saveRecord('pin', newId('pin'), {
        tripId,
        kind,
        name: name.trim() || KIND_LABEL[kind],
        position: { lat: lngLat.lat, lng: lngLat.lng },
        notes,
        photoIds: [],
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="New pin">
      <div className="space-y-3">
        <p className="text-xs text-ink-2">
          {lngLat.lat.toFixed(5)}, {lngLat.lng.toFixed(5)}
        </p>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={KIND_LABEL[kind]} />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as PinKind)} className={inputClass}>
            {(Object.keys(KIND_LABEL) as PinKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} min-h-20`} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save pin'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

export interface TrailsScopeProps {
  /** Trip to scope routes/pins/export/offline to, or null for the full library (`/trails`). */
  tripId: string | null;
  tripLocation?: { lat: number; lng: number } | null;
  /** Initial map zoom — the library map starts further out than a single trip's. */
  mapZoom?: number;
}

/**
 * Shared layout for the trip page's Trails tab and the `/trails` library page:
 * map, import, routes/pins (or one empty state), export, offline. Keeping
 * this in one place means the two screens can't drift apart (see PROGRESS.md).
 */
export function TrailsScope({ tripId, tripLocation, mapZoom }: TrailsScopeProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [dropAt, setDropAt] = useState<{ lng: number; lat: number } | null>(null);
  const { rows: routeRows } = useRecords('route');
  const { rows: pinRows } = useRecords('pin');
  const hasRoutes = routeRows.some((r) => (tripId ? r.data.tripId === tripId : true));
  const hasPins = pinRows.some((p) => (tripId ? p.data.tripId === tripId : true));

  const center: [number, number] | undefined = tripLocation ? [tripLocation.lng, tripLocation.lat] : undefined;

  return (
    <div className="space-y-4">
      <TrailsMap tripId={tripId} center={center} zoom={mapZoom} onReady={setMap} onMapClick={setDropAt} />
      <p className="text-sm text-ink-2">{MVUM_LEGAL_NOTE} Tap the map to drop a pin.</p>

      {dropAt && <NewPinForm tripId={tripId} lngLat={dropAt} onDone={() => setDropAt(null)} />}

      <ImportPanel tripId={tripId} />

      {!hasRoutes && !hasPins ? (
        <Card title="Routes & pins">
          <p className="text-sm text-ink-2">Nothing here yet — import a GPX/KML file above, or tap the map to drop a pin.</p>
        </Card>
      ) : (
        <>
          <RoutesPanel tripId={tripId} />
          <PinsPanel tripId={tripId} />
          <ExportPanel tripId={tripId} />
        </>
      )}

      <OfflinePanel tripId={tripId} map={map} tripLocation={tripLocation} />
    </div>
  );
}
