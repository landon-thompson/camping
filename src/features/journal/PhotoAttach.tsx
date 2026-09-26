import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/local';
import { deleteRecord, newId, saveRecord, useRecord } from '../../db/records';
import { Button } from '../../components/ui';
import type { Photo } from '../../model/schemas';
import { resizeImageToJpeg } from './imageResize';
import { startPhotoUploadQueue } from './photoUpload';

const CAPTION_SAVE_MS = 500;

function PhotoThumb({ id, onRemove }: { id: string; onRemove: () => void }) {
  const rec = useRecord('photo', id);
  const [url, setUrl] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [caption, setCaption] = useState('');
  const captionInitialized = useRef(false);
  const dataRef = useRef<Photo | undefined>(rec.data);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dataRef.current = rec.data;
    if (!captionInitialized.current && rec.data) {
      captionInitialized.current = true;
      setCaption(rec.data.caption);
    }
  }, [rec.data]);

  // Prefer the blob already on this phone; otherwise fetch it once via a
  // signed read URL and cache it locally so the next view is instant/offline.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    async function load() {
      const local = await db.blobs.get(id);
      if (local) {
        objectUrl = URL.createObjectURL(local.blob);
        if (!cancelled) setUrl(objectUrl);
        return;
      }
      const blobPath = rec.data?.blobPath;
      if (!blobPath) return;
      try {
        const res = await fetch(`/api/files/read-url?path=${encodeURIComponent(blobPath)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('read-url failed');
        const { readUrl } = (await res.json()) as { readUrl: string };
        const imgRes = await fetch(readUrl);
        if (!imgRes.ok) throw new Error('image fetch failed');
        const blob = await imgRes.blob();
        await db.blobs.put({ id, blob, contentType: rec.data?.contentType ?? blob.type, createdAt: Date.now() });
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setFetchFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, rec.data?.blobPath, rec.data?.contentType]);

  function onCaptionChange(text: string) {
    setCaption(text);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (dataRef.current) void saveRecord('photo', id, { ...dataRef.current, caption: text });
    }, CAPTION_SAVE_MS);
  }

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Move focus into the lightbox and let Escape close it, so it works for
  // keyboard and screen-reader users, not just a tap on the backdrop.
  useEffect(() => {
    if (!enlarged) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnlarged(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);

  const alt = caption || 'Trip photo';

  return (
    <div className="w-28 shrink-0">
      <button
        type="button"
        onClick={() => url && setEnlarged(true)}
        aria-label={url ? `View photo${caption ? `: ${caption}` : ''}` : 'Photo not available offline yet'}
        disabled={!url}
        className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2"
      >
        {url ? (
          <img src={url} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <span className="px-1 text-center text-xs text-ink-2">{fetchFailed ? 'Unavailable offline' : 'Loading…'}</span>
        )}
      </button>
      <input
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
        placeholder="Caption"
        aria-label="Photo caption"
        className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-xs text-ink placeholder:text-ink-2/60"
      />
      <button
        type="button"
        onClick={onRemove}
        className="mt-1 min-h-11 w-full rounded-lg text-xs font-semibold text-warn hover:bg-warn-bg"
      >
        Remove
      </button>
      {enlarged && url && (
        <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <button
            type="button"
            aria-label={`Close ${alt}`}
            onClick={() => setEnlarged(false)}
            className="absolute inset-0 h-full w-full cursor-default"
          />
          <img src={url} alt={alt} className="pointer-events-none relative max-h-full max-w-full rounded-xl object-contain" />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setEnlarged(false)}
            aria-label="Close photo"
            className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface text-xl text-ink"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Reusable photo picker: file input → resize to ≤1600px JPEG on-device → store
 * locally, with a background queue uploading to Blob Storage when possible.
 * `value` is the list of `photo:*` record ids; the caller owns that list.
 */
export function PhotoAttach({ value, onChange, tripId }: { value: string[]; onChange: (ids: string[]) => void; tripId: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    startPhotoUploadQueue();
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const added: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const { blob, width, height } = await resizeImageToJpeg(file, 1600, 0.8);
        const id = newId('photo');
        await db.blobs.put({ id, blob, contentType: 'image/jpeg', createdAt: Date.now() });
        const data: Photo = {
          blobPath: null,
          tripId,
          caption: '',
          takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          contentType: 'image/jpeg',
          width,
          height,
        };
        await saveRecord('photo', id, data);
        added.push(id);
      } catch {
        // Skip a file the browser couldn't decode; the rest still get added.
      }
    }
    if (added.length > 0) onChange([...value, ...added]);
    if (inputRef.current) inputRef.current.value = '';
    setBusy(false);
  }

  async function remove(id: string) {
    onChange(value.filter((v) => v !== id));
    await deleteRecord(id);
    await db.blobs.delete(id);
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {value.map((id) => (
            <PhotoThumb key={id} id={id} onRemove={() => void remove(id)} />
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void handleFiles(e.target.files)}
        className="hidden"
      />
      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? 'Adding…' : 'Add photos'}
      </Button>
    </div>
  );
}
