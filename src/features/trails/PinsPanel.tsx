import { useState } from 'react';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { deleteRecord, saveRecord, useRecords } from '../../db/records';
import { PhotoAttach } from '../journal/PhotoAttach';
import type { Pin, PinKind } from '../../model/trails';

export const KIND_LABEL: Record<PinKind, string> = {
  dispersed: 'Dispersed-site candidate',
  launch: 'Boat launch',
  water: 'Water source',
  turnaround: 'Turnaround point',
  other: 'Other',
};

function PinRow({ id, data, tripId, tripName }: { id: string; data: Pin; tripId: string | null; tripName: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data);

  async function save() {
    await saveRecord('pin', id, draft);
    setEditing(false);
  }

  if (!editing) {
    return (
      <li className="rounded-xl border border-line p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{data.name || 'Unnamed pin'}</p>
            <p className="text-sm text-ink-2">
              {KIND_LABEL[data.kind]} · {tripName ?? 'no trip yet'}
            </p>
            {data.notes && <p className="mt-1 text-sm text-ink-2">{data.notes}</p>}
            <p className="mt-1 text-xs text-ink-2">
              {data.position.lat.toFixed(5)}, {data.position.lng.toFixed(5)}
            </p>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="space-y-3 rounded-xl border border-line p-3">
      <Field label="Name">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
      </Field>
      <Field label="Kind">
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PinKind })} className={inputClass}>
          {(Object.keys(KIND_LABEL) as PinKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className={`${inputClass} min-h-20`}
        />
      </Field>
      <Field label="Photos">
        <PhotoAttach value={draft.photoIds} onChange={(photoIds) => setDraft({ ...draft, photoIds })} tripId={tripId} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => void save()}>Save</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(data);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
        <Button variant="ghost" className="ml-auto text-bad" onClick={() => void deleteRecord(id)}>
          Delete
        </Button>
      </div>
    </li>
  );
}

export function PinsPanel({ tripId }: { tripId: string | null }) {
  const { rows } = useRecords('pin');
  const { rows: trips } = useRecords('trip');
  const filtered = rows.filter((p) => (tripId ? p.data.tripId === tripId : true));
  const tripName = (id: string | null) => (id ? (trips.find((t) => t.id === id)?.data.name ?? 'Unknown trip') : null);

  if (filtered.length === 0) {
    return (
      <Card title="Pins">
        <p className="text-sm text-ink-2">No pins yet — import a file, or tap the map above to drop one.</p>
      </Card>
    );
  }

  return (
    <Card title={`Pins (${filtered.length})`}>
      <ul className="space-y-2">
        {filtered.map((p) => (
          <PinRow key={p.id} id={p.id} data={p.data} tripId={tripId} tripName={tripName(p.data.tripId)} />
        ))}
      </ul>
    </Card>
  );
}
