import { useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { newId, saveRecord, useRecord } from '../../db/records';
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

/** Shown on each trip page (Phase 2 places it): import, map, routes, pins, export, offline. */
export function TripTrailsSection({ tripId }: { tripId: string }) {
  const trip = useRecord('trip', tripId);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [dropAt, setDropAt] = useState<{ lng: number; lat: number } | null>(null);

  const tripLocation = trip.data?.location ? { lat: trip.data.location.lat, lng: trip.data.location.lng } : null;
  const center: [number, number] | undefined = tripLocation ? [tripLocation.lng, tripLocation.lat] : undefined;

  return (
    <div className="space-y-4">
      <Card title="Trails & routes">
        <p className="text-sm text-ink-2">{MVUM_LEGAL_NOTE} Tap the map to drop a pin.</p>
      </Card>

      <TrailsMap tripId={tripId} center={center} onReady={setMap} onMapClick={setDropAt} />

      {dropAt && <NewPinForm tripId={tripId} lngLat={dropAt} onDone={() => setDropAt(null)} />}

      <ImportPanel tripId={tripId} />
      <RoutesPanel tripId={tripId} />
      <PinsPanel tripId={tripId} />
      <ExportPanel tripId={tripId} />
      <OfflinePanel tripId={tripId} map={map} tripLocation={tripLocation} />
    </div>
  );
}
