import { useState } from 'react';
import { Button } from '../../../components/ui';
import type { LakeModelStatus } from '../types';
import { statusView } from './format';

/** "Lake model 2026.10 · updated …", plus Download / Update buttons and a clear offline state. Never blocks the list. */
export function ModelStatusLine({
  status,
  missingTiles,
  online,
  onDownload,
  onUpdate,
  downloadLabel = 'Download lakes for this trip',
}: {
  status: LakeModelStatus;
  missingTiles: number;
  online: boolean;
  onDownload: () => Promise<void>;
  onUpdate: () => Promise<void>;
  downloadLabel?: string;
}) {
  const [busy, setBusy] = useState<'download' | 'update' | null>(null);
  const v = statusView(status, missingTiles, online);
  const run = async (which: 'download' | 'update', fn: () => Promise<void>) => {
    setBusy(which);
    try {
      await fn();
    } catch {
      /* the hook reports failures through status.state = 'error' */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`rounded-xl p-3 text-sm ${v.offline ? 'bg-warn-bg' : 'bg-surface-2'}`} role="status">
      <p className={`font-semibold ${v.offline ? 'text-warn' : 'text-ink'}`}>
        {v.offline && <span aria-hidden>⚠ </span>}
        {v.text}
      </p>
      {v.note && <p className={v.offline ? 'text-warn' : 'text-ink-2'}>{v.note}</p>}
      {(v.canDownload || v.canUpdate) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {v.canDownload && (
            <Button type="button" className="min-h-11" disabled={!!busy} onClick={() => void run('download', onDownload)}>
              {busy === 'download' ? 'Downloading…' : downloadLabel}
            </Button>
          )}
          {v.canUpdate && (
            <Button type="button" variant="ghost" className="min-h-11 px-1" disabled={!!busy} onClick={() => void run('update', onUpdate)}>
              {busy === 'update' ? 'Checking…' : 'Update model'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
