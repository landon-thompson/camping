import { useEffect, useRef, useState } from 'react';
import { saveRecord, useRecord } from '../../db/records';
import { Button } from '../../components/ui';
import type { FishCatch } from '../../model/schemas';
import { viaAppServer } from '../reservations/stateParks';
import { catchShares, fetchLakeSurvey, groupByGear, isGameFish, lakeFinderPage, rate, speciesName, type Rating } from './lakeSurvey';

// Distinct hues that read on both the day and night themes.
const PALETTE = ['#2f7d4f', '#d08a2e', '#3f6fb5', '#b84a3a', '#7a5bb0', '#2a9a9a', '#9a8f3a'];

const RATING: Record<Exclude<Rating, null>, { text: string; cls: string }> = {
  below: { text: 'Below typical', cls: 'bg-warn-bg text-warn' },
  typical: { text: 'Typical', cls: 'bg-surface-2 text-ink-2' },
  above: { text: 'Above typical', cls: 'bg-ok/15 text-ok' },
};

const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : d || 'date unknown');
const one = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

/** DNR fish survey for one lake: share of the catch, then fish per net by species, compared with similar lakes. */
export function LakeFishing({ dow, name }: { dow: string; name: string }) {
  const id = `lake_survey:${dow}`;
  const cached = useRecord('lake_survey', id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surveyIdx, setSurveyIdx] = useState(0);
  const tried = useRef(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const s = await fetchLakeSurvey(dow, viaAppServer);
      await saveRecord('lake_survey', id, s);
      setSurveyIdx(0);
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

  const survey = cached.data;
  const withCatch = survey?.surveys.filter((s) => s.catches.length) ?? [];
  const current = withCatch[Math.min(surveyIdx, withCatch.length - 1)];
  const lakeName = survey?.lakeName ?? name;

  return (
    <article className="space-y-3 rounded-xl border border-line p-3" aria-label={`Fishing on ${lakeName}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">{lakeName}</h3>
          <p className="text-sm text-ink-2">
            DNR lake {dow.replace(/^(\d{2})(\d{4})(\d{2})$/, '$1-$2-$3')}
            {current && ` · surveyed ${fmtDate(current.date)}${current.type ? ` (${current.type})` : ''}`}
          </p>
        </div>
        <a href={lakeFinderPage(dow)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-brand underline">
          LakeFinder ↗
        </a>
      </header>

      {busy && <p role="status" className="text-sm text-ink-2">Loading the DNR fish survey…</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-warn-bg p-2 text-sm text-warn">
          Couldn’t load the survey: {error}. Open LakeFinder for this lake, or try again.
        </p>
      )}
      {!busy && survey && !current && <p className="text-sm text-ink-2">The DNR has no net survey results for this lake.</p>}
      {!busy && !survey && !error && !navigator.onLine && <p className="text-sm text-ink-2">Offline — connect once to load this lake’s survey; it’s then kept on the phone.</p>}

      {current && (
        <>
          {withCatch.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-ink-2">Survey</span>
              <select className="min-h-11 w-full rounded-xl border border-line bg-surface px-3" value={surveyIdx} onChange={(e) => setSurveyIdx(Number(e.target.value))}>
                {withCatch.map((s, i) => (
                  <option key={`${s.date}-${i}`} value={i}>
                    {fmtDate(s.date)}
                    {s.type ? ` — ${s.type}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {Number(current.date.slice(0, 4)) < new Date().getFullYear() - 6 && (
            <p className="text-sm text-warn">This survey is several years old; fish populations change.</p>
          )}
          <CatchShareBar catches={current.catches} />
          <GearBreakdown catches={current.catches} />
          <p className="text-xs text-ink-2">
            Nets sample fish differently: gill nets catch walleye, pike, perch and cisco well; trap nets catch sunfish, crappie and bullheads. Compare a
            species within one kind of net. “Typical” is the DNR’s middle range for similar lakes. Source: MN DNR LakeFinder
            {survey && `, fetched ${new Date(survey.fetchedAt).toLocaleDateString()}`}.
          </p>
        </>
      )}

      <Button type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
        {survey ? 'Refresh survey' : 'Load survey'}
      </Button>
    </article>
  );
}

function CatchShareBar({ catches }: { catches: FishCatch[] }) {
  const shares = catchShares(catches);
  if (!shares.length) return null;
  const top = shares.slice(0, 6);
  const otherPct = shares.slice(6).reduce((a, s) => a + s.pct, 0);
  const parts = [...top.map((s, i) => ({ label: speciesName(s.species), pct: s.pct, color: PALETTE[i % PALETTE.length]! })), ...(otherPct > 0 ? [{ label: 'Other', pct: otherPct, color: '#8a8f8a' }] : [])];
  const total = shares.reduce((a, s) => a + s.count, 0);
  return (
    <section aria-label="Share of fish caught">
      <h4 className="text-sm font-semibold text-ink-2">What the survey nets caught ({total.toLocaleString()} fish)</h4>
      <div className="mt-1 flex h-6 w-full overflow-hidden rounded-full border border-line" aria-hidden>
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${p.pct}%`, background: p.color }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span>{p.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{p.pct < 1 ? '<1' : Math.round(p.pct)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GearBreakdown({ catches }: { catches: FishCatch[] }) {
  return (
    <>
      {groupByGear(catches).map((g) => (
        <section key={g.family} aria-label={`${g.family}: ${g.unit}`}>
          <h4 className="text-sm font-semibold text-ink-2">
            {g.family} — {g.unit}
            {g.netCount ? ` (${g.netCount} ${g.family === 'Electrofishing' ? 'runs' : g.netCount === 1 ? 'net' : 'nets'})` : ''}
          </h4>
          <ul className="mt-1 space-y-2">
            {g.rows.map((r) => {
              const rating = rate(r);
              const w = g.maxCpue > 0 && r.cpue !== null ? Math.max(2, (r.cpue / g.maxCpue) * 100) : 0;
              const hiMark = g.maxCpue > 0 && r.normalHigh !== null ? Math.min(100, (r.normalHigh / g.maxCpue) * 100) : null;
              const loMark = g.maxCpue > 0 && r.normalLow !== null ? Math.min(100, (r.normalLow / g.maxCpue) * 100) : null;
              return (
                <li key={`${r.species}-${r.gear}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                    <span className={`font-semibold ${isGameFish(r.species) ? '' : 'text-ink-2'}`}>{speciesName(r.species)}</span>
                    <span className="tabular-nums">
                      {r.cpue === null ? '—' : one(r.cpue)}
                      {r.avgWeightLb ? <span className="text-ink-2"> · {r.avgWeightLb.toFixed(1)} lb avg</span> : null}
                    </span>
                  </div>
                  <div className="relative mt-0.5 h-3 rounded-full bg-surface-2" aria-hidden>
                    {loMark !== null && hiMark !== null && (
                      <span className="absolute inset-y-0 rounded-full border border-dashed border-ink-2/60" style={{ left: `${loMark}%`, width: `${Math.max(1, hiMark - loMark)}%` }} />
                    )}
                    <span className={`absolute inset-y-0 left-0 rounded-full ${isGameFish(r.species) ? 'bg-brand' : 'bg-ink-2/50'}`} style={{ width: `${w}%` }} />
                  </div>
                  {rating && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${RATING[rating].cls}`}>{RATING[rating].text}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="text-xs text-ink-2">Dashed outline = the DNR’s typical range for similar lakes.</p>
    </>
  );
}

