import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteRecord, newId, saveRecord, useRecord, useRecords } from '../../db/records';
import { Button, Card, Field, PageTitle, inputClass } from '../../components/ui';
import type { Gear, GearLocation, GearStatus, TripKind } from '../../model/schemas';
import { locationLabel, tripKindLabel } from './format';
import { GearSubNav } from './nav';
import { SpecNumberEditor, numOrNull } from './SpecNumberEditor';

const LOCATIONS = Object.keys(locationLabel) as GearLocation[];
const TRIP_KINDS = Object.keys(tripKindLabel) as TripKind[];

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const blankGear = (categoryId: string): Gear => ({
  name: '',
  categoryId,
  status: 'wishlist',
  priority: null,
  quantity: 1,
  costLowUsd: null,
  costHighUsd: null,
  costActualUsd: null,
  inBudget: true,
  optional: false,
  weightLb: { value: null, status: 'estimate' },
  powerW: null,
  energyWhPerDay: null,
  location: null,
  packFor: ['all'],
  notes: '',
  verify: '',
});

export function GearFormPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <GearEditorNew />;
  return <GearEditorLoader id={id} />;
}

function GearEditorNew() {
  const categories = useRecords('budget_category');
  const sorted = [...categories.rows].sort((a, b) => a.data.order - b.data.order);
  if (categories.loading) return <p className="text-ink-2">Loading…</p>;
  return <GearEditor mode="new" initial={blankGear(sorted[0]?.id ?? '')} categories={sorted.map((c) => ({ id: c.id, name: c.data.name }))} />;
}

function GearEditorLoader({ id }: { id: string }) {
  const rec = useRecord('gear', id);
  const categories = useRecords('budget_category');
  if (rec.loading || categories.loading) return <p className="text-ink-2">Loading…</p>;
  if (!rec.data) return <p className="text-ink-2">Gear item not found.</p>;
  const sorted = [...categories.rows].sort((a, b) => a.data.order - b.data.order);
  return <GearEditor mode="edit" id={id} initial={rec.data} categories={sorted.map((c) => ({ id: c.id, name: c.data.name }))} />;
}

