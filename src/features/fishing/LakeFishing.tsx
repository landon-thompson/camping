import { useEffect, useRef, useState } from 'react';
import { saveRecord, useRecord } from '../../db/records';
import { Button } from '../../components/ui';
import type { FishCatch } from '../../model/schemas';
import { viaAppServer } from '../reservations/stateParks';
import { FishIcon } from './FishIcon';
import {
  catchShares,
  fetchLakeSurveyOrWholeLake,
  formatDow,
  gaugePosition,
  groupByGear,
  howFarOutside,
  isGameFish,
  lakeFinderPage,
  rate,
  rateSize,
  speciesName,
  SURVEY_VERSION,
  type Rating,
} from './lakeSurvey';

// Distinct hues that read on both the day and night themes.
const PALETTE = ['#2f7d4f', '#d08a2e', '#3f6fb5', '#b84a3a', '#7a5bb0', '#2a9a9a', '#9a8f3a'];

type Metric = 'numbers' | 'size';

const VERDICT: Record<Metric, Record<Exclude<Rating, null>, { text: string; cls: string }>> = {
  numbers: {
    below: { text: 'Fewer than usual', cls: 'bg-warn-bg text-warn' },
    typical: { text: 'Typical numbers', cls: 'bg-surface-2 text-ink-2' },
    above: { text: 'More than usual', cls: 'bg-ok/15 text-ok' },
  },
  size: {
    below: { text: 'Smaller than usual', cls: 'bg-warn-bg text-warn' },
    typical: { text: 'Typical size', cls: 'bg-surface-2 text-ink-2' },
    above: { text: 'Bigger than usual', cls: 'bg-ok/15 text-ok' },
  },
};

const fmtDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : d || 'date unknown';
const one = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));
const lb = (n: number) => (n >= 10 ? `${n.toFixed(0)} lb` : `${n.toFixed(1)} lb`);

function readMetric(): Metric {
  try {
    return localStorage.getItem('fishMetric') === 'size' ? 'size' : 'numbers';
  } catch {
    return 'numbers';
  }
}

