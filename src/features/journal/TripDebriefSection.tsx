import { useEffect, useRef, useState } from 'react';
import { saveRecord, useRecord, useRecords } from '../../db/records';
import { Button, Card, Field, inputClass } from '../../components/ui';
import type { Debrief } from '../../model/schemas';
import { PhotoAttach } from './PhotoAttach';

const AUTOSAVE_MS = 800;

function emptyDebrief(tripId: string): Debrief {
  return { tripId, forgot: [], neverUsed: [], wentWell: '', improve: '', notes: '', photoIds: [] };
}

/** Small round "remove" button, kept at a full 44px tap target. */
function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg leading-none text-ink-2 hover:bg-surface-2"
    >
      ×
    </button>
  );
}

/** Shown on each trip page. Phase 5: debrief — forgot, never used, notes, photos. */
export function TripDebriefSection({ tripId }: { tripId: string }) {
  const debriefId = `debrief:${tripId}`;
  const existing = useRecord('debrief', debriefId);
  const trip = useRecord('trip', tripId);
  const gear = useRecords('gear');

  const [draft, setDraft] = useState<Debrief | null>(null);
  const [forgotInput, setForgotInput] = useState('');
  const [neverUsedInput, setNeverUsedInput] = useState('');
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Seed the draft once the record resolves. Only the first time — we don't
  // want a background sync mid-edit to overwrite what's being typed.
  useEffect(() => {
    if (existing.loading) return;
    setDraft((prev) => prev ?? existing.data ?? emptyDebrief(tripId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.loading, tripId]);

  function commit(next: Debrief) {
    dirtyRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      void saveRecord('debrief', debriefId, next);
    }, AUTOSAVE_MS);
    setDraft(next);
  }

  // Flush any pending edit immediately when leaving the page.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setDraft((prev) => {
          if (prev) void saveRecord('debrief', debriefId, prev);
          return prev;
        });
      }
    },
    [debriefId],
  );

  const tripGearIds = trip.data?.gearIds ?? [];
  const tripGear = gear.rows.filter((g) => tripGearIds.includes(g.id));

  if (trip.loading || existing.loading || !trip.data || !draft) return null;

  function addForgot() {
    const text = forgotInput.trim();
    if (!text || !draft) return;
    commit({ ...draft, forgot: [...draft.forgot, text] });
    setForgotInput('');
  }
  function removeForgot(i: number) {
    if (!draft) return;
    commit({ ...draft, forgot: draft.forgot.filter((_, idx) => idx !== i) });
  }

  function toggleNeverUsedGear(gearId: string, checked: boolean) {
    if (!draft) return;
    const next = checked ? [...draft.neverUsed, gearId] : draft.neverUsed.filter((v) => v !== gearId);
    commit({ ...draft, neverUsed: next });
  }
  function addNeverUsedText() {
    const text = neverUsedInput.trim();
    if (!text || !draft) return;
    commit({ ...draft, neverUsed: [...draft.neverUsed, text] });
    setNeverUsedInput('');
  }
  function removeNeverUsed(i: number) {
    if (!draft) return;
    commit({ ...draft, neverUsed: draft.neverUsed.filter((_, idx) => idx !== i) });
  }

  const gearNameById = new Map(tripGear.map((g) => [g.id, g.data.name]));
  const freeTextNeverUsed = draft.neverUsed.filter((v) => !gearNameById.has(v));

  return (
    <Card title="Trip debrief">
      <div className="space-y-5">
        <div>
          <h3 className="mb-1 font-semibold">What we forgot</h3>
          <p className="mb-2 text-sm text-ink-2">Each item here is added to the next trip's checklist automatically.</p>
          <ul className="mb-2 space-y-1">
            {draft.forgot.map((item, i) => (
              <li key={`${item}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5">
                <span className="text-sm">{item}</span>
                <RemoveButton onClick={() => removeForgot(i)} label={`Remove "${item}"`} />
              </li>
            ))}
            {draft.forgot.length === 0 && <li className="text-sm text-ink-2">Nothing yet.</li>}
          </ul>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="e.g. bug spray"
              value={forgotInput}
              onChange={(e) => setForgotInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addForgot();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={addForgot}>
              Add
            </Button>
          </div>
        </div>

        <div>
          <h3 className="mb-1 font-semibold">Never used</h3>
          <p className="mb-2 text-sm text-ink-2">Gear we packed but didn't touch — candidates to leave home next time.</p>
          {tripGear.length > 0 && (
            <ul className="mb-2 space-y-1">
              {tripGear.map((g) => (
                <li key={g.id}>
                  <label className="flex min-h-11 items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={draft.neverUsed.includes(g.id)}
                      onChange={(e) => toggleNeverUsedGear(g.id, e.target.checked)}
                    />
                    {g.data.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {freeTextNeverUsed.length > 0 && (
            <ul className="mb-2 space-y-1">
              {freeTextNeverUsed.map((item) => (
                <li key={item} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5">
                  <span className="text-sm">{item}</span>
                  <RemoveButton onClick={() => removeNeverUsed(draft.neverUsed.indexOf(item))} label={`Remove "${item}"`} />
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="Something not in the gear list"
              value={neverUsedInput}
              onChange={(e) => setNeverUsedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addNeverUsedText();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={addNeverUsedText}>
              Add
            </Button>
          </div>
        </div>

        <Field label="What went well">
          <textarea
            className={`${inputClass} min-h-24`}
            value={draft.wentWell}
            onChange={(e) => commit({ ...draft, wentWell: e.target.value })}
          />
        </Field>

        <Field label="What we'd improve">
          <textarea
            className={`${inputClass} min-h-24`}
            value={draft.improve}
            onChange={(e) => commit({ ...draft, improve: e.target.value })}
          />
        </Field>

        <Field label="Other notes">
          <textarea
            className={`${inputClass} min-h-24`}
            value={draft.notes}
            onChange={(e) => commit({ ...draft, notes: e.target.value })}
          />
        </Field>

        <div>
          <h3 className="mb-2 font-semibold">Photos</h3>
          <PhotoAttach value={draft.photoIds} onChange={(ids) => commit({ ...draft, photoIds: ids })} tripId={tripId} />
        </div>
      </div>
    </Card>
  );
}
