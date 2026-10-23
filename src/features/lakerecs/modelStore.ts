import { db, getMeta, setMeta } from '../../db/local';
import { tilesFor } from './tiles';
import type { LakeModelStatus, ModelManifest, ModelTile, TileRef } from './types';

export { tilesFor };

/**
 * Lake model files on the phone (docs/LAKE_RECS_PLAN.md §4). Static files
 * from /lake-model/ are kept in `db.meta` (phone-only, never synced records):
 *   lakeModel:manifest      the manifest
 *   lakeModel:tile:<id>     one tile
 *   lakeModel:index         { [tileId]: { bytes, sha256, version, storedAt } } for cheap status
 *   lakeModel:lastCheckAt   when the server was last asked about the manifest
 * Every exported function resolves (never rejects): problems become status.
 */

export const MANIFEST_URL = '/lake-model/manifest.json';
export const MANIFEST_KEY = 'lakeModel:manifest';
export const TILE_PREFIX = 'lakeModel:tile:';
export const INDEX_KEY = 'lakeModel:index';
export const CHECK_KEY = 'lakeModel:lastCheckAt';
export const tileKey = (id: string) => `${TILE_PREFIX}${id}`;

/** Refuse anything implausibly large (a tile is ~10–100 KB; a manifest a few KB). */
const MAX_TILE_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface TileIndexEntry {
  bytes: number;
  sha256: string;
  version: string;
  storedAt: number;
}
export type TileIndex = Record<string, TileIndexEntry>;

type FetchFn = typeof fetch;
type ProblemKind = 'none' | 'offline' | 'error';
interface Problem {
  state: ProblemKind;
  message: string;
}
type Got = { ok: true; buf: ArrayBuffer } | ({ ok: false } & Problem);

// ------------------------------------------------------------ in-memory activity (for the status line)

export interface ModelActivity {
  busy: boolean;
  problem: Problem | null;
}
let activity: ModelActivity = { busy: false, problem: null };
const listeners = new Set<() => void>();

function setActivity(patch: Partial<ModelActivity>) {
  activity = { ...activity, ...patch };
  for (const l of listeners) l();
}
export const getModelActivity = (): ModelActivity => activity;
export function subscribeModelActivity(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** One download job at a time, so a refresh and a "download for this trip" never race on a tile. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const OFFLINE: Problem = { state: 'offline', message: 'Offline: using the lake model already on this phone.' };
const SIGNED_OUT: Problem = { state: 'offline', message: 'Sign in again to update the lake model.' };
const NOT_PUBLISHED: Problem = { state: 'none', message: 'Lake model not published yet.' };

function resolveUrl(url: string): string {
  const base = typeof location !== 'undefined' && location.href ? location.href : 'http://localhost/';
  return new URL(url, new URL(MANIFEST_URL, base)).toString();
}

async function get(url: string, fetchFn: FetchFn, maxBytes: number): Promise<Got> {
  let res: Response;
  try {
    res = await fetchFn(url, { credentials: 'same-origin', cache: 'no-cache', redirect: 'manual' });
  } catch {
    return { ok: false, ...OFFLINE };
  }
  // Cloudflare Access answers an expired sign-in with a redirect to its login page.
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return { ok: false, ...SIGNED_OUT };
  if (res.status === 404) return { ok: false, ...NOT_PUBLISHED };
  if (!res.ok) return { ok: false, state: 'error', message: `The server answered ${res.status}.` };
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, state: 'error', message: 'File is too large.' };
  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return { ok: false, state: 'error', message: 'File is too large.' };
    return { ok: true, buf };
  } catch {
    return { ok: false, ...OFFLINE };
  }
}

/** The single-page-app fallback serves index.html for a missing file: that means "not published". */
const looksLikeHtml = (text: string) => /^\s*</.test(text);

export async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) return null; // insecure context (plain-http dev): size check only
  const d = await subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validManifest(m: unknown): m is ModelManifest {
  const x = m as ModelManifest;
  return (
    !!x &&
    x.format === 1 &&
    typeof x.version === 'string' &&
    Array.isArray(x.species) &&
    Array.isArray(x.tiles) &&
    x.tiles.every((t) => typeof t?.id === 'string' && typeof t.url === 'string' && Array.isArray(t.bbox) && t.bbox.length === 4 && typeof t.sha256 === 'string' && typeof t.bytes === 'number')
  );
}

function validTile(t: unknown, ref: TileRef, version: string): t is ModelTile {
  const x = t as ModelTile;
  return !!x && x.format === 1 && x.id === ref.id && x.version === version && Array.isArray(x.lakes) && !!x.scale && typeof x.scale === 'object';
}

