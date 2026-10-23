import { useEffect, useMemo, useRef } from 'react';
import { speciesName } from '../../fishing/lakeSurvey';
import { FishIcon } from '../../fishing/FishIcon';
import { TripMap, type TripMapMarker } from '../../trips/TripMap';
import type { LakeRec } from '../types';
import { CONFIDENCE, driveText, FACTOR_LABEL, miles, pointsText } from './format';
import { LogCatchForm } from './LogCatchForm';
import { RangeBar } from './RangeBar';
import { uncertaintySentence } from './uncertainty';
import { useOnline } from './useOnline';

// Statewide fishing regulations pages (shown with every lake: special rules come on top of these).
// verify: both URLs were not reachable from the build sandbox; confirm they're the current official pages.
const STATE_REGS = {
  MN: { label: 'Minnesota fishing regulations (DNR)', url: 'https://www.dnr.state.mn.us/regulations/fishing/index.html' },
  SD: { label: 'South Dakota fishing regulations (GFP)', url: 'https://gfp.sd.gov/fishing-regulations/' },
} as const;

const fmtDay = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-line pt-4">
      <h3 className="text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

const ext = { target: '_blank', rel: 'noopener noreferrer', className: 'inline-flex min-h-11 items-center font-semibold text-brand underline' } as const;

