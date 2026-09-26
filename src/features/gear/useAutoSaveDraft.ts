import { useEffect, useRef, useState } from 'react';
import { saveRecord } from '../../db/records';
import type { RecordData, RecordType } from '../../model/schemas';

/**
 * Local draft of a record that autosaves ~400ms after edits stop, instead of
 * requiring a Save button. Mirrors an external change (e.g. a sync from the
 * other phone) as long as there's no unsaved local edit in flight.
 */
export function useAutoSaveDraft<T extends RecordType>(
  type: T,
  id: string,
  initial: RecordData<T>,
  delayMs = 400,
): [RecordData<T>, (v: RecordData<T>) => void] {
  const [draft, setDraft] = useState(initial);
  const baseRef = useRef(initial);
  const dirtyRef = useRef(false);
  const initialJson = JSON.stringify(initial);

  useEffect(() => {
    if (JSON.stringify(baseRef.current) === initialJson) return;
    if (!dirtyRef.current) setDraft(initial);
    baseRef.current = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(baseRef.current)) return;
    dirtyRef.current = true;
    const t = setTimeout(() => {
      void saveRecord(type, id, draft).then(() => {
        baseRef.current = draft;
        dirtyRef.current = false;
      });
    }, delayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft)]);

  return [draft, setDraft];
}