function GearEditor({
  mode,
  id,
  initial,
  categories,
}: {
  mode: 'new' | 'edit';
  id?: string;
  initial: Gear;
  categories: { id: string; name: string }[];
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const recordId = id ?? newId('gear');
      await saveRecord('gear', recordId, draft);
      setError(null);
      if (mode === 'new') navigate(`/gear/${recordId}`);
      else setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function applyQuickAction(next: Gear) {
    setDraft(next);
    if (id) await saveRecord('gear', id, next);
  }

  return (
    <div className="space-y-4">
      <PageTitle sub={mode === 'new' ? 'New gear item' : draft.name}>{mode === 'new' ? 'Add gear' : 'Edit gear'}</PageTitle>
      <GearSubNav />

      {id && (
        <Card title="Quick actions">
          <QuickActions data={draft} onChanged={applyQuickAction} />
        </Card>
      )}

      <Card>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Name">
            <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </Field>

          <Field label="Category">
            <select className={inputClass} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                className={inputClass}
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as GearStatus })}
              >
                <option value="wishlist">Wishlist</option>
                <option value="ordered">Ordered</option>
                <option value="own">Own</option>
              </select>
            </Field>
            <Field label="Priority">
              <select
                className={inputClass}
                value={draft.priority ?? ''}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Not ranked</option>
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <select
                className={inputClass}
                value={draft.location ?? ''}
                onChange={(e) => setDraft({ ...draft, location: e.target.value === '' ? null : (e.target.value as GearLocation) })}
              >
                <option value="">Not set</option>
                {LOCATIONS.map((l) => (
                  <option key={l} value={l}>
                    {locationLabel[l]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input
                className={inputClass}
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.quantity}
                onChange={(e) => setDraft({ ...draft, quantity: Math.max(1, Math.round(num(e.target.value))) })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Price low (research)">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.costLowUsd ?? ''}
                onChange={(e) => setDraft({ ...draft, costLowUsd: numOrNull(e.target.value) })}
              />
            </Field>
            <Field label="Price high (research)">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.costHighUsd ?? ''}
                onChange={(e) => setDraft({ ...draft, costHighUsd: numOrNull(e.target.value) })}
              />
            </Field>
            <Field label="Actual price paid" hint="Overrides the estimate">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.costActualUsd ?? ''}
                onChange={(e) => setDraft({ ...draft, costActualUsd: numOrNull(e.target.value) })}
              />
            </Field>
          </div>

          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.inBudget}
              onChange={(e) => setDraft({ ...draft, inBudget: e.target.checked })}
            />
            <span>Counts toward this season's budget</span>
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.optional}
              onChange={(e) => setDraft({ ...draft, optional: e.target.checked })}
            />
            <span>Optional / nice-to-have (kept out of planned spending)</span>
          </label>

          <SpecNumberEditor
            label="Weight per unit (lb)"
            spec={draft.weightLb}
            onChange={(s) => setDraft({ ...draft, weightLb: s })}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Power draw (W)" hint="If it uses power">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.powerW ?? ''}
                onChange={(e) => setDraft({ ...draft, powerW: numOrNull(e.target.value) })}
              />
            </Field>
            <Field label="Energy (Wh/day)">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.energyWhPerDay ?? ''}
                onChange={(e) => setDraft({ ...draft, energyWhPerDay: numOrNull(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="Pack for">
            <div className="flex flex-wrap gap-2">
              {TRIP_KINDS.map((k) => {
                const active = draft.packFor.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        packFor: active ? draft.packFor.filter((x) => x !== k) : [...draft.packFor, k],
                      })
                    }
                    className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                      active ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink-2'
                    }`}
                  >
                    {tripKindLabel[k]}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Notes">
            <textarea
              className={inputClass}
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
          <Field label="Verify" hint="Anything to check before buying (fit, specs)">
            <textarea
              className={inputClass}
              rows={2}
              value={draft.verify}
              onChange={(e) => setDraft({ ...draft, verify: e.target.value })}
            />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={mode === 'edit' && !dirty}>
              Save
            </Button>
            {error ? (
              <span role="alert" className="text-sm text-bad">
                Couldn't save: check the values.
              </span>
            ) : (
              saved && !dirty && <span className="text-sm text-ok">Saved</span>
            )}
          </div>
        </form>
      </Card>

      {id && (
        <Card>
          <DeleteButton id={id} onDeleted={() => navigate('/gear')} />
        </Card>
      )}
    </div>
  );
}

function QuickActions({ data, onChanged }: { data: Gear; onChanged: (g: Gear) => void }) {
  const [markingBought, setMarkingBought] = useState(false);
  const [price, setPrice] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {data.status === 'wishlist' && (
        <Button type="button" variant="secondary" onClick={() => void onChanged({ ...data, status: 'ordered' })}>
          Mark ordered
        </Button>
      )}
      {data.status !== 'own' && !markingBought && (
        <Button type="button" variant="secondary" onClick={() => setMarkingBought(true)}>
          Mark bought
        </Button>
      )}
      {markingBought && (
        <div className="flex items-center gap-2">
          <input
            className={`${inputClass} w-28`}
            inputMode="decimal"
            type="number"
            min={0}
            placeholder="Price paid"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            autoFocus
          />
          <Button
            type="button"
            onClick={() => {
              void onChanged({ ...data, status: 'own', costActualUsd: numOrNull(price) });
              setMarkingBought(false);
              setPrice('');
            }}
          >
            Confirm
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMarkingBought(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function DeleteButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 font-semibold ${
        confirm ? 'border-bad bg-bad-bg text-bad' : 'border-line bg-surface-2 text-ink'
      }`}
      onClick={() => {
        if (confirm) void deleteRecord(id).then(onDeleted);
        else setConfirm(true);
      }}
    >
      {confirm ? 'Tap again to delete' : 'Delete this item'}
    </button>
  );
}
