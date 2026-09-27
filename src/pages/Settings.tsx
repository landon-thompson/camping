import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { saveRecord, useRecord } from '../db/records';
import { makeBackup, parseBackup, restoreBackup } from '../db/backup';
import { Button, Card, Field, inputClass, LinkButton, PageTitle, StatusChip } from '../components/ui';
import { describeSync } from '../components/SyncBadge';
import { useAuth } from '../auth/AuthContext';
import { forgetUser, loginUrl, logoutUrl } from '../auth/identity';
import { syncEngine, useSyncStatus } from '../sync/useSync';
import { useTheme, type ThemePref } from '../lib/theme';
import type { RecordData, RecordType, Settings as SettingsData, SpecNumber, SpecStatus, Trailer, Vehicle } from '../model/schemas';

export function Settings() {
  const settings = useRecord('settings', 'settings');
  const vehicle = useRecord('vehicle', 'vehicle:gx550');
  const trailer = useRecord('trailer', 'trailer:boat');

  return (
    <div className="space-y-4">
      <PageTitle>Settings</PageTitle>
      <AccountCard />
      <SyncCard />
      <ThemeCard />
      {settings.data && <HouseholdForm initial={settings.data} />}
      {vehicle.data && <VehicleForm initial={vehicle.data} />}
      {trailer.data && <TrailerForm initial={trailer.data} />}
      <BackupCard />
      <StorageCard />
      <VersionCard />
    </div>
  );
}

function AccountCard() {
  const { auth } = useAuth();
  let body: ReactNode = <p className="text-ink-2">Checking…</p>;
  if (auth?.kind === 'signed-in') {
    body = (
      <>
        <p>
          Signed in as <strong>{auth.user.userDetails}</strong>
          {auth.offline && <span className="text-ink-2"> (offline)</span>}
        </p>
        <div className="mt-3">
          <a href={logoutUrl()} onClick={() => forgetUser()} className="inline-flex min-h-12 items-center font-semibold text-brand">
            Sign out
          </a>
        </div>
      </>
    );
  } else if (auth?.kind === 'signed-out') {
    body = (
      <>
        <p className="mb-3 text-ink-2">Sign in with your Microsoft account to sync with your family.</p>
        <LinkButton href={loginUrl()}>Sign in with Microsoft</LinkButton>
      </>
    );
  } else if (auth?.kind === 'unavailable') {
    body = <p className="text-ink-2">Sign-in isn’t connected yet. It turns on once the app is deployed to Azure.</p>;
  }
  return <Card title="Account">{body}</Card>;
}

function SyncCard() {
  const s = useSyncStatus();
  return (
    <Card title="Sync">
      <p className="text-ink-2">{describeSync(s.state, s.message)}</p>
      <p className="mt-2 text-sm text-ink-2">
        {s.pending} change{s.pending === 1 ? '' : 's'} waiting
        {s.lastSyncedAt ? ` · last synced ${new Date(s.lastSyncedAt).toLocaleString()}` : ''}
      </p>
      <Button className="mt-3" variant="secondary" onClick={() => void syncEngine.sync()}>
        Sync now
      </Button>
    </Card>
  );
}

