import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { saveRecord, useRecord } from '../../db/records';
import { Button, Card, Field, PageTitle, inputClass } from '../../components/ui';
import type { ChecklistTemplate } from '../../model/schemas';
import { tripKindLabel } from './format';
import { ToolsSubNav } from './nav';

let itemSeq = 0;
function newItemId() {
  itemSeq += 1;
  return `item-${Date.now()}-${itemSeq}`;
}

export function ChecklistDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <ChecklistDetailLoader id={id} />;
}

function ChecklistDetailLoader({ id }: { id: string }) {
  const rec = useRecord('checklist_template', id);
  if (rec.loading) return <p className="text-ink-2">Loading…</p>;
  if (!rec.data) return <p className="text-ink-2">Checklist not found.</p>;
  return <ChecklistEditor id={id} initial={rec.data} />;
}

function ChecklistEditor({ id, initial }: { id: string; initial: ChecklistTemplate }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function save() {
    await saveRecord('checklist_template', id, draft);
    setSaved(true);
  }

  function moveItem(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= draft.items.length) return;
    const items = [...draft.items];
    const a = items[i];
    const b = items[j];
    if (!a || !b) return;
    items[i] = b;
    items[j] = a;
    setDraft({ ...draft, items });
    setSaved(false);
  }

  return (
    <div className="space-y-4">
      <PageTitle sub={tripKindLabel[draft.kind]}>{draft.name}</PageTitle>
      <ToolsSubNav />

      <Card title="Details">
        <div className="space-y-3">
          <Field label="Name">
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setSaved(false);
              }}
            />
          </Field>
          <Field label="Description">
            <textarea
              className={inputClass}
              rows={2}
              value={draft.description}
              onChange={(e) => {
                setDraft({ ...draft, description: e.target.value });
                setSaved(false);
              }}
            />
          </Field>
          {draft.source && <p className="text-sm text-ink-2">Source: {draft.source}</p>}
        </div>
      </Card>

      <Card title="Items">
        <ul className="space-y-2">
          {draft.items.map((item, i) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                className={`${inputClass} flex-1`}
                aria-label="Item text"
                value={item.text}
                onChange={(e) => {
                  const items = [...draft.items];
                  items[i] = { ...item, text: e.target.value };
                  setDraft({ ...draft, items });
                  setSaved(false);
                }}
              />
              <button
                type="button"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => moveItem(i, -1)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-ink disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={i === draft.items.length - 1}
                onClick={() => moveItem(i, 1)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-ink disabled:opacity-30"
              >
                ↓
              </button>
              <DeleteItemButton
                onDelete={() => {
                  setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) });
                  setSaved(false);
                }}
              />
            </li>
          ))}
        </ul>
        {draft.items.length === 0 && <p className="text-ink-2">No items yet.</p>}
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => {
            setDraft({ ...draft, items: [...draft.items, { id: newItemId(), text: '' }] });
            setSaved(false);
          }}
        >
          + Add item
        </Button>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={!dirty}>
          Save
        </Button>
        {saved && !dirty && <span className="text-sm text-ok">Saved</span>}
        <Button variant="ghost" onClick={() => navigate('/tools/checklists')}>
          Back to checklists
        </Button>
      </div>
    </div>
  );
}

function DeleteItemButton({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <button
      type="button"
      aria-label="Delete item"
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-sm font-semibold ${
        confirm ? 'border-bad bg-bad-bg text-bad' : 'border-line bg-surface-2 text-ink'
      }`}
      onClick={() => {
        if (confirm) onDelete();
        else {
          setConfirm(true);
          setTimeout(() => setConfirm(false), 4000);
        }
      }}
    >
      {confirm ? '!' : '×'}
    </button>
  );
}
