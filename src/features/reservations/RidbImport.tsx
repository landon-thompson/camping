import { useState } from 'react';
import { Button, Card, inputClass } from '../../components/ui';
import { searchRidbFacilities, type RidbSearchResult } from './ridbSearch';

/**
 * "Search Recreation.gov (RIDB)" — looks up federal facilities through our own
 * `/api/ridb/facilities` proxy (never calls Recreation.gov/RIDB from the
 * browser) and lets you pick one to prefill a new campground record with.
 * Shows a clear message when the server has no API key configured, or when
 * the phone is offline.
 */
export function RidbImport({ onImport }: { onImport: (facility: RidbSearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RidbSearchResult[]>([]);
  const [importedId, setImportedId] = useState<string | null>(null);

  const search = async () => {
    if (!navigator.onLine) {
      setStatus('error');
      setError('You’re offline — Recreation.gov search needs a connection. Add this campground manually below instead.');
      return;
    }
    setStatus('loading');
    setError(null);
    const outcome = await searchRidbFacilities(query);
    if (outcome.ok) {
      setResults(outcome.results);
      setStatus('done');
    } else {
      setStatus('error');
      setError(outcome.error);
    }
  };

  return (
    <Card title="Search Recreation.gov (RIDB)">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="Campground or forest name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          aria-label="Search Recreation.gov"
        />
        <Button type="button" variant="secondary" onClick={() => void search()} disabled={status === 'loading'}>
          Search
        </Button>
      </div>

      {status === 'error' && error && (
        <p role="alert" className="mt-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {error}
        </p>
      )}

      {status === 'done' && results.length === 0 && <p className="mt-3 text-ink-2">No federal facilities matched that search.</p>}

      {results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((f) => (
            <li key={f.id} className="rounded-xl border border-line p-3">
              <p className="font-semibold">{f.name}</p>
              {f.description && <p className="mt-1 text-sm text-ink-2">{f.description}</p>}
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => {
                  onImport(f);
                  setImportedId(f.id);
                }}
              >
                {importedId === f.id ? 'Used ✓' : 'Use this'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
