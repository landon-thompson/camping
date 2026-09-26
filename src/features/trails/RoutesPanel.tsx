import { useState } from 'react';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { deleteRecord, saveRecord, useRecords } from '../../db/records';
import type { Route } from '../../model/trails';

const DIFFICULTIES = [1, 2, 3, 4, 5] as const;

function RouteRow({ id, data, tripName }: { id: string; data: Route; tripName: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data);

  async function save() {
    await saveRecord('route', id, draft);
    setEditing(false);
  }

  if (!editing) {
    return (
      <li className="rounded-xl border border-line p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{data.name}</p>
            <p className="text-sm text-ink-2">
              {data.distanceMi.toFixed(1)} mi · {data.estDriveMin != null ? `~${data.estDriveMin} min` : 'time n/a'}
              {data.difficulty != null ? ` · difficulty ${data.difficulty}/5` : ''}
              {tripName ? ` · ${tripName}` : ' · no trip yet'}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {data.flags.noTrailer && <span className="rounded-full bg-bad-bg px-2 py-0.5 text-xs font-semibold text-bad">no trailer</span>}
              {data.flags.fourWd && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">4WD/high clearance</span>}
              {data.flags.seasonalMud && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn">seasonal mud</span>}
            </div>
            {data.notes && <p className="mt-1 text-sm text-ink-2">{data.notes}</p>}
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
      <Field label="Difficulty (owner's own rating)">
        <select
          value={draft.difficulty ?? ''}
          onChange={(e) => setDraft({ ...draft, difficulty: e.target.value ? Number(e.target.value) : null })}
          className={inputClass}
        >
          <option value="">Not rated</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d} {d === 1 ? '(easy)' : d === 5 ? '(hard)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-ink-2">Flags</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="h-6 w-6"
            checked={draft.flags.noTrailer}
            onChange={(e) => setDraft({ ...draft, flags: { ...draft.flags, noTrailer: e.target.checked } })}
          />
          No trailer — narrow / no turnaround
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="h-6 w-6"
            checked={draft.flags.fourWd}
            onChange={(e) => setDraft({ ...draft, flags: { ...draft.flags, fourWd: e.target.checked } })}
          />
          4WD / high clearance needed
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="h-6 w-6"
            checked={draft.flags.seasonalMud}
            onChange={(e) => setDraft({ ...draft, flags: { ...draft.flags, seasonalMud: e.target.checked } })}
          />
          Seasonal mud
        </label>
      </fieldset>
      <Field label="Notes">
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className={`${inputClass} min-h-24`}
        />
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
        <Button
          variant="ghost"
          className="ml-auto text-bad"
          onClick={() => void deleteRecord(id)}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

export function RoutesPanel({ tripId }: { tripId: string | null }) {
  const { rows } = useRecords('route');
  const { rows: trips } = useRecords('trip');
  const filtered = rows.filter((r) => (tripId ? r.data.tripId === tripId : true));
  const tripName = (id: string | null) => (id ? (trips.find((t) => t.id === id)?.data.name ?? 'Unknown trip') : null);

  if (filtered.length === 0) {
    return (
      <Card title="Routes">
        <p className="text-sm text-ink-2">No routes yet — import a GPX/KML file above.</p>
      </Card>
    );
  }

  return (
    <Card title={`Routes (${filtered.length})`}>
      <ul className="space-y-2">
        {filtered.map((r) => (
          <RouteRow key={r.id} id={r.id} data={r.data} tripName={tripName(r.data.tripId)} />
        ))}
      </ul>
    </Card>
  );
}
