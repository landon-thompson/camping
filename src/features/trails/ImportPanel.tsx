import { useId, useState } from 'react';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { newId, saveRecord } from '../../db/records';
import type { Route } from '../../model/trails';
import { DEFAULT_AVG_MPH, estimateDriveTimeMin } from './geo';
import { importFiles } from './gpxKml';
import type { PinDraft, RouteDraft } from './import';

type Source = Route['source'];

interface PendingRoute extends RouteDraft {
  key: string;
  fileName: string;
  include: boolean;
}
interface PendingPin extends PinDraft {
  key: string;
  fileName: string;
  include: boolean;
}
interface PendingIssue {
  fileName: string;
  message: string;
}

let draftCounter = 0;
function nextKey(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
}

export function ImportPanel({ tripId }: { tripId: string | null }) {
  const inputId = useId();
  const [source, setSource] = useState<Source>('onx');
  const [avgMph, setAvgMph] = useState(DEFAULT_AVG_MPH);
  const [routes, setRoutes] = useState<PendingRoute[]>([]);
  const [pins, setPins] = useState<PendingPin[]>([]);
  const [issues, setIssues] = useState<PendingIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function onFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setSaved(null);
    try {
      const outcomes = await importFiles(fileList, { avgMph });
      const newRoutes: PendingRoute[] = [];
      const newPins: PendingPin[] = [];
      const newIssues: PendingIssue[] = [];
      for (const outcome of outcomes) {
        for (const r of outcome.routes) newRoutes.push({ ...r, key: nextKey(), fileName: outcome.fileName, include: true });
        for (const p of outcome.pins) newPins.push({ ...p, key: nextKey(), fileName: outcome.fileName, include: true });
        for (const i of outcome.issues) newIssues.push({ fileName: outcome.fileName, message: i.message });
      }
      setRoutes((prev) => [...prev, ...newRoutes]);
      setPins((prev) => [...prev, ...newPins]);
      setIssues((prev) => [...prev, ...newIssues]);
    } finally {
      setBusy(false);
    }
  }

  function updateRouteName(key: string, name: string) {
    setRoutes((prev) => prev.map((r) => (r.key === key ? { ...r, name } : r)));
  }
  function updatePinName(key: string, name: string) {
    setPins((prev) => prev.map((p) => (p.key === key ? { ...p, name } : p)));
  }
  function toggleRoute(key: string) {
    setRoutes((prev) => prev.map((r) => (r.key === key ? { ...r, include: !r.include } : r)));
  }
  function togglePin(key: string) {
    setPins((prev) => prev.map((p) => (p.key === key ? { ...p, include: !p.include } : p)));
  }

  const includedRoutes = routes.filter((r) => r.include);
  const includedPins = pins.filter((p) => p.include);

  async function saveAll() {
    setBusy(true);
    try {
      for (const r of includedRoutes) {
        const data: Route = {
          tripId,
          name: r.name.trim() || 'Imported route',
          source,
          geometry: r.geometry,
          distanceMi: r.distanceMi,
          estDriveMin: estimateDriveTimeMin(r.distanceMi, avgMph),
          flags: { noTrailer: false, fourWd: false, seasonalMud: false },
          difficulty: null,
          notes: '',
        };
        await saveRecord('route', newId('route'), data);
      }
      for (const p of includedPins) {
        await saveRecord('pin', newId('pin'), {
          tripId,
          kind: 'other',
          name: p.name.trim() || 'Imported point',
          position: p.position,
          notes: '',
          photoIds: [],
        });
      }
      setSaved(`Saved ${includedRoutes.length} route${includedRoutes.length === 1 ? '' : 's'} and ${includedPins.length} pin${includedPins.length === 1 ? '' : 's'}.`);
      setRoutes([]);
      setPins([]);
      setIssues([]);
    } finally {
      setBusy(false);
    }
  }

  const hasPending = routes.length > 0 || pins.length > 0 || issues.length > 0;

  return (
    <Card title="Import GPX / KML">
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          From onX Offroad: the onX app exports <strong>GPX only</strong>; the onX web map can export GPX or KML (roughly 3,000
          markups / 4 MB per file — verify current limits on onX's own help pages). Only your own exported files are used here —
          nothing is scraped from onX or Gaia.
        </p>

        <Field label="Source" hint="Where these files came from.">
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} className={inputClass}>
            <option value="onx">onX Offroad</option>
            <option value="gaia">Gaia GPS</option>
            <option value="other">Other</option>
          </select>
        </Field>

        <Field label="Average forest-road speed (mph)" hint="Used only to estimate drive time — an estimate, not a fact.">
          <input
            type="number"
            min={1}
            max={60}
            value={avgMph}
            onChange={(e) => setAvgMph(Number(e.target.value) || DEFAULT_AVG_MPH)}
            className={inputClass}
          />
        </Field>

        <Field label="Files" hint=".gpx or .kml, multiple at once">
          <input
            id={inputId}
            type="file"
            multiple
            accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
            onChange={(e) => {
              void onFilesChosen(e.target.files);
              e.target.value = '';
            }}
            disabled={busy}
            className="block min-h-12 w-full rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:font-semibold file:text-brand-ink"
          />
        </Field>

        {saved && <p className="rounded-xl bg-info-bg px-3 py-2 text-sm text-info">{saved}</p>}

        {issues.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">
            {issues.map((i, idx) => (
              <li key={`${i.fileName}-${idx}`}>
                <strong>{i.fileName}:</strong> {i.message}
              </li>
            ))}
          </ul>
        )}

        {routes.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink-2">Routes to save ({includedRoutes.length} of {routes.length})</h3>
            {routes.map((r) => (
              <div key={r.key} className="flex items-center gap-2 rounded-xl border border-line p-2">
                <input
                  type="checkbox"
                  className="h-11 w-11 shrink-0"
                  checked={r.include}
                  onChange={() => toggleRoute(r.key)}
                  aria-label={`Include ${r.name}`}
                />
                <div className="min-w-0 flex-1">
                  <input value={r.name} onChange={(e) => updateRouteName(r.key, e.target.value)} className={inputClass} />
                  <p className="mt-1 text-xs text-ink-2">
                    {r.distanceMi.toFixed(1)} mi · ~{estimateDriveTimeMin(r.distanceMi, avgMph) ?? '—'} min · {r.keptPoints} of{' '}
                    {r.originalPoints} points kept · from {r.fileName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {pins.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink-2">Pins to save ({includedPins.length} of {pins.length})</h3>
            {pins.map((p) => (
              <div key={p.key} className="flex items-center gap-2 rounded-xl border border-line p-2">
                <input
                  type="checkbox"
                  className="h-11 w-11 shrink-0"
                  checked={p.include}
                  onChange={() => togglePin(p.key)}
                  aria-label={`Include ${p.name}`}
                />
                <div className="min-w-0 flex-1">
                  <input value={p.name} onChange={(e) => updatePinName(p.key, e.target.value)} className={inputClass} />
                  <p className="mt-1 text-xs text-ink-2">from {p.fileName} — kind can be set after saving</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasPending && (includedRoutes.length > 0 || includedPins.length > 0) && (
          <Button onClick={() => void saveAll()} disabled={busy}>
            {busy ? 'Saving…' : `Save ${includedRoutes.length + includedPins.length} item(s)`}
          </Button>
        )}
      </div>
    </Card>
  );
}