function ThemeCard() {
  const [pref, setPref] = useTheme();
  const opts: { v: ThemePref; label: string }[] = [
    { v: 'system', label: 'Auto' },
    { v: 'light', label: 'Day' },
    { v: 'dark', label: 'Night' },
  ];
  return (
    <Card title="Display">
      <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={pref === o.v}
            onClick={() => setPref(o.v)}
            className={`min-h-12 rounded-xl border font-semibold ${
              pref === o.v ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

/**
 * Local draft of a record with a Save button. If the record changes underneath
 * (e.g. a sync from the other phone) and you haven't started editing, the form
 * picks up the new values; an in-progress edit is never overwritten.
 */
function useDraft<T extends RecordType>(type: T, id: string, initial: RecordData<T>) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialJson = JSON.stringify(initial);
  useEffect(() => {
    if (JSON.stringify(base) === initialJson) return;
    if (JSON.stringify(draft) === JSON.stringify(base)) setDraft(initial);
    setBase(initial);
  }, [initialJson]);
  const dirty = JSON.stringify(draft) !== initialJson;
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveRecord(type, id, draft);
      setError(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return { draft, setDraft, dirty, saved, error, onSubmit };
}

function SaveRow({ dirty, saved, error }: { dirty: boolean; saved: boolean; error: string | null }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <Button type="submit" disabled={!dirty}>
        Save
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-bad">
          Couldn’t save: check the values.
        </span>
      ) : (
        <span role="status" className="text-sm text-ok">
          {saved && !dirty ? 'Saved on this phone' : ''}
        </span>
      )}
    </div>
  );
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function HouseholdForm({ initial }: { initial: SettingsData }) {
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('settings', 'settings', initial);
  return (
    <Card title="Household">
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={draft.householdName} onChange={(e) => setDraft({ ...draft, householdName: e.target.value })} />
        </Field>
        <Field label="Home base">
          <input
            className={inputClass}
            value={draft.homeBase.name}
            onChange={(e) => setDraft({ ...draft, homeBase: { ...draft.homeBase, name: e.target.value } })}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Adults">
            <input
              className={inputClass}
              inputMode="numeric"
              type="number"
              min={0}
              value={draft.people.adults}
              onChange={(e) => setDraft({ ...draft, people: { ...draft.people, adults: num(e.target.value) } })}
            />
          </Field>
          <Field label="Kids">
            <input
              className={inputClass}
              inputMode="numeric"
              type="number"
              min={0}
              value={draft.people.children}
              onChange={(e) => setDraft({ ...draft, people: { ...draft.people, children: num(e.target.value) } })}
            />
          </Field>
          <Field label="Season">
            <input
              className={inputClass}
              inputMode="numeric"
              type="number"
              value={draft.seasonYear}
              onChange={(e) => setDraft({ ...draft, seasonYear: num(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Season gear budget (USD)" hint="Starting point: ~$3,000 of priced wishlist items. Change it any time.">
          <input
            className={inputClass}
            inputMode="decimal"
            type="number"
            min={0}
            step={50}
            value={draft.seasonBudgetUsd}
            onChange={(e) => setDraft({ ...draft, seasonBudgetUsd: num(e.target.value) })}
          />
        </Field>
        <SaveRow dirty={dirty} saved={saved} error={error} />
      </form>
    </Card>
  );
}

function SpecEditor({ label, spec, onChange }: { label: string; spec: SpecNumber; onChange: (s: SpecNumber) => void }) {
  return (
    <fieldset className="rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink-2">
        {label} <StatusChip status={spec.status} />
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <input
          aria-label={`${label} (lb)`}
          className={inputClass}
          inputMode="decimal"
          type="number"
          step="any"
          min={0}
          placeholder="lb"
          value={spec.value ?? ''}
          onChange={(e) => onChange({ ...spec, value: numOrNull(e.target.value) })}
        />
        <select
          aria-label={`${label} confidence`}
          className={inputClass}
          value={spec.status}
          onChange={(e) => onChange({ ...spec, status: e.target.value as SpecStatus })}
        >
          <option value="verified">Verified</option>
          <option value="verify">Needs verifying</option>
          <option value="estimate">Estimate</option>
        </select>
      </div>
      {(spec.note || spec.source) && (
        <p className="mt-2 text-sm text-ink-2">
          {spec.note}
          {spec.source && <span className="block">Source: {spec.source}</span>}
        </p>
      )}
    </fieldset>
  );
}

function VehicleForm({ initial }: { initial: Vehicle }) {
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('vehicle', 'vehicle:gx550', initial);
  return (
    <Card title="Vehicle">
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="font-semibold">
          {draft.year} {draft.make} {draft.model} {draft.trim}
        </p>
        <SpecEditor label="Payload" spec={draft.payloadLb} onChange={(s) => setDraft({ ...draft, payloadLb: s })} />
        <SpecEditor label="Tow rating" spec={draft.towRatingLb} onChange={(s) => setDraft({ ...draft, towRatingLb: s })} />
        <SpecEditor label="Roof load limit" spec={draft.roofLimitLb} onChange={(s) => setDraft({ ...draft, roofLimitLb: s })} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          {draft.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        {draft.notes.map((n) => (
          <p key={n} className="rounded-xl bg-warn-bg p-3 text-sm text-ink">
            {n}
          </p>
        ))}
        <SaveRow dirty={dirty} saved={saved} error={error} />
      </form>
    </Card>
  );
}

function TrailerForm({ initial }: { initial: Trailer }) {
  const { draft, setDraft, dirty, saved, error, onSubmit } = useDraft('trailer', 'trailer:boat', initial);
  return (
    <Card title="Boat & trailer">
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-ink-2">{draft.description}</p>
        <SpecEditor label="Loaded weight — low" spec={draft.weightLowLb} onChange={(s) => setDraft({ ...draft, weightLowLb: s })} />
        <SpecEditor label="Loaded weight — high" spec={draft.weightHighLb} onChange={(s) => setDraft({ ...draft, weightHighLb: s })} />
        <SpecEditor label="Scale ticket" spec={draft.scaleTicketLb} onChange={(s) => setDraft({ ...draft, scaleTicketLb: s })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tongue weight min %">
            <input
              className={inputClass}
              inputMode="decimal"
              type="number"
              step="any"
              min={0}
              max={100}
              value={draft.tonguePctMin}
              onChange={(e) => setDraft({ ...draft, tonguePctMin: num(e.target.value) })}
            />
          </Field>
          <Field label="Tongue weight max %">
            <input
              className={inputClass}
              inputMode="decimal"
              type="number"
              step="any"
              min={0}
              max={100}
              value={draft.tonguePctMax}
              onChange={(e) => setDraft({ ...draft, tonguePctMax: num(e.target.value) })}
            />
          </Field>
        </div>
        <SaveRow dirty={dirty} saved={saved} error={error} />
      </form>
    </Card>
  );
}

function BackupCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function backup() {
    setError(null);
    const data = await makeBackup();
    const name = `camp-planner-backup-${data.exportedAt.slice(0, 10)}.json`;
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    // On iPhone this opens the share sheet: Save to Files, AirDrop, Mail…
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Camp Planner backup' });
        setStatus(`Backup shared (${data.records.length} records).`);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`Backup saved (${data.records.length} records).`);
  }

  async function restore(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setError(null);
    try {
      const result = await restoreBackup(parseBackup(await file.text()));
      setStatus(`Restored: ${result.added} added, ${result.updated} updated, ${result.skipped} already up to date.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that file.');
    }
  }

  return (
    <Card title="Backup">
      <p className="text-ink-2">
        Save a copy of everything on this phone, e.g. to Files or iCloud Drive. Restoring only adds newer items and never
        undoes recent edits. Also a way to copy your plans to another phone while sync isn’t set up.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" onClick={() => void backup()}>
          Back up now
        </Button>
        <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2 px-4 font-semibold">
          Restore from file
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void restore(e.target.files)} />
        </label>
      </div>
      <p role="status" className="mt-2 text-sm text-ok">
        {status ?? ''}
      </p>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </Card>
  );
}

