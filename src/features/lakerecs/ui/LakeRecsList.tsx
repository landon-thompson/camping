import { useCallback, useMemo, useState } from 'react';
import { Button } from '../../../components/ui';
import { FishIcon } from '../../fishing/FishIcon';
import { speciesName } from '../../fishing/lakeSurvey';
import type { LakeRec, RankMode } from '../types';
import { useLakeModelStatus, useLakeRecs } from './engine';
import { CONFIDENCE, DEFAULT_SPECIES, driveText, miles, MODES, readPrefs, writePrefs, type RecPrefs } from './format';
import { LakeRecDetail } from './LakeRecDetail';
import { ModelStatusLine } from './ModelStatusLine';
import { RangeBar } from './RangeBar';
import { useOnline } from './useOnline';

const SHOW = 8;
const shortName = (code: string) => speciesName(code).replace(/^Northern p/, 'P').replace(/ \(.*\)$/, '');

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${on ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
    >
      {children}
    </button>
  );
}

/**
 * Species chips, ranking mode, the ranked lakes and the model status line,
 * for one campsite. Shared by the trip's "Best lakes" card and Tools › Fishing.
 */
export function LakeRecsList({
  origin,
  startDate,
  endDate,
  towing,
  tripId,
  prefsKey,
}: {
  origin: { lat: number; lng: number; label: string };
  startDate: string | null;
  endDate: string | null;
  towing: boolean;
  tripId: string | null;
  /** localStorage key for this campsite's species + mode. */
  prefsKey: string;
}) {
  const species = DEFAULT_SPECIES;
  const [prefs, setPrefsState] = useState<RecPrefs>(() => readPrefs(prefsKey, species, { species: species[0], mode: 'expected' }));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const online = useOnline();
  const model = useLakeModelStatus();

  const setPrefs = (p: Partial<RecPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    writePrefs(prefsKey, next);
  };

  const ctx = useMemo(
    () => ({ origin: { lat: origin.lat, lng: origin.lng }, species: prefs.species, mode: prefs.mode, startDate, endDate, towing }),
    [origin.lat, origin.lng, prefs.species, prefs.mode, startDate, endDate, towing],
  );
  const { loading, result, status, download, rollAgain } = useLakeRecs(ctx);
  const recs = result?.recs ?? [];
  const shown = showAll ? recs : recs.slice(0, SHOW);
  const open = recs.find((r) => r.lake.key === openKey) ?? null;
  const close = useCallback(() => setOpenKey(null), []);
  const fish = speciesName(prefs.species).toLowerCase();
  const mode = MODES.find((m) => m.key === prefs.mode)!;

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Species">
        {species.map((s) => (
          <Chip key={s} on={prefs.species === s} onClick={() => setPrefs({ species: s })} label={speciesName(s)}>
            <FishIcon species={s} size={28} />
            <span aria-hidden>{shortName(s)}</span>
          </Chip>
        ))}
      </div>

      <div role="group" aria-label="How to rank" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={prefs.mode === m.key}
            onClick={() => setPrefs({ mode: m.key as RankMode })}
            className={`min-h-11 flex-auto rounded-lg px-1 text-sm font-semibold leading-tight ${prefs.mode === m.key ? 'bg-brand text-brand-ink' : 'text-ink'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-2">{mode.hint}</p>
        {prefs.mode === 'adventurous' && recs.length > 1 && (
          <Button type="button" variant="secondary" className="min-h-11" onClick={rollAgain}>
            Roll again
          </Button>
        )}
      </div>

      {loading && !result && (
        <p role="status" className="text-sm text-ink-2">
          Ranking lakes…
        </p>
      )}

      {recs.length > 0 && (
        <ol className="divide-y divide-line" aria-label={`Best lakes for ${fish}`}>
          {shown.map((r) => (
            <RecRow key={r.lake.key} rec={r} onOpen={() => setOpenKey(r.lake.key)} />
          ))}
        </ol>
      )}
      {recs.length > SHOW && (
        <Button type="button" variant="ghost" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${recs.length} lakes`}
        </Button>
      )}

      {result && !recs.length && !result.missingTiles.length && (
        <p className="text-sm text-ink-2">No lakes with a {fish} estimate and a usable launch within 25 miles.</p>
      )}
      {result && !recs.length && result.missingTiles.length > 0 && (
        <p className="text-sm text-ink-2">The lakes for this area aren’t on this phone yet.</p>
      )}

      {result && result.excluded.length > 0 && (
        <details className="text-sm text-ink-2">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">
            {result.excluded.length} lake{result.excluded.length === 1 ? '' : 's'} left out
          </summary>
          <ul className="divide-y divide-line">
            {result.excluded.map((x) => (
              <li key={`${x.name}-${x.why}`} className="flex justify-between gap-3 py-1.5">
                <span className="text-ink">{x.name}</span>
                <span className="text-right">{x.why}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ModelStatusLine
        status={model.state === 'updating' || model.state === 'loading' ? model : status}
        missingTiles={result?.missingTiles.length ?? 0}
        online={online}
        onDownload={download}
        onUpdate={model.update}
        downloadLabel={tripId ? 'Download lakes for this trip' : 'Download lakes for this area'}
      />

      {open && (
        <LakeRecDetail rec={open} species={prefs.species} speciesOptions={species} origin={origin} tripId={tripId} onClose={close} />
      )}
    </div>
  );
}

function RecRow({ rec, onOpen }: { rec: LakeRec; onOpen: () => void }) {
  const conf = CONFIDENCE[rec.confidence];
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 py-3 text-left" aria-label={`Number ${rec.rank}: ${rec.lake.name}. Open details`}>
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink">
          {rec.rank}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block font-semibold">{rec.lake.name}</span>
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-sm text-ink-2">
              {driveText(rec.driveMin)} · {miles(rec.distanceKm)}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${conf.cls}`}>{conf.label}</span>
          </span>
          <RangeBar range={rec.range} compact />
          {rec.reasons[0] && <span className="block text-sm">{rec.reasons[0]}</span>}
        </span>
        <span aria-hidden className="self-center text-xl text-ink-2">
          ›
        </span>
      </button>
    </li>
  );
}
