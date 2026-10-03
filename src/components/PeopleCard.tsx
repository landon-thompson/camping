import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/apiFetch';
import { Button, Card } from './ui';

interface Person {
  email: string;
  household: string;
  firstSeen: number;
  lastSeen: number;
  visits: number;
}

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Owner only (Cloudflare): everyone who has signed in with an email code. */
export function PeopleCard() {
  const { auth } = useAuth();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (auth?.kind !== 'signed-in' || !auth.user.owner) return null;

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/people', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { people?: Person[]; error?: string };
      if (res.status === 401) throw new Error('Your sign-in expired — sign in again.');
      if (!res.ok || !body.people) throw new Error(body.error ?? `HTTP ${res.status}`);
      setPeople(body.people);
    } catch (e) {
      setError(e instanceof TypeError ? 'Couldn’t reach the server (offline?).' : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="People who signed in">
      <p className="text-sm text-ink-2">
        Anyone can request an email code. Emails you list in the <strong>FAMILY_EMAILS</strong> setting share your trips; everyone else gets their own
        empty space. To block someone, add a Block rule in Cloudflare Zero Trust → Access.
      </p>
      {people && (
        <ul className="mt-3 divide-y divide-line">
          {people.map((p) => (
            <li key={p.email} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 break-all font-semibold">{p.email}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${p.household === 'family' ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-ink-2'}`}>
                  {p.household === 'family' ? 'Family' : 'Own space'}
                </span>
              </div>
              <p className="text-sm text-ink-2">
                First {when(p.firstSeen)} · last {when(p.lastSeen)} · {p.visits} visit{p.visits === 1 ? '' : 's'}
              </p>
            </li>
          ))}
          {!people.length && <li className="py-2 text-ink-2">No one yet.</li>}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-warn">
          {error}
        </p>
      )}
      <div className="mt-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
          {busy ? 'Loading…' : people ? 'Refresh' : 'Show people'}
        </Button>
      </div>
    </Card>
  );
}