function StorageCard() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);
  return (
    <Card title="Offline storage">
      <p className="text-ink-2">
        {persisted === null
          ? 'Checking…'
          : persisted
            ? 'This device will keep the app’s offline data.'
            : 'Offline data could be cleared by the phone if storage runs low. On iPhone, add the app to the Home Screen to keep it.'}
      </p>
      {persisted === false && (
        <Button className="mt-3" variant="secondary" onClick={() => void navigator.storage.persist().then(setPersisted)}>
          Ask to keep offline data
        </Button>
      )}
    </Card>
  );
}

/** Which build this phone runs, and a manual update check (the update bar appears if one is found). */
function VersionCard() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="App version">
      <p className="text-ink-2">{import.meta.env.VITE_APP_VERSION ?? 'unknown'}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            setMsg('Checking…');
            try {
              const reg = await navigator.serviceWorker?.getRegistration();
              if (!reg) return setMsg('Updates aren’t available in this browser view.');
              await reg.update();
              setMsg(reg.waiting || reg.installing ? 'A new version is downloading — tap “Update now” when it appears.' : 'You have the latest version.');
            } catch {
              setMsg('Couldn’t check (offline?).');
            }
          }}
        >
          Check for update
        </Button>
        {msg && <span role="status" className="text-sm text-ink-2">{msg}</span>}
      </div>
    </Card>
  );
}
