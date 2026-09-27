import { useState } from 'react';
import { Button, Card } from '../../components/ui';
import { saveRecord } from '../../db/records';
import { useCampgrounds } from './data';
import { fetchParksFromService, MN_PARKS_DATASET_URL, MN_PARKS_SERVICE, parseParks, planImport, type ParkPoint } from './stateParks';

/** Load every Minnesota state park / recreation area (name + map pin) from official GIS data. */
export function StateParkImport() {
  const campgrounds = useCampgrounds();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFile, setShowFile] = useState(false);

  async function apply(parks: ParkPoint[], source: string) {
    const plan = planImport(parks, campgrounds.rows, source);
    for (const r of [...plan.add, ...plan.fill]) await saveRecord('campground', r.id, r.data);
    setStatus(
      `Found ${parks.length} parks: added ${plan.add.length}, filled in the location for ${plan.fill.length}` +
        (parks.length - plan.add.length - plan.fill.length > 0 ? `, ${parks.length - plan.add.length - plan.fill.length} already up to date.` : '.'),
    );
  }

  async function auto() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await apply(await fetchParksFromService(), MN_PARKS_SERVICE);
    } catch (e) {
      const why = e instanceof TypeError || !(e instanceof Error) ? 'Couldn’t reach the state map service.' : e.message;
      setError(`${why} Try the file option below.`);
      setShowFile(true);
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      await apply(parseParks(JSON.parse(await file.text())), `File: ${file.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that file.');
    }
  }

  return (
    <Card title="Minnesota state parks">
      <p className="text-ink-2">
        Load every state park and recreation area, with a map pin, from official park boundary data. Parks already in the
        directory keep their details and just get a location if they’re missing one.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void auto()}>
          {busy ? 'Loading…' : 'Import state parks'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowFile((v) => !v)} aria-expanded={showFile}>
          From a file
        </Button>
      </div>
      {showFile && (
        <div className="mt-3 space-y-2 text-sm text-ink-2">
          <p>
            1. Open the{' '}
            <a href={MN_PARKS_DATASET_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
              Minnesota Geospatial Commons
            </a>{' '}
            and find the DNR dataset of state park, recreation area and wayside boundaries.
            <br />
            2. Download it as <strong>GeoJSON</strong>. If it comes as a .zip, unzip it in the Files app.
            <br />
            3. Choose the .geojson or .json file here:
          </p>
          <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl border border-line bg-surface-2 px-4 font-semibold text-ink">
            Choose file
            <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="sr-only" onChange={(e) => void fromFile(e.target.files)} />
          </label>
        </div>
      )}
      <p role="status" className="mt-2 text-sm text-ok">
        {status ?? ''}
      </p>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </Card>
  );
}
