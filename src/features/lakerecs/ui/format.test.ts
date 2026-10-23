import { describe, expect, it } from 'vitest';
import type { LakeModelStatus } from '../types';
import { DEFAULT_SPECIES, driveText, parsePrefs, pointsText, statusView } from './format';

const base: LakeModelStatus = { state: 'ready', version: '2026.10.1', createdAt: '2026-10-03T12:00:00Z', tilesOnPhone: 2, bytesOnPhone: 180_000 };
const fallback = { species: 'WAE', mode: 'expected' as const };

describe('lake recs formatting', () => {
  it('formats drive time and points', () => {
    expect(driveText(24.6)).toBe('about 25 min');
    expect(driveText(70)).toBe('about 1 h 10 min');
    expect(driveText(120)).toBe('about 2 h');
    expect(pointsText(6.54)).toBe('+6.5 pts');
    expect(pointsText(-3)).toBe('−3 pts');
    expect(pointsText(0.01)).toBe('0 pts');
  });

  it('remembers species and mode, ignoring junk', () => {
    expect(parsePrefs('{"species":"NOP","mode":"safe"}', DEFAULT_SPECIES, fallback)).toEqual({ species: 'NOP', mode: 'safe' });
    expect(parsePrefs('{"species":"XXX","mode":"wild"}', DEFAULT_SPECIES, fallback)).toEqual(fallback);
    expect(parsePrefs('not json', DEFAULT_SPECIES, fallback)).toEqual(fallback);
    expect(parsePrefs(null, DEFAULT_SPECIES, fallback)).toEqual(fallback);
  });

  it('shows the model version and what is on the phone', () => {
    const v = statusView(base, 0, true);
    expect(v.text).toMatch(/^Lake model 2026\.10\.1 · updated /);
    expect(v.note).toBe('2 areas saved on this phone (176 KB)');
    expect(v.canUpdate).toBe(true);
    expect(v.canDownload).toBe(false);
  });

  it('offers a download when tiles are missing, only online', () => {
    expect(statusView(base, 2, true).canDownload).toBe(true);
    const off = statusView(base, 2, false);
    expect(off.canDownload).toBe(false);
    expect(off.canUpdate).toBe(false);
    expect(off.offline).toBe(true);
    expect(off.note).toMatch(/connect to download/);
  });

  it('says when the model is not published, and when offline with nothing saved', () => {
    const none = statusView({ state: 'none', version: null, createdAt: null, tilesOnPhone: 0, bytesOnPhone: 0 }, 0, true);
    expect(none.text).toBe('Lake model not published yet');
    expect(none.notPublished).toBe(true);
    expect(none.canUpdate).toBe(false);
    const off = statusView({ state: 'offline', version: null, createdAt: null, tilesOnPhone: 0, bytesOnPhone: 0 }, 0, true);
    expect(off.text).toBe('No lake model on this phone yet');
    expect(off.note).toMatch(/connect once/);
  });

  it('shows errors', () => {
    expect(statusView({ ...base, state: 'error', message: 'HTTP 500' }, 0, true).note).toBe('Couldn’t update: HTTP 500');
  });
});
