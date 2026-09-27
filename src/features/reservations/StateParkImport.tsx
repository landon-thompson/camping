import { useState } from 'react';
import { Button, Card } from '../../components/ui';
import { saveRecord } from '../../db/records';
import { useCampgrounds } from './data';
import {
  fetchParksFromService,
  viaAppServer,
  MN_PARKS_DATASET_URL,
  parseParksDetailed,
  planImport,
  REGION_NAME,
  SD_PARKS_DATASET_URL,
  type ParkPoint,
  type ParkRegion,
  type ParseResult,
  type SourceReport,
} from './stateParks';

/** Load every Minnesota or South Dakota state park / recreation area (name + map pin) from official GIS data. */
export function StateParkImport() {
  const campgrounds = useCampgrounds();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFile, setShowFile] = useState(false);
  const [reports, setReports] = useState<SourceReport[]>([]);
  const [region, setRegion] = useState<ParkRegion>('mn');

  function explainEmpty(r: ParseResult, where: string) {
    setError(
      `${where} sent ${r.featureCount} map areas, but none could be read as a ${REGION_NAME[region]} state park. ` +
        `Fields: ${r.sampleFields.join(', ') || 'none'}. Please send a screenshot of this message.`,
    );
  }

  async function apply(parks: ParkPoint[], source: string) {
    const plan = planImport(parks, campgrounds.rows, source, region);
    for (const r of [...plan.add, ...plan.fill]) await saveRecord('campground', r.id, r.data);
    setStatus(
      `Found ${parks.length} parks: added ${plan.add.length}, updated ${plan.fill.length} (location or park page)` +
        (parks.length - plan.add.length - plan.fill.length > 0 ? `, ${parks.length - plan.add.length - plan.fill.length} already up to date.` : '.'),
    );
  }

  async function auto() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await fetchParksFromService(viaAppServer, region);
      setReports(r.reports);
      if (r.parks.length === 0) {
        explainEmpty(r, `The state map service (layer “${r.layerName}”)`);
        setShowFile(true);
        return;
      }
      await apply(r.parks, r.source);
    } catch (e) {
      setReports((e as { reports?: SourceReport[] }).reports ?? []);
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
      const r = parseParksDetailed(JSON.parse(await file.text()), false, region);
      if (r.parks.length === 0) return explainEmpty(r, 'That file');
      await apply(r.parks, `File: ${file.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that file.');
    }
  }

  return (
    <Card title="State parks">
      <p className="text-ink-2">
        Load every state park and recreation area, with a map pin, from official park data. Parks already in the directory keep their details and
        just get a location if they’re missing one.
      </p>
      <div role="group" aria-label="State" className="mt-3 grid grid-cols-2 gap-2">
        {(['mn', 'sd'] as const).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={region === r}
            onClick={() => {
              setRegion(r);
              setReports([]);
              setStatus(null);
              setError(null);
            }}
            className={`min-h-11 rounded-full border text-sm font-semibold ${region === r ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
          >
            {REGION_NAME[r]}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void auto()}>
          {busy ? 'Loading…' : `Import ${REGION_NAME[region]} parks`}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowFile((v) => !v)} aria-expanded={showFile}>
          From a file
        </Button>
      </div>
      {showFile && (
        <div className="mt-3 space-y-2 text-sm text-ink-2">
          <p>
            1. Open the{' '}
            <a href={region === 'sd' ? SD_PARKS_DATASET_URL : MN_PARKS_DATASET_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
              {region === 'sd' ? 'South Dakota open data (Parks and Recreation Areas)' : 'Minnesota Geospatial Commons'}
            </a>{' '}
            {region === 'sd' ? 'dataset page.' : 'and find the DNR dataset of state park, recreation area and wayside boundaries.'}
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
      {reports.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-ink-2">
          {reports.map((r) => (
            <li key={r.source}>
              <strong>{r.label}:</strong> {r.outcome}
            </li>
          ))}
        </ul>
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
