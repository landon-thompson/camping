import { useState } from 'react';
import { Card, PageTitle } from '../../components/ui';
import type { NearbyLake } from '../../model/schemas';
import { LakeFishing } from './LakeFishing';
import { LakePicker } from './LakePicker';
import { ToolsSubNav } from '../gear/nav';
import { SD_FISHERY_REPORTS } from './lakeList';

const KEY = 'fishingLakes';

function readSaved(): NearbyLake[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((l): l is NearbyLake => !!l && typeof l === 'object' && /^\d{8}$/.test((l as NearbyLake).dow)) : [];
  } catch {
    return [];
  }
}

/** Tools › Fishing: DNR fish surveys for any Minnesota lake, no trip needed. The list is kept on this phone. */
export function FishingPage() {
  const [lakes, setLakesState] = useState<NearbyLake[]>(readSaved);
  const [open, setOpen] = useState<string | null>(() => readSaved()[0]?.dow ?? null);
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
      <PageTitle sub="DNR fish surveys for any Minnesota lake.">Fishing</PageTitle>
      <ToolsSubNav />
      <Card>
        <LakePicker
          selected={lakes.map((l) => l.dow)}
          onPick={(lake) => {
            if (!lakes.some((l) => l.dow === lake.dow)) setLakes([lake, ...lakes]);
            setOpen(lake.dow);
          }}
        />
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

      {open && <LakeFishing key={open} dow={open} name={lakes.find((l) => l.dow === open)?.name ?? `Lake ${open}`} />}
      {!lakes.length && <p className="text-ink-2">Search for a lake above. Lakes you add stay on this phone for next time.</p>}
      <p className="text-sm text-ink-2">
        South Dakota lake?{' '}
        <a href={SD_FISHERY_REPORTS} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
          GFP Fishery Reports ↗
        </a>{' '}
        has its lake surveys (search the lake name).
      </p>
    </div>
  );
}