/** Full-screen sheet for one recommended lake: why it ranks where it does, how sure we are, rules, launches, and a catch log. */
export function LakeRecDetail({
  rec,
  species,
  speciesOptions,
  origin,
  tripId,
  onClose,
}: {
  rec: LakeRec;
  species: string;
  speciesOptions: readonly string[];
  origin: { lat: number; lng: number; label: string };
  tripId: string | null;
  onClose: () => void;
}) {
  const online = useOnline();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { lake } = rec;
  const est = lake.sp[species] ?? null;
  const fish = speciesName(species);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const markers: TripMapMarker[] = useMemo(
    () => [
      { id: '__camp', lat: origin.lat, lng: origin.lng, label: '★', variant: 'plain' as const, title: origin.label },
      ...lake.launches.map((l, i) => ({
        id: `launch-${i}`,
        lat: l.lat,
        lng: l.lng,
        label: 'L',
        variant: rec.launch && l.lat === rec.launch.lat && l.lng === rec.launch.lng ? ('accent' as const) : ('trip' as const),
        title: l.name,
      })),
    ],
    [origin, lake.launches, rec.launch],
  );

  const maxPts = Math.max(10, ...rec.factors.map((f) => Math.abs(f.points)));
  const regs = [...lake.regs].sort((a, b) => Number(b.species === species) - Number(a.species === species));
  const state = STATE_REGS[lake.state];
  const conf = CONFIDENCE[rec.confidence];
  const facts = [
    lake.county && `${lake.county} County`.replace(/ County County$/, ' County'),
    lake.state === 'MN' ? 'Minnesota' : 'South Dakota',
    lake.areaAcres !== null && `${Math.round(lake.areaAcres).toLocaleString()} acres`,
    lake.maxDepthFt !== null && `${Math.round(lake.maxDepthFt)} ft deep`,
    lake.clarityFt !== null && `clarity ${lake.clarityFt} ft`,
  ].filter(Boolean);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lakerec-title" className="fixed inset-0 z-[60] flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 id="lakerec-title" className="min-w-0 truncate text-lg font-bold">
          #{rec.rank} {lake.name}
        </h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 shrink-0 rounded-full text-2xl text-ink-2">
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3">
        <div className="mx-auto max-w-2xl space-y-4">
          <div>
            <p className="text-sm text-ink-2">{facts.join(' · ')}</p>
            <p className="text-sm text-ink-2">
              {driveText(rec.driveMin)} · {miles(rec.distanceKm)} straight line{rec.launch ? ` to ${rec.launch.name}` : ''}
            </p>
          </div>

          {/* Range + how sure */}
          <div className="space-y-2 rounded-xl bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <FishIcon species={species} size={40} />
              <p className="min-w-0 flex-1 font-semibold">{fish} vs. a typical lake</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${conf.cls}`}>{conf.label}</span>
            </div>
            <RangeBar range={rec.range} />
            <p className="text-sm">
              {uncertaintySentence(rec.range, est?.evidence ?? null, { speciesName: fish, usedFamilyLog: rec.usedFamilyLog, nowYear: new Date().getFullYear() })}
            </p>
            <p className="text-sm text-ink-2">How sure we are: {rec.confidenceText}</p>
            {est?.sizeIndex != null && (
              <p className="text-sm text-ink-2">
                Fish size: average weight about {est.sizeIndex.toFixed(1)}× similar lakes.
              </p>
            )}
          </div>

          <Section title={`Why #${rec.rank}?`}>
            <ul className="space-y-3">
              {rec.factors.map((f) => {
                const w = (Math.abs(f.points) / maxPts) * 50;
                return (
                  <li key={f.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{FACTOR_LABEL[f.key]}</span>
                      <span className={`text-sm font-bold tabular-nums ${f.points > 0.05 ? 'text-ok' : f.points < -0.05 ? 'text-bad' : 'text-ink-2'}`}>{pointsText(f.points)}</span>
                    </div>
                    <div aria-hidden className="relative my-1 h-2 rounded-full bg-surface-2">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                      <div
                        className={`absolute inset-y-0 rounded-full ${f.points >= 0 ? 'bg-ok' : 'bg-bad'}`}
                        style={f.points >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                      />
                    </div>
                    <p className="text-sm text-ink-2">{f.text}</p>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm">
              Total: <strong className="tabular-nums">{pointsText(rec.score)}</strong>. Bigger is better; each line above adds or takes away points.
            </p>
            {rec.vsNext && <p className="rounded-xl bg-surface-2 p-3 text-sm">{rec.vsNext}</p>}
          </Section>

          {rec.weakSpots.length > 0 && (
            <Section title="Weak spots">
              <ul className="space-y-1">
                {rec.weakSpots.map((w) => (
                  <li key={w} className="flex gap-2 text-sm">
                    <span aria-hidden className="text-warn">
                      ▲
                    </span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Regulations">
            {regs.length ? (
              <ul className="space-y-2">
                {regs.map((r, i) => (
                  <li key={i} className="rounded-xl bg-warn-bg p-3 text-sm">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-warn">
                      {r.species ? speciesName(r.species) : 'All species'} · special regulation
                    </p>
                    <blockquote className="whitespace-pre-line text-ink">“{r.text}”</blockquote>
                    <p className="mt-1 text-ink-2">
                      <a href={r.url} {...ext}>
                        Official source ↗
                      </a>{' '}
                      · fetched {fmtDay(r.fetchedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">None found in the official data — statewide rules apply.</p>
            )}
            <p className="text-sm">
              <a href={state.url} {...ext}>
                {state.label} ↗
              </a>
              <span className="text-ink-2"> · always check the current booklet before you fish.</span>
            </p>
          </Section>

          <Section title="Stocking">
            {lake.stocking.length ? (
              <table className="w-full text-left text-sm">
                <thead className="text-ink-2">
                  <tr>
                    <th className="py-1 font-semibold">Year</th>
                    <th className="py-1 font-semibold">Species</th>
                    <th className="py-1 text-right font-semibold">Number</th>
                    <th className="py-1 pl-2 font-semibold">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...lake.stocking]
                    .sort((a, b) => b.year - a.year)
                    .map((s, i) => (
                      <tr key={i} className={s.species === species ? 'font-semibold' : ''}>
                        <td className="py-1 tabular-nums">{s.year}</td>
                        <td className="py-1">{speciesName(s.species)}</td>
                        <td className="py-1 text-right tabular-nums">{s.count === null ? '—' : s.count.toLocaleString()}</td>
                        <td className="py-1 pl-2">{s.size || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-2">No stocking listed in the official data.</p>
            )}
          </Section>

          <Section title={lake.launches.length === 1 ? 'Launch' : 'Launches'}>
            <ul className="space-y-2">
              {lake.launches.map((l, i) => {
                const best = !!rec.launch && l.lat === rec.launch.lat && l.lng === rec.launch.lng;
                return (
                  <li key={i} className="rounded-xl bg-surface-2 p-3">
                    <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                      {l.name}
                      {best && <span className="whitespace-nowrap rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">Best for you</span>}
                    </p>
                    <p className="text-sm text-ink-2">{[l.ramp ? `ramp: ${l.ramp}` : 'ramp type not listed', l.source].join(' · ')}</p>
                    <a
                      href={`https://maps.apple.com/?daddr=${l.lat},${l.lng}&q=${encodeURIComponent(l.name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold"
                    >
                      Directions ↗
                    </a>
                  </li>
                );
              })}
            </ul>
            <TripMap
              center={[(rec.launch ?? lake).lng, (rec.launch ?? lake).lat]}
              zoom={10}
              markers={markers}
              tripId={tripId}
              fitMarkers
              trailTools={false}
              className="h-64 w-full"
            />
            <p className="text-xs text-ink-2">
              ★ {origin.label} · L launch{rec.launch ? ' (orange = best for you)' : ''}.
              {!online && ' Offline: the map only shows areas you viewed before while online.'}
            </p>
          </Section>

          <Section title="Sources">
            {est?.evidence.sources.length ? (
              <ul className="space-y-1 text-sm">
                {est.evidence.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} {...ext}>
                      {fmtDay(s.date)} · {s.type} ↗
                    </a>
                    <span className="block text-ink-2">
                      {s.gear}
                      {s.cpue !== null ? ` · ${s.cpue} ${fish.toLowerCase()} per ${/electro|shock/i.test(s.gear) ? 'hour' : 'net'}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No survey of this lake for {fish.toLowerCase()} — the estimate comes from similar lakes.</p>
            )}
            <p className="text-sm">
              <a href={lake.sourceUrl} {...ext}>
                Official lake page ↗
              </a>
            </p>
          </Section>

          <Section title="Log a catch">
            <LogCatchForm lakeKey={lake.key} lakeName={lake.name} tripId={tripId} targetSpecies={species} speciesOptions={speciesOptions} />
          </Section>
        </div>
      </div>
    </div>
  );
}
