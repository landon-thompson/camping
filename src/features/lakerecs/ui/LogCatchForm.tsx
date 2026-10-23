import { useState } from 'react';
import { deleteRecord, useRecords } from '../../../db/records';
import { Button, Field, inputClass } from '../../../components/ui';
import { FishIcon } from '../../fishing/FishIcon';
import { speciesName } from '../../fishing/lakeSurvey';
import { saveFishingLog } from './engine';
import { draftToLog, logSummary, newDraft, todayIso, type LogDraft } from './logForm';

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** "Log a catch" for one lake, plus the family's past outings there. Zero catches count too. */
export function LogCatchForm({
  lakeKey,
  lakeName,
  tripId,
  targetSpecies,
  speciesOptions,
}: {
  lakeKey: string;
  lakeName: string;
  tripId: string | null;
  targetSpecies: string;
  speciesOptions: readonly string[];
}) {
  const [draft, setDraft] = useState<LogDraft>(() => newDraft(targetSpecies, todayIso()));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const logs = useRecords('fishing_log');
  const past = logs.rows.filter((r) => r.data.lakeKey === lakeKey).sort((a, b) => b.data.date.localeCompare(a.data.date) || b.updatedAt - a.updatedAt);

  const set = (patch: Partial<LogDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const others = speciesOptions.filter((s) => !(s in draft.counts));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = draftToLog(draft, { key: lakeKey, name: lakeName }, tripId);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setBusy(true);
    try {
      await saveFishingLog(r.log);
      setErrors([]);
      setDraft(newDraft(targetSpecies, draft.date));
      setSaved(true);
    } catch (err) {
      setErrors([`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Date">
          <input className={inputClass} type="date" value={draft.date} max={todayIso()} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours fished">
            <input className={inputClass} inputMode="decimal" value={draft.hours} onChange={(e) => set({ hours: e.target.value })} />
          </Field>
          <Field label="People fishing">
            <input className={inputClass} inputMode="numeric" value={draft.anglers} onChange={(e) => set({ anglers: e.target.value })} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink-2">Fish caught (0 counts too)</legend>
          <ul className="space-y-2">
            {Object.keys(draft.counts).map((sp) => (
              <li key={sp} className="flex items-center gap-2">
                <FishIcon species={sp} size={32} />
                <label htmlFor={`count-${lakeKey}-${sp}`} className="min-w-0 flex-1 text-sm font-semibold">
                  {speciesName(sp)}
                  {draft.targetSpecies.includes(sp) && <span className="font-normal text-ink-2"> · target</span>}
                </label>
                <span className="w-24 shrink-0">
                  <input
                    id={`count-${lakeKey}-${sp}`}
                    className={`${inputClass} text-right tabular-nums`}
                    inputMode="numeric"
                    value={draft.counts[sp]}
                    placeholder="0"
                    onChange={(e) => set({ counts: { ...draft.counts, [sp]: e.target.value } })}
                  />
                </span>
                {!draft.targetSpecies.includes(sp) && (
                  <button
                    type="button"
                    aria-label={`Remove ${speciesName(sp)}`}
                    onClick={() => set({ counts: Object.fromEntries(Object.entries(draft.counts).filter(([k]) => k !== sp)) })}
                    className="min-h-11 min-w-11 rounded-full text-xl text-ink-2"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <select
              className={`${inputClass} mt-2`}
              aria-label="Add a species"
              value=""
              onChange={(e) => e.target.value && set({ counts: { ...draft.counts, [e.target.value]: '' } })}
            >
              <option value="">+ Add a species…</option>
              {others.map((s) => (
                <option key={s} value={s}>
                  {speciesName(s)}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink-2">How was it? (optional)</legend>
          <div role="group" aria-label="Rating" className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={draft.rating === n}
                aria-label={`${n} of 5`}
                onClick={() => set({ rating: draft.rating === n ? null : n })}
                className={`min-h-11 flex-1 rounded-xl border text-lg ${draft.rating !== null && n <= draft.rating ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink-2'}`}
              >
                ★
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-2">Launch, crowds, scenery — the whole outing. Tap again to clear.</p>
        </fieldset>

        <Field label="Notes">
          <textarea className={`${inputClass} min-h-20 py-2`} value={draft.notes} placeholder="Where, what bait, weather…" onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        {errors.length > 0 && (
          <ul role="alert" className="list-disc rounded-xl bg-bad-bg p-3 pl-7 text-sm text-bad">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save outing'}
          </Button>
          {saved && (
            <p role="status" className="text-sm font-semibold text-ok">
              Saved ✓ It syncs to your other phone.
            </p>
          )}
        </div>
        <p className="text-xs text-ink-2">Your log stays in the family’s own data (it syncs between your phones); it’s never published.</p>
      </form>

      <section>
        <h4 className="mb-1 font-semibold">Past outings here</h4>
        {past.length === 0 ? (
          <p className="text-sm text-ink-2">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {past.map((r) => (
              <li key={r.id} className="rounded-xl bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {fmtDate(r.data.date)}
                      {r.data.rating !== null && (
                        <span className="ml-2 text-sm font-normal text-ink-2" aria-label={`rated ${r.data.rating} of 5`}>
                          {'★'.repeat(r.data.rating)}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-ink-2">{logSummary(r.data)}</p>
                    {r.data.notes && <p className="mt-1 text-sm">{r.data.notes}</p>}
                  </div>
                  {confirmDelete === r.id ? (
                    <span className="flex shrink-0 flex-col items-end">
                      <button type="button" onClick={() => void deleteRecord(r.id)} className="min-h-11 rounded-xl bg-bad-bg px-3 text-sm font-semibold text-bad">
                        Delete
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-11 px-3 text-sm font-semibold text-ink-2">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete outing on ${fmtDate(r.data.date)}`}
                      onClick={() => setConfirmDelete(r.id)}
                      className="min-h-11 min-w-11 shrink-0 rounded-xl text-sm font-semibold text-ink-2"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
