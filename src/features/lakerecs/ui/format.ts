import type { Confidence, FactorKey, LakeModelStatus, RankMode } from '../types';

/**
 * Species picker order when the engine doesn't say otherwise (owner's open
 * question §10.3 — reorder here once answered). Codes are DNR species codes.
 */
export const DEFAULT_SPECIES = ['WAE', 'NOP', 'BLC', 'BLG', 'YEP', 'LMB', 'SMB', 'MUE'] as const;

export const MODES: { key: RankMode; label: string; hint: string }[] = [
  { key: 'safe', label: 'Safe bet', hint: 'Ranks by the low end of each lake’s range, so lakes we’re sure about come first.' },
  { key: 'expected', label: 'Best expected', hint: 'Ranks by the middle guess for each lake.' },
  { key: 'adventurous', label: 'Adventurous', hint: 'Gives less-known lakes a chance: each roll picks a believable value from every lake’s range.' },
];

export const FACTOR_LABEL: Record<FactorKey, string> = {
  fish: 'Fish',
  drive: 'Drive',
  launch: 'Launch',
  season: 'Season (estimate)',
  family: 'Your history',
};

export const CONFIDENCE: Record<Confidence, { label: string; cls: string }> = {
  high: { label: 'Quite sure', cls: 'bg-ok/15 text-ok' },
  medium: { label: 'Fairly sure', cls: 'bg-info-bg text-info' },
  low: { label: 'Rough guess', cls: 'bg-warn-bg text-warn' },
};

export const miles = (km: number) => `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi`;

/** "about 25 min", "about 1 h 10 min". */
export function driveText(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `about ${h} h ${rest} min` : `about ${h} h`;
}

/** "+6.5 pts", "−3 pts", "0 pts". */
export function pointsText(p: number): string {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return '0 pts';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)} pts`;
}

// ------------------------------------------------------------ per-trip picker memory

export interface RecPrefs {
  species: string;
  mode: RankMode;
}

const isMode = (m: unknown): m is RankMode => m === 'safe' || m === 'expected' || m === 'adventurous';

/** Parse remembered species/mode; anything odd falls back to the defaults. */
export function parsePrefs(raw: string | null, species: readonly string[], fallback: RecPrefs): RecPrefs {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<RecPrefs> | null;
    return {
      species: typeof v?.species === 'string' && species.includes(v.species) ? v.species : fallback.species,
      mode: isMode(v?.mode) ? v.mode : fallback.mode,
    };
  } catch {
    return fallback;
  }
}

export function readPrefs(key: string, species: readonly string[], fallback: RecPrefs): RecPrefs {
  try {
    return parsePrefs(localStorage.getItem(key), species, fallback);
  } catch {
    return fallback;
  }
}

export function writePrefs(key: string, p: RecPrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* private mode: remembered for this visit only */
  }
}

// ------------------------------------------------------------ model status line

export interface StatusView {
  /** Main line, e.g. "Lake model 2026.10 · updated Oct 3, 2026". */
  text: string;
  /** Second line (offline note, size on phone, error). */
  note: string | null;
  notPublished: boolean;
  offline: boolean;
  busy: boolean;
  canUpdate: boolean;
  canDownload: boolean;
}

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function statusView(s: LakeModelStatus, missingTiles: number, online: boolean): StatusView {
  const offline = !online || s.state === 'offline';
  const busy = s.state === 'loading' || s.state === 'updating';
  const notPublished = s.state === 'none' && !s.version;
  let text: string;
  if (s.version) text = `Lake model ${s.version}${s.createdAt ? ` · updated ${fmtDay(s.createdAt)}` : ''}`;
  else if (notPublished) text = 'Lake model not published yet';
  else if (busy) text = 'Loading the lake model…';
  else if (offline) text = 'No lake model on this phone yet';
  else text = 'Lake model';

  let note: string | null = null;
  if (s.state === 'error') note = s.message ? `Couldn’t update: ${s.message}` : 'Couldn’t update the lake model.';
  else if (offline && missingTiles > 0) note = 'Offline — connect to download the lakes for this area.';
  else if (offline) note = s.tilesOnPhone ? 'Offline — using the lakes saved on this phone.' : 'Offline — connect once to download lakes.';
  else if (s.state === 'updating') note = 'Checking for a newer model…';
  else if (s.tilesOnPhone > 0) note = `${s.tilesOnPhone} area${s.tilesOnPhone === 1 ? '' : 's'} saved on this phone (${kb(s.bytesOnPhone)})`;
  else if (notPublished) note = 'Once it’s published, the best lakes near your campsite show here.';

  return {
    text,
    note,
    notPublished,
    offline,
    busy,
    canUpdate: !offline && !busy && !notPublished,
    canDownload: !offline && !busy && missingTiles > 0,
  };
}
