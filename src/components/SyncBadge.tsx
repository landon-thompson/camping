import { Link } from 'react-router-dom';
import { useSyncStatus } from '../sync/useSync';
import { loginUrl } from '../auth/identity';
import type { SyncState } from '../sync/engine';

/** Short, single-line labels for the header pill — full detail lives on Settings → Sync. */
const label: Record<SyncState, string> = {
  idle: 'Starting…',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  'signed-out': 'Sign in',
  'not-invited': 'Not invited',
  waking: 'Waking…',
  'local-only': 'On phone',
  error: 'Sync error',
};

const dot: Record<SyncState, string> = {
  idle: 'bg-ink-2',
  syncing: 'bg-info animate-pulse',
  synced: 'bg-ok',
  offline: 'bg-ink-2',
  'signed-out': 'bg-warn',
  'not-invited': 'bg-bad',
  waking: 'bg-warn animate-pulse',
  'local-only': 'bg-ink-2',
  error: 'bg-bad',
};

/** Header sync-status pill. Links to Settings → Sync, which has the full status and a manual sync button. */
export function SyncBadge() {
  const s = useSyncStatus();
  const cls = 'flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-sm font-semibold';
  const inner = (
    <>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot[s.state]}`} aria-hidden />
      <span>{label[s.state]}</span>
      {s.pending > 0 && s.state !== 'local-only' && <span className="rounded-full bg-surface-2 px-2 text-xs">{s.pending}</span>}
    </>
  );
  // Expired sign-in: the pill goes straight to the Microsoft sign-in page.
  if (s.state === 'signed-out') {
    return (
      <a href={loginUrl()} className={cls} aria-label={`${describeSync(s.state)} Sign in again.`}>
        {inner}
      </a>
    );
  }
  return (
    <Link
      to="/settings"
      className={cls}
      aria-label={`Sync status: ${describeSync(s.state, s.message)}${s.pending ? ` ${s.pending} changes waiting.` : ''} Open Settings.`}
    >
      {inner}
    </Link>
  );
}

export function describeSync(state: SyncState, message?: string): string {
  switch (state) {
    case 'synced':
      return 'Everything on this phone is backed up and shared with your family.';
    case 'offline':
      return 'No connection. Keep going — changes are saved on this phone and will sync when you’re back in service.';
    case 'signed-out':
      return 'Your session ended. Your data is safe on this phone; sign in again to sync.';
    case 'not-invited':
      return message ?? 'This account isn’t invited yet.';
    case 'waking':
      return 'The free database pauses when idle and takes about a minute to wake. Retrying automatically.';
    case 'local-only':
      return 'Sync isn’t set up, so everything is saved on this phone only. Use Settings → Backup to keep a copy.';
    case 'error':
      return message ?? 'Something went wrong while syncing. It will retry.';
    default:
      return 'Checking…';
  }
}
