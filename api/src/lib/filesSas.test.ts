import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { describe, expect, it } from 'vitest';
import { READ_SAS_MINUTES, UPLOAD_SAS_MINUTES, signBlobUrl } from './filesSas';

// A fake account + key: generateBlobSASQueryParameters is pure HMAC-SHA256
// signing and never touches the network, so this runs fully offline.
const fakeCredential = new StorageSharedKeyCredential('fakeaccount', Buffer.from('fake-key-not-real').toString('base64'));
const blobUrl = 'https://fakeaccount.blob.core.windows.net/photos/family/photos/abc-123.jpg';
const now = new Date('2027-06-01T12:00:00Z');

describe('signBlobUrl', () => {
  it('signs a write-only URL with sp=cw and an https-only protocol', () => {
    const result = signBlobUrl(fakeCredential, 'photos', 'family/photos/abc-123.jpg', blobUrl, 'cw', UPLOAD_SAS_MINUTES, now);
    expect(result.url.startsWith(`${blobUrl}?`)).toBe(true);
    const qs = new URLSearchParams(result.url.split('?')[1]);
    expect(qs.get('sp')).toBe('cw');
    expect(qs.get('spr')).toBe('https');
    expect(qs.get('sr')).toBe('b'); // signed resource: blob
    expect(qs.get('sig')).toBeTruthy();
  });

  it('signs a read-only URL with sp=r', () => {
    const result = signBlobUrl(fakeCredential, 'photos', 'family/photos/abc-123.jpg', blobUrl, 'r', READ_SAS_MINUTES, now);
    const qs = new URLSearchParams(result.url.split('?')[1]);
    expect(qs.get('sp')).toBe('r');
  });

  it('expires about 15 minutes out, with a small clock-skew allowance behind it', () => {
    const result = signBlobUrl(fakeCredential, 'photos', 'family/photos/abc-123.jpg', blobUrl, 'r', 15, now);
    const qs = new URLSearchParams(result.url.split('?')[1]);
    const st = new Date(qs.get('st')!);
    const se = new Date(qs.get('se')!);
    expect(se.getTime() - now.getTime()).toBe(15 * 60_000);
    expect(now.getTime() - st.getTime()).toBe(5 * 60_000);
    expect(result.expiresOn).toBe(se.toISOString());
  });

  it('produces different signatures for different blob paths (scoped per photo)', () => {
    const a = signBlobUrl(fakeCredential, 'photos', 'family/photos/a.jpg', blobUrl, 'r', 15, now);
    const b = signBlobUrl(fakeCredential, 'photos', 'family/photos/b.jpg', blobUrl, 'r', 15, now);
    const sigA = new URLSearchParams(a.url.split('?')[1]).get('sig');
    const sigB = new URLSearchParams(b.url.split('?')[1]).get('sig');
    expect(sigA).not.toBe(sigB);
  });
});