/** DNR fish survey for one lake: share of the catch, then numbers or size per species against similar lakes. */
export function LakeFishing({ dow, name }: { dow: string; name: string }) {
  const id = `lake_survey:${dow}`;
  const cached = useRecord('lake_survey', id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surveyIdx, setSurveyIdx] = useState(0);
  const [metric, setMetricState] = useState<Metric>(readMetric);
  const tried = useRef(false);

  const setMetric = (m: Metric) => {
    setMetricState(m);
    try {
      localStorage.setItem('fishMetric', m);
    } catch {
      /* per-phone preference only */
    }
  };

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const s = await fetchLakeSurveyOrWholeLake(dow, viaAppServer);
      await saveRecord('lake_survey', id, s);
      setSurveyIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (cached.loading || tried.current || !navigator.onLine) return;
    // Load once if missing; refresh a survey cached by an older version (it lacks the size ranges).
    if (cached.data && (cached.data.v ?? 1) >= SURVEY_VERSION) return;
    tried.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached.loading, cached.data]);

  const survey = cached.data;
  const withCatch = survey?.surveys.filter((s) => s.catches.length) ?? [];
  const current = withCatch[Math.min(surveyIdx, withCatch.length - 1)];
  const lakeName = survey?.lakeName ?? name;
  const wholeLake = survey && survey.dow !== dow;

  return (
    <article className="space-y-4 rounded-xl border border-line p-3" aria-label={`Fishing on ${lakeName}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{wholeLake ? name : lakeName}</h3>
          <p className="text-sm text-ink-2">
            DNR lake {formatDow(dow)}
            {wholeLake && ` · no survey of its own, showing the whole lake: ${lakeName} (${formatDow(survey.dow)})`}
            {current && ` · surveyed ${fmtDate(current.date)}${current.type ? ` (${current.type})` : ''}`}
          </p>
        </div>
        <a href={lakeFinderPage(survey?.dow ?? dow)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-brand underline">
          LakeFinder ↗
        </a>
      </header>

      {busy && <p role="status" className="text-sm text-ink-2">Loading the DNR fish survey…</p>}
      {error && !current && (
        <p role="alert" className="rounded-lg bg-warn-bg p-2 text-sm text-warn">
          Couldn’t load the survey. DNR answer — {error}. Open LakeFinder for this lake, or try again.
        </p>
      )}
      {!busy && survey && !current && <p className="text-sm text-ink-2">The DNR has no net survey results for this lake.</p>}
      {!busy && !survey && !error && !navigator.onLine && (
        <p className="text-sm text-ink-2">Offline — connect once to load this lake’s survey; it’s then kept on the phone.</p>
      )}

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

          <div role="group" aria-label="Compare by" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {(
              [
                ['numbers', 'Numbers', 'fish per net'],
                ['size', 'Size', 'average weight'],
              ] as const
            ).map(([m, label, sub]) => (
              <button
                key={m}
                type="button"
                aria-pressed={metric === m}
                onClick={() => setMetric(m)}
                className={`min-h-12 rounded-lg px-2 text-center ${metric === m ? 'bg-brand text-brand-ink' : 'text-ink'}`}
              >
                <span className="block font-semibold">{label}</span>
                <span className={`block text-xs ${metric === m ? '' : 'text-ink-2'}`}>{sub}</span>
              </button>
            ))}
          </div>

          {metric === 'numbers' ? <NumbersView catches={current.catches} /> : <SizeView catches={current.catches} />}
          <Explainer metric={metric} />
          <p className="text-xs text-ink-2">Source: MN DNR LakeFinder{survey && `, fetched ${new Date(survey.fetchedAt).toLocaleDateString()}`}.</p>
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
  const parts = [
    ...top.map((s, i) => ({ code: s.species, label: speciesName(s.species), pct: s.pct, color: PALETTE[i % PALETTE.length]! })),
    ...(otherPct > 0 ? [{ code: '', label: 'Other', pct: otherPct, color: '#8a8f8a' }] : []),
  ];
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
            {p.code ? <FishIcon species={p.code} size={28} /> : <span className="w-7" />}
            <span>{p.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{p.pct < 1 ? '<1' : Math.round(p.pct)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Three fixed zones (fewer · typical · more) with a marker for this lake. */
function Gauge({ value, lo, hi, metric }: { value: number; lo: number; hi: number; metric: Metric }) {
  const pos = gaugePosition(value, lo, hi);
  const words = metric === 'numbers' ? ['Fewer', 'Typical', 'More'] : ['Smaller', 'Typical', 'Bigger'];
  return (
    <div aria-hidden className="mt-1">
      <div className="relative h-4">
        <div className="absolute inset-y-0 left-0 flex w-full overflow-hidden rounded-full border border-line">
          <span className="h-full bg-warn-bg" style={{ width: '33%' }} />
          <span className="h-full border-x border-line bg-surface-2" style={{ width: '34%' }} />
          <span className="h-full bg-ok/20" style={{ width: '33%' }} />
        </div>
        <span
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow"
          style={{ left: `${Math.min(97, Math.max(3, pos))}%` }}
        />
      </div>
      <div className="mt-0.5 grid grid-cols-[33%_34%_33%] text-[11px] text-ink-2">
        <span>{words[0]}</span>
        <span className="text-center">
          {words[1]} {metric === 'numbers' ? `${one(lo)}–${one(hi)}` : `${lo.toFixed(1)}–${hi.toFixed(1)} lb`}
        </span>
        <span className="text-right">{words[2]}</span>
      </div>
    </div>
  );
}

function SpeciesRow({ c, metric }: { c: FishCatch; metric: Metric }) {
  const value = metric === 'numbers' ? c.cpue : c.avgWeightLb;
  const lo = metric === 'numbers' ? c.normalLow : (c.normalWeightLow ?? null);
  const hi = metric === 'numbers' ? c.normalHigh : (c.normalWeightHigh ?? null);
  const rating = metric === 'numbers' ? rate(c) : rateSize(c);
  const outside = value !== null && lo !== null && hi !== null ? howFarOutside(value, lo, hi) : null;
  return (
    <li className="rounded-xl bg-surface-2/60 p-2">
      <div className="flex items-center gap-2">
        <FishIcon species={c.species} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className={`font-semibold ${isGameFish(c.species) ? '' : 'text-ink-2'}`}>{speciesName(c.species)}</span>
            <span className="text-sm tabular-nums">
              {value === null ? '—' : metric === 'numbers' ? `${one(value)} per net` : `${lb(value)} avg`}
            </span>
          </div>
          {rating && <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT[metric][rating].cls}`}>{VERDICT[metric][rating].text}</span>}
          {outside && <span className="ml-2 text-xs text-ink-2">{outside}</span>}
        </div>
      </div>
      {value !== null && lo !== null && hi !== null ? (
        <Gauge value={value} lo={lo} hi={hi} metric={metric} />
      ) : (
        <p className="mt-1 text-xs text-ink-2">No DNR comparison for this one.</p>
      )}
    </li>
  );
}

