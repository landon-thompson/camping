import { useState } from 'react';
import { Button, inputClass } from '../../components/ui';
import { Card, PageTitle } from '../../components/ui';
import { SdLakeFishing } from './SdLakeFishing';
import { sdLakeKey, sdWaterFromKey } from './sdReport';
import type { NearbyLake } from '../../model/schemas';
import { LakeFishing } from './LakeFishing';
import { LakePicker } from './LakePicker';
import { ToolsSubNav } from '../gear/nav';

const KEY = 'fishingLakes';

function readSaved(): NearbyLake[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((l): l is NearbyLake => !!l && typeof l === 'object' && /^(\d{8}|sd:.+)$/.test((l as NearbyLake).dow)) : [];
  } catch {
    return [];
  }
}

/** Tools › Fishing: fish surveys for any Minnesota (DNR) or South Dakota (GFP) lake, no trip needed. The list is kept on this phone. */
export function FishingPage() {
  const [lakes, setLakesState] = useState<NearbyLake[]>(readSaved);
  const [open, setOpen] = useState<string | null>(() => readSaved()[0]?.dow ?? null);
  const [state, setState] = useState<'MN' | 'SD'>('MN');
  const [sdName, setSdName] = useState('');
  const setLakes = (next: NearbyLake[]) => {
    setLakesState(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: list lasts for this visit */
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle sub="Fish surveys for any Minnesota or South Dakota lake.">Fishing</PageTitle>
      <ToolsSubNav />
      <Card>
        <div role="group" aria-label="State" className="mb-3 grid grid-cols-2 gap-2">
          {(['MN', 'SD'] as const).map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={state === st}
              onClick={() => setState(st)}
              className={`min-h-11 rounded-full border text-sm font-semibold ${state === st ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
            >
              {st === 'MN' ? 'Minnesota' : 'South Dakota'}
            </button>
          ))}
        </div>
        {state === 'MN' ? (
          <LakePicker
            selected={lakes.map((l) => l.dow)}
            onPick={(lake) => {
              if (!lakes.some((l) => l.dow === lake.dow)) setLakes([lake, ...lakes]);
              setOpen(lake.dow);
            }}
          />
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = sdName.trim();
              if (name.length < 2) return;
              const key = sdLakeKey(name);
              if (!lakes.some((l) => l.dow === key)) setLakes([{ dow: key, name, county: 'South Dakota' }, ...lakes]);
              setOpen(key);
              setSdName('');
            }}
          >
            <label className="block min-w-0 flex-1 text-sm">
              <span className="mb-1 block font-semibold text-ink-2">South Dakota lake</span>
              <input className={inputClass} value={sdName} placeholder="e.g. Enemy Swim, Lake Poinsett" enterKeyHint="go" onChange={(e) => setSdName(e.target.value)} />
            </label>
            <Button type="submit" variant="secondary" disabled={sdName.trim().length < 2}>
              Add
            </Button>
          </form>
        )}
      </Card>

      {lakes.length > 0 && (
        <Card title="Your lakes">
          <ul className="flex flex-wrap gap-2">
            {lakes.map((l) => (
              <li key={l.dow} className="flex items-center">
                <button
                  type="button"
                  aria-pressed={open === l.dow}
                  onClick={() => setOpen(open === l.dow ? null : l.dow)}
                  className={`min-h-11 rounded-l-full border px-4 text-sm font-semibold ${open === l.dow ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink'}`}
                >
                  {l.name}
                  {l.county && <span className="font-normal"> · {l.county}</span>}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => {
                    setLakes(lakes.filter((x) => x.dow !== l.dow));
                    if (open === l.dow) setOpen(null);
                  }}
                  className="min-h-11 min-w-11 rounded-r-full border border-l-0 border-line bg-surface-2 text-ink-2"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {open &&
        (sdWaterFromKey(open) ? (
          <SdLakeFishing key={open} water={sdWaterFromKey(open)!} />
        ) : (
          <LakeFishing key={open} dow={open} name={lakes.find((l) => l.dow === open)?.name ?? `Lake ${open}`} />
        ))}
      {!lakes.length && <p className="text-ink-2">Search for a lake above. Lakes you add stay on this phone for next time.</p>}
    </div>
  );
}
