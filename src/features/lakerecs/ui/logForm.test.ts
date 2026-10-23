import { describe, expect, it } from 'vitest';
import { fishingLogSchema } from '../../../model/lakerecs';
import { draftToLog, logSummary, newDraft, todayIso } from './logForm';

const lake = { key: 'mn:69000001', name: 'Fixture Lake North' };

describe('log a catch: form → fishing_log', () => {
  it('uses the local date', () => {
    expect(todayIso(new Date(2027, 5, 3, 23, 30))).toBe('2027-06-03');
  });

  it('maps a fresh draft to a valid record with a zero for the target species', () => {
    const r = draftToLog(newDraft('WAE', '2027-06-03'), lake, 'trip:1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.log).toEqual({
      lakeKey: 'mn:69000001',
      lakeName: 'Fixture Lake North',
      tripId: 'trip:1',
      date: '2027-06-03',
      hours: 2,
      anglers: 2,
      catches: [{ species: 'WAE', count: 0 }],
      targetSpecies: ['WAE'],
      rating: null,
      notes: '',
    });
    expect(fishingLogSchema.safeParse(r.log).success).toBe(true);
  });

  it('keeps typed counts, treats blank target counts as 0, drops blank extras', () => {
    const d = { ...newDraft('WAE', '2027-06-03'), hours: '3,5', counts: { WAE: '', NOP: '2', YEP: '' }, rating: 4, notes: '  windy  ' };
    const r = draftToLog(d, lake, null);
    expect(r.ok && r.log.catches).toEqual([
      { species: 'WAE', count: 0 },
      { species: 'NOP', count: 2 },
    ]);
    expect(r.ok && r.log.hours).toBe(3.5);
    expect(r.ok && r.log.notes).toBe('windy');
    expect(r.ok && r.log.rating).toBe(4);
  });

  it('rejects bad numbers with plain messages', () => {
    const r = draftToLog({ ...newDraft('WAE', '2027-06-03'), hours: '30', anglers: '0', counts: { WAE: '1.5' } }, lake, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain('Hours must be a number from 0 to 24.');
    expect(r.errors).toContain('People fishing must be a whole number from 1 to 12.');
    expect(r.errors).toContain('Fish counts must be whole numbers from 0 to 999.');
  });

  it('asks for blank hours instead of reading them as 0', () => {
    const r = draftToLog({ ...newDraft('WAE', '2027-06-03'), hours: ' ' }, lake, null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toContain('Enter how many hours you fished.');
  });

  it('refuses a lake without an official key', () => {
    const r = draftToLog(newDraft('WAE', '2027-06-03'), { key: 'osm:123', name: 'X' }, null);
    expect(!r.ok && r.errors[0]).toMatch(/official id/);
  });

  it('summarizes an outing', () => {
    const r = draftToLog({ ...newDraft('WAE', '2027-06-03'), counts: { WAE: '3', NOP: '1' } }, lake, null);
    expect(r.ok && logSummary(r.log)).toBe('2 h · 2 people · 3 walleye, 1 northern pike');
  });
});
