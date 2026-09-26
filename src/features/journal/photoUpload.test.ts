import { describe, expect, it } from 'vitest';
import { RETRY_BASE_MS, RETRY_MAX_MS, needsUpload, nextBackoffDelay } from './photoUpload';

describe('needsUpload', () => {
  it('is true only while blobPath is null', () => {
    expect(needsUpload({ blobPath: null })).toBe(true);
    expect(needsUpload({ blobPath: 'family/photos/a.jpg' })).toBe(false);
  });
});

describe('nextBackoffDelay', () => {
  it('starts at the base delay', () => {
    expect(nextBackoffDelay(undefined)).toBe(RETRY_BASE_MS);
  });

  it('doubles on each subsequent failure', () => {
    let delay = nextBackoffDelay(undefined);
    delay = nextBackoffDelay(delay);
    expect(delay).toBe(RETRY_BASE_MS * 2);
    delay = nextBackoffDelay(delay);
    expect(delay).toBe(RETRY_BASE_MS * 4);
  });

  it('caps at the maximum delay', () => {
    let delay: number | undefined = undefined;
    for (let i = 0; i < 20; i++) delay = nextBackoffDelay(delay);
    expect(delay).toBe(RETRY_MAX_MS);
  });
});
