import { describe, expect, it } from 'vitest';
import { generateShareToken, isValidTripId, redactReservation } from './shareService';

describe('generateShareToken', () => {
  it('generates long, URL-safe, unique tokens', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('isValidTripId', () => {
  it('accepts well-formed trip ids and rejects anything else', () => {
    expect(isValidTripId('trip:1-shakedown')).toBe(true);
    expect(isValidTripId('trip:abcDEF_123-xyz')).toBe(true);
    expect(isValidTripId('gear:1')).toBe(false);
    expect(isValidTripId('trip:has spaces')).toBe(false);
    expect(isValidTripId(123)).toBe(false);
    expect(isValidTripId(undefined)).toBe(false);
  });
});

describe('redactReservation', () => {
  it('drops the confirmation number and cost fields', () => {
    const full = {
      tripId: 'trip:1',
      campgroundId: 'campground:1',
      status: 'booked',
      arrivalDate: '2027-06-01',
      nights: 2,
      confirmation: 'SECRET-123',
      site: 'A12',
      costUsd: 45,
      feesUsd: 8,
      cancelDeadline: '2027-05-25',
      notifyMeSet: false,
      notes: 'private note',
    };
    const redacted = redactReservation(full);
    expect(redacted).toEqual({ status: 'booked', arrivalDate: '2027-06-01', nights: 2, site: 'A12' });
    expect(JSON.stringify(redacted)).not.toContain('SECRET-123');
    expect(JSON.stringify(redacted)).not.toMatch(/costUsd|feesUsd|confirmation/);
  });

  it('handles missing or malformed input without throwing', () => {
    expect(redactReservation(null)).toBeNull();
    expect(redactReservation(undefined)).toBeNull();
    expect(redactReservation({})).toEqual({ status: 'planned', arrivalDate: null, nights: null, site: '' });
  });
});
