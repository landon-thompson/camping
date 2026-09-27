import { useState } from 'react';
import { Button, inputClass } from '../../components/ui';
import type { NearbyLake } from '../../model/schemas';
import { viaAppServer } from '../reservations/stateParks';
import { fetchLakesByName, formatDow, parseDowInput } from './lakeSurvey';

/** Find any Minnesota lake: type a name (LakeFinder search), or paste a LakeFinder link / DNR lake number. */
export function LakePicker({ onPick, selected = [] }: { onPick: (lake: NearbyLake) => void; selected?: string[] }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<NearbyLake[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    const dow = parseDowInput(text);
    if (dow) {
      onPick({ dow, name: `Lake ${formatDow(dow)}`, county: '' });
      setText('');
      setResults(null);
      setMsg(null);
      return;
    }
    if (text.trim().length < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const found = await fetchLakesByName(text, viaAppServer);
      setResults(found);
      if (!found.length) setMsg(`No Minnesota lake named “${text.trim()}” in LakeFinder. Try part of the name, or paste its LakeFinder link.`);
    } catch (e) {
      setResults(null);
      setMsg(`Lake search didn’t answer (${e instanceof Error ? e.message : String(e)}). You can paste the lake’s LakeFinder link instead.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block min-w-0 flex-1 text-sm">
          <span className="mb-1 block font-semibold text-ink-2">Find any lake</span>
          <input
            className={inputClass}
            value={text}
            placeholder="Lake name, LakeFinder link or lake number"
            enterKeyHint="search"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={busy || text.trim().length < 2}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>
      {msg && <p className="text-sm text-warn">{msg}</p>}
      {results && results.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {results.slice(0, 30).map((l) => {
            const on = selected.includes(l.dow);
            return (
              <li key={l.dow}>
                <button
                  type="button"
                  disabled={on}
                  onClick={() => {
                    onPick(l);
                    setResults(null);
                    setText('');
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{l.name}</span>
                    <span className="block text-sm text-ink-2">{[l.county && `${l.county} County`, formatDow(l.dow)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-brand">{on ? 'Added ✓' : 'Add'}</span>
                </button>
              </li>
            );
          })}
          {results.length > 30 && <li className="px-3 py-2 text-sm text-ink-2">{results.length - 30} more — add the county or more of the name to narrow it.</li>}
        </ul>
      )}
    </div>
  );
}