function NumbersView({ catches }: { catches: FishCatch[] }) {
  return (
    <>
      {groupByGear(catches).map((g) => (
        <section key={g.family} aria-label={`${g.family}: ${g.unit}`}>
          <h4 className="text-sm font-semibold text-ink-2">
            {g.family} — {g.unit}
            {g.netCount ? ` (${g.netCount} ${g.family === 'Electrofishing' ? 'runs' : g.netCount === 1 ? 'net' : 'nets'})` : ''}
          </h4>
          <ul className="mt-1 space-y-2">
            {g.rows.map((c) => (
              <SpeciesRow key={`${c.species}-${c.gear}`} c={c} metric="numbers" />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function SizeView({ catches }: { catches: FishCatch[] }) {
  // One row per species: the net that caught the most of it gives the fairest average weight.
  const best = new Map<string, FishCatch>();
  for (const c of catches) {
    if (c.avgWeightLb === null) continue;
    const prev = best.get(c.species);
    if (!prev || (c.totalCatch ?? 0) > (prev.totalCatch ?? 0)) best.set(c.species, c);
  }
  const rows = [...best.values()].sort((a, b) => (b.avgWeightLb ?? 0) - (a.avgWeightLb ?? 0));
  if (!rows.length) return <p className="text-sm text-ink-2">This survey has no weights.</p>;
  return (
    <section aria-label="Average weight by species">
      <h4 className="text-sm font-semibold text-ink-2">Average weight of the fish caught</h4>
      <ul className="mt-1 space-y-2">
        {rows.map((c) => (
          <SpeciesRow key={c.species} c={c} metric="size" />
        ))}
      </ul>
    </section>
  );
}

function Explainer({ metric }: { metric: Metric }) {
  return (
    <details className="rounded-xl border border-line p-3 text-sm">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">What do “fewer”, “typical” and “more” mean?</summary>
      <div className="mt-2 space-y-2 text-ink-2">
        <p>
          The DNR compares each lake with Minnesota lakes that have similar size, depth and water chemistry (its “lake class”). The{' '}
          <strong className="text-ink">typical</strong> range is the middle half of those lakes: a quarter of similar lakes score lower, a quarter higher.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-ink">{metric === 'numbers' ? 'Fewer than usual' : 'Smaller than usual'}</strong>: lower than about 3 out of 4 similar
            lakes.
          </li>
          <li>
            <strong className="text-ink">Typical</strong>: in the middle half — an ordinary result for this kind of lake.
          </li>
          <li>
            <strong className="text-ink">{metric === 'numbers' ? 'More than usual' : 'Bigger than usual'}</strong>: higher than about 3 out of 4 similar
            lakes.
          </li>
        </ul>
        <p>
          <strong className="text-ink">Numbers</strong> is fish caught per net in the DNR’s standard nets — a measure of how plentiful a species is, not a
          count of fish in the lake. <strong className="text-ink">Size</strong> is the average weight of those fish.
        </p>
        <p>
          Nets catch some fish better than others: gill nets suit walleye, pike, perch and cisco; trap nets suit sunfish, crappie and bullheads. Bass and
          muskie are hard to net, so “fewer” for them often just means the nets missed them. Compare a species only within one kind of net.
        </p>
      </div>
    </details>
  );
}
