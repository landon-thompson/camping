import { describe, expect, it } from 'vitest';
import { recordSchemas } from '../model/schemas';
import { SEED_RECORDS } from './seed';

describe('seed data', () => {
  it('matches the record schemas and uses unique ids', () => {
    for (const s of SEED_RECORDS) expect(() => recordSchemas[s.type].parse(s.data)).not.toThrow();
    expect(new Set(SEED_RECORDS.map((s) => s.id)).size).toBe(SEED_RECORDS.length);
  });

  it('never presents unverified vehicle numbers as verified', () => {
    for (const s of SEED_RECORDS) {
      for (const v of Object.values(s.data as Record<string, unknown>)) {
        if (v && typeof v === 'object' && 'status' in v) expect((v as { status: string }).status).not.toBe('verified');
      }
    }
  });
});