async function fetchManifest(fetchFn: FetchFn): Promise<{ ok: true; manifest: ModelManifest } | ({ ok: false } & Problem)> {
  if (isOffline()) return { ok: false, ...OFFLINE };
  const got = await get(resolveUrl(MANIFEST_URL), fetchFn, MAX_MANIFEST_BYTES);
  if (!got.ok) return got;
  const text = new TextDecoder().decode(got.buf);
  if (looksLikeHtml(text)) return { ok: false, ...NOT_PUBLISHED };
  try {
    const m: unknown = JSON.parse(text);
    if (!validManifest(m)) return { ok: false, state: 'error', message: 'The lake model list is in an unknown format.' };
    return { ok: true, manifest: m };
  } catch {
    return { ok: false, state: 'error', message: 'The lake model list could not be read.' };
  }
}

async function downloadTile(ref: TileRef, manifest: ModelManifest, fetchFn: FetchFn): Promise<{ ok: true } | ({ ok: false } & Problem)> {
  if (!(ref.bytes > 0) || ref.bytes > MAX_TILE_BYTES) return { ok: false, state: 'error', message: `Tile ${ref.id} has an implausible size.` };
  if (isOffline()) return { ok: false, ...OFFLINE };
  const got = await get(resolveUrl(ref.url), fetchFn, MAX_TILE_BYTES);
  if (!got.ok) return got.state === 'none' ? { ok: false, state: 'error', message: `Tile ${ref.id} is missing on the server.` } : got;
  if (got.buf.byteLength !== ref.bytes) return { ok: false, state: 'error', message: `Tile ${ref.id} arrived incomplete.` };
  const sha = await sha256Hex(got.buf);
  if (sha !== null && sha !== ref.sha256.toLowerCase()) return { ok: false, state: 'error', message: `Tile ${ref.id} failed its check.` };
  let tile: unknown;
  try {
    tile = JSON.parse(new TextDecoder().decode(got.buf));
  } catch {
    return { ok: false, state: 'error', message: `Tile ${ref.id} could not be read.` };
  }
  if (!validTile(tile, ref, manifest.version)) return { ok: false, state: 'error', message: `Tile ${ref.id} doesn't match the lake model version.` };
  await db.transaction('rw', db.meta, async () => {
    const index = ((await getMeta<TileIndex>(INDEX_KEY)) ?? {}) as TileIndex;
    index[ref.id] = { bytes: ref.bytes, sha256: ref.sha256, version: manifest.version, storedAt: Date.now() };
    await db.meta.put({ key: tileKey(ref.id), value: tile });
    await db.meta.put({ key: INDEX_KEY, value: index });
  });
  return { ok: true };
}

async function dropTiles(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction('rw', db.meta, async () => {
    const index = ((await getMeta<TileIndex>(INDEX_KEY)) ?? {}) as TileIndex;
    for (const id of ids) delete index[id];
    await db.meta.bulkDelete(ids.map(tileKey));
    await db.meta.put({ key: INDEX_KEY, value: index });
  });
}

/** Wrap a job: activity flag on, never reject, problems recorded for the status line. */
async function guarded<T>(job: () => Promise<T>, fallback: T): Promise<T> {
  setActivity({ busy: true });
  try {
    return await job();
  } catch (e) {
    setActivity({ problem: { state: 'error', message: e instanceof Error ? e.message : String(e) } });
    return fallback;
  } finally {
    setActivity({ busy: false });
  }
}

// ------------------------------------------------------------ public API

export const getStoredManifest = async (): Promise<ModelManifest | null> => {
  try {
    const m = await getMeta<ModelManifest>(MANIFEST_KEY);
    return validManifest(m) ? m : null;
  } catch {
    return null;
  }
};

export const getTileIndex = async (): Promise<TileIndex> => {
  try {
    return (await getMeta<TileIndex>(INDEX_KEY)) ?? {};
  } catch {
    return {};
  }
};

/** Tiles stored on the phone, in the order asked (missing ids skipped). Works offline. */
export async function loadTiles(ids: string[]): Promise<ModelTile[]> {
  if (!ids.length) return [];
  try {
    const rows = await db.meta.bulkGet(ids.map(tileKey));
    return rows.map((r) => r?.value as ModelTile | undefined).filter((t): t is ModelTile => !!t && Array.isArray(t.lakes));
  } catch {
    return [];
  }
}

export interface RefreshResult {
  status: LakeModelStatus;
  /** True when a new manifest version was found. */
  changed: boolean;
  refetched: string[];
  dropped: string[];
  failed: { id: string; why: string }[];
}

/**
 * Check the manifest; if its version changed, refetch the tiles already on
 * the phone and drop tiles the new model no longer lists. A failed tile keeps
 * its older copy (still usable) and is retried next time.
 */
