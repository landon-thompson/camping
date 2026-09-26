import type { RecordData, RecordType } from '../model/schemas';

export interface SeedRecord<T extends RecordType = RecordType> {
  type: T;
  id: string;
  data: RecordData<T>;
}

/** Helper that keeps `type` and `data` in sync. */
export function seed<T extends RecordType>(type: T, id: string, data: RecordData<T>): SeedRecord<T> {
  return { type, id, data };
}
