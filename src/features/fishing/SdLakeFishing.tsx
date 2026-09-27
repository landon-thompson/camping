import { useEffect, useRef, useState } from 'react';
import { saveRecord, useRecord } from '../../db/records';
import { Button } from '../../components/ui';
import type { SdLakeReport } from '../../model/schemas';
import { FishIcon } from './FishIcon';
import { codeForName, isGameFish } from './lakeSurvey';
import { SD_FISHERY_REPORTS } from './lakeList';
import { fetchSdReport, sdReportId } from './sdReport';

const one = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));
const GEAR_ORDER = ['Gill nets', 'Frame nets', 'Electrofishing', 'Other'];

/** A South Dakota lake's newest GFP survey summary: what the report says, and fish per net read from it. */
export function SdLakeFishing({ water }: { water: string }) {
  const id = sdReportId(water);
  const cached = useRecord('sd_lake_report', id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  async function load(reportId?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetchSdReport(water, reportId);
      await saveRecord('sd_lake_report', id, r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (cached.loading || cached.data || tried.current || !navigator.onLine) return;
    tried.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached.loading, cached.data]);

  const r = cached.data;
  return (
    <article className="space-y-4 rounded-xl border border-line p-3" aria-label={`Fishing on ${water}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{water}</h3>
          <p className="text-sm text-ink-2">
            South Dakota GFP lake survey{r?.year ? ` · ${r.year}` : ''}
          </p>
        </div>
        {r?.url && (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-brand underline">
            Report PDF ↗
          </a>
        )}
      </header>

      {busy && <p role="status" className="text-sm text-ink-2">Reading the GFP survey report…</p>}
      {error && !r && (
        <p role="alert" className="rounded-lg bg-warn-bg p-2 text-sm text-warn">
          Couldn’t load the survey: {error.replace(/\.+$/, '')}.{' '}
          <a href={SD_FISHERY_REPORTS} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            Open GFP Fishery Reports
          </a>
          .
        </p>
      )}
      {!busy && !r && !error && !navigator.onLine && <p className="text-sm text-ink-2">Offline — connect once to load this lake’s report; it’s then kept on the phone.</p>}

      {r && <ReportBody r={r} onPick={(rid) => void load(rid)} busy={busy} />}

      <Button type="button" variant="secondary" disabled={busy} onClick={() => void load(r?.reportId || undefined)}>
        {r ? 'Refresh report' : 'Load report'}
      </Button>
    </article>
  );
}

function ReportBody({ r, onPick, busy }: { r: SdLakeReport; onPick: (reportId: string) => void; busy: boolean }) {
  const byGear = new Map<string, SdLakeReport['catches']>();
  for (const c of r.catches) byGear.set(c.gear, [...(byGear.get(c.gear) ?? []), c]);
  const gears = [...byGear.keys()].sort((a, b) => (GEAR_ORDER.indexOf(a) + 1 || 9) - (GEAR_ORDER.indexOf(b) + 1 || 9));
  const fromSummaryOnly = r.catches.length > 0 && r.catches.every((c) => c.from === 'summary');

  return (
    <>
      {r.surveys.length > 1 && (
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Report</span>
          <select
            className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
            value={r.reportId}
            disabled={busy}
            onChange={(e) => onPick(e.target.value)}
          >
            {r.surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.text || `Report ${s.id}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {r.year && r.year < new Date().getFullYear() - 6 && <p className="text-sm text-warn">This survey is several years old; fish populations change.</p>}

      {r.summary.length > 0 && (
        <section aria-label="What the survey found">
          <h4 className="text-sm font-semibold text-ink-2">What the survey found</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {r.summary.slice(0, 6).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {gears.map((g) => {
        const rows = byGear.get(g)!.slice().sort((a, b) => b.cpue - a.cpue);
        const max = Math.max(...rows.map((x) => x.cpue), 0.001);
        return (
          <section key={g} aria-label={`${g}: fish per net`}>
            <h4 className="text-sm font-semibold text-ink-2">
              {g} — fish per {g === 'Electrofishing' ? 'hour' : 'net'}
            </h4>
            <ul className="mt-1 space-y-2">
              {rows.map((c) => {
                const code = codeForName(c.species);
                return (
                  <li key={`${c.species}-${c.gear}`} className="flex items-center gap-2 rounded-xl bg-surface-2/60 p-2">
                    <FishIcon species={code || c.species} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                        <span className={`font-semibold ${!code || isGameFish(code) ? '' : 'text-ink-2'}`}>{c.species}</span>
                        <span className="tabular-nums">{one(c.cpue)} per net</span>
                      </div>
                      <div className="mt-1 h-3 rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (c.cpue / max) * 100)}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!r.catches.length && (
        <p className="text-sm text-ink-2">The app couldn’t read catch numbers from this report’s layout — open the report PDF for the tables.</p>
      )}

      <p className="text-xs text-ink-2">
        Read automatically from the official GFP report{fromSummaryOnly ? ' (from its summary text)' : ''}; check the PDF before relying on a number. South
        Dakota reports don’t give a “similar lakes” range, so there’s no fewer/typical/more rating here — bars compare species within one kind of net.
        {r.listUrl && (
          <>
            {' '}
            <a href={r.listUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
              All reports for this lake ↗
            </a>
          </>
        )}
      </p>
    </>
  );
}