export function refreshLakeModel(fetchFn: FetchFn = (...a) => fetch(...a)): Promise<RefreshResult> {
  return serial(async () => {
    const out: Omit<RefreshResult, 'status'> = { changed: false, refetched: [], dropped: [], failed: [] };
    await guarded(async () => {
      const got = await fetchManifest(fetchFn);
      if (!got.ok) {
        if (got.state !== 'offline') await setMeta(CHECK_KEY, Date.now());
        setActivity({ problem: { state: got.state, message: got.message } });
        return;
      }
      await setMeta(CHECK_KEY, Date.now());
      const old = await getStoredManifest();
      await setMeta(MANIFEST_KEY, got.manifest);
      const index = await getTileIndex();
      const listed = new Map(got.manifest.tiles.map((t) => [t.id, t]));
      out.dropped = Object.keys(index).filter((id) => !listed.has(id));
      await dropTiles(out.dropped);
      out.changed = old?.version !== got.manifest.version;
      let problem: Problem | null = null;
      // Refetch stored tiles that are stale (normally all of them after a version bump).
      for (const id of Object.keys(index)) {
        const ref = listed.get(id);
        if (!ref || (index[id]!.version === got.manifest.version && index[id]!.sha256 === ref.sha256)) continue;
        const r = await downloadTile(ref, got.manifest, fetchFn);
        if (r.ok) out.refetched.push(id);
        else {
          out.failed.push({ id, why: r.message });
          problem ??= { state: r.state, message: r.message };
        }
      }
      setActivity({ problem });
    }, undefined);
    return { ...out, status: await modelStatus() };
  });
}

export interface EnsureResult {
  status: LakeModelStatus;
  needed: string[];
  downloaded: string[];
  failed: { id: string; why: string }[];
  /** Needed tiles still not on the phone. */
  missing: string[];
}

/** Download the tiles a circle around `origin` needs that aren't stored (or are from an older model). */
export function ensureTilesFor(origin: { lat: number; lng: number }, radiusKm: number, fetchFn: FetchFn = (...a) => fetch(...a)): Promise<EnsureResult> {
  return serial(async () => {
    const out: Omit<EnsureResult, 'status'> = { needed: [], downloaded: [], failed: [], missing: [] };
    await guarded(async () => {
      let manifest = await getStoredManifest();
      if (!manifest) {
        const got = await fetchManifest(fetchFn);
        if (!got.ok) {
          setActivity({ problem: { state: got.state, message: got.message } });
          return;
        }
        manifest = got.manifest;
        await setMeta(MANIFEST_KEY, manifest);
        await setMeta(CHECK_KEY, Date.now());
      }
      out.needed = tilesFor(origin, radiusKm, manifest);
      const index = await getTileIndex();
      let problem: Problem | null = null;
      for (const id of out.needed) {
        const ref = manifest.tiles.find((t) => t.id === id)!;
        if (index[id]?.version === manifest.version && index[id]?.sha256 === ref.sha256) continue;
        const r = await downloadTile(ref, manifest, fetchFn);
        if (r.ok) out.downloaded.push(id);
        else {
          out.failed.push({ id, why: r.message });
          problem ??= { state: r.state, message: r.message };
        }
      }
      const after = await getTileIndex();
      out.missing = out.needed.filter((id) => !after[id]);
      setActivity({ problem });
    }, undefined);
    return { ...out, status: await modelStatus() };
  });
}

/** Combine what's stored with what's happening now (pure, for tests and the hook). */
export function composeStatus(manifest: ModelManifest | null, index: TileIndex, act: ModelActivity): LakeModelStatus {
  const entries = Object.values(index);
  const base = {
    version: manifest?.version ?? null,
    createdAt: manifest?.createdAt ?? null,
    tilesOnPhone: entries.length,
    bytesOnPhone: entries.reduce((s, e) => s + (e.bytes || 0), 0),
  };
  if (act.busy) return { ...base, state: manifest ? 'updating' : 'loading' };
  const p = act.problem;
  if (p?.state === 'offline') return { ...base, state: 'offline', message: p.message };
  if (p?.state === 'error') return { ...base, state: 'error', message: p.message };
  if (!manifest) return { ...base, state: 'none', message: NOT_PUBLISHED.message };
  // A manifest that has since vanished from the server: keep using the copy on the phone.
  return { ...base, state: 'ready' };
}

export async function modelStatus(): Promise<LakeModelStatus> {
  return composeStatus(await getStoredManifest(), await getTileIndex(), activity);
}

/** Test helper: forget in-memory activity. */
export function resetModelActivity(): void {
  activity = { busy: false, problem: null };
}
