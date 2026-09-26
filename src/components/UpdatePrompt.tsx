import { useRegisterSW } from 'virtual:pwa-register/react';

/** Shows a bar when a new version of the app has been downloaded. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new version hourly while the app is open.
      if (reg) setInterval(() => void reg.update(), 60 * 60_000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div role="region" aria-label="App update" aria-live="polite" className="fixed inset-x-3 bottom-24 z-50 rounded-2xl bg-ink p-4 text-bg shadow-lg">
      <p className="font-semibold">A new version is ready.</p>
      <div className="mt-2 flex gap-3">
        <button className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-brand-ink" onClick={() => void updateServiceWorker(true)}>
          Update now
        </button>
        <button className="min-h-11 px-2 font-semibold" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  );
}
