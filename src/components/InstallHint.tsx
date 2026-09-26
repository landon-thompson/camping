import { useState } from 'react';
import { IS_PREVIEW } from '../lib/preview';

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * iOS only keeps offline data reliably for apps added to the Home Screen;
 * Safari tabs can have their storage cleared after about a week unused.
 */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem('installHintHidden') === '1';
    } catch {
      return false;
    }
  });
  if (IS_PREVIEW || hidden || isStandalone() || !isIos()) return null;
  return (
    <div role="note" className="rounded-2xl border border-warn bg-warn-bg p-4 text-ink">
      <p className="font-semibold">Add this app to your Home Screen</p>
      <p className="mt-1 text-sm">
        In Safari, tap <strong>Share</strong> (square with arrow) → <strong>Add to Home Screen</strong>. Then open it from
        the icon. That’s what lets trips, checklists and maps work with no signal — iPhone can clear data for sites that
        stay as a Safari tab.
      </p>
      <button
        type="button"
        className="mt-2 min-h-11 font-semibold text-brand"
        onClick={() => {
          try {
            sessionStorage.setItem('installHintHidden', '1');
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        Not now
      </button>
    </div>
  );
}
