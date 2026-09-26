type Listener = () => void;
const listeners = new Set<Listener>();

/** Tell the sync engine that something changed locally (it debounces). */
export function notifyLocalChange(): void {
  for (const l of listeners) l();
}

export function onLocalChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
