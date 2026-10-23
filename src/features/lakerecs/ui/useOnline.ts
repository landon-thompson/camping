import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Live `navigator.onLine` (true when unknown). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
    () => true,
  );
}
