import { afterEach, describe, expect, it } from 'vitest';
import {
  blobPathFor,
  containerName,
  isAllowedContentType,
  isPathInHousehold,
  requireConnectionString,
  StorageNotConfiguredError,
} from './filesConfig';

describe('containerName', () => {
  afterEach(() => {
    delete process.env.PHOTO_CONTAINER;
  });

  it('defaults to "photos"', () => {
    expect(containerName()).toBe('photos');
  });

  it('honours PHOTO_CONTAINER', () => {
    process.env.PHOTO_CONTAINER = 'trip-photos';
    expect(containerName()).toBe('trip-photos');
  });

  it('ignores a blank override', () => {
    process.env.PHOTO_CONTAINER = '   ';
    expect(containerName()).toBe('photos');
  });
});

describe('requireConnectionString', () => {
  afterEach(() => {
    delete process.env.STORAGE_CONNECTION_STRING;
  });

  it('throws a friendly, actionable error when unset', () => {
    delete process.env.STORAGE_CONNECTION_STRING;
    expect(() => requireConnectionString()).toThrow(StorageNotConfiguredError);
    expect(() => requireConnectionString()).toThrow(/STORAGE_CONNECTION_STRING/);
  });

  it('returns the connection string when set', () => {
    process.env.STORAGE_CONNECTION_STRING = 'fake-conn-str';
    expect(requireConnectionString()).toBe('fake-conn-str');
  });
});

describe('blobPathFor', () => {
  it('builds <household>/photos/<id>.jpg from a well-formed photo id', () => {
    expect(blobPathFor('family', 'photo:abc-123')).toBe('family/photos/abc-123.jpg');
  });

  it('rejects ids that are not photo:* or contain unsafe characters', () => {
    expect(blobPathFor('family', 'gear:abc')).toBeNull();
    expect(blobPathFor('family', 'photo:')).toBeNull();
    expect(blobPathFor('family', 'photo:../../etc/passwd')).toBeNull();
    expect(blobPathFor('family', 'photo:has space')).toBeNull();
    expect(blobPathFor('family', 'not-even-close')).toBeNull();
  });
});

describe('isPathInHousehold', () => {
  it('accepts a well-formed path under the household prefix', () => {
    expect(isPathInHousehold('family/photos/abc-123.jpg', 'family')).toBe(true);
  });

  it('rejects traversal, another household, missing extension and non-strings', () => {
    expect(isPathInHousehold('family/photos/../../secrets.jpg', 'family')).toBe(false);
    expect(isPathInHousehold('other-household/photos/abc.jpg', 'family')).toBe(false);
    expect(isPathInHousehold('family/photos/abc-123.png', 'family')).toBe(false);
    expect(isPathInHousehold('family/photos/abc 123.jpg', 'family')).toBe(false);
    expect(isPathInHousehold('', 'family')).toBe(false);
    expect(isPathInHousehold(undefined, 'family')).toBe(false);
    expect(isPathInHousehold(42, 'family')).toBe(false);
    expect(isPathInHousehold('family/photos/' + 'a'.repeat(400) + '.jpg', 'family')).toBe(false);
  });
});

describe('isAllowedContentType', () => {
  it('allows only image/jpeg (the pipeline always resizes to jpeg)', () => {
    expect(isAllowedContentType('image/jpeg')).toBe(true);
    expect(isAllowedContentType('image/png')).toBe(false);
    expect(isAllowedContentType('text/html')).toBe(false);
    expect(isAllowedContentType(undefined)).toBe(false);
  });
});
