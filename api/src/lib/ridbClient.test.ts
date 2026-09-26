import { describe, expect, it, vi } from 'vitest';
import { fetchFacilities, RidbConfigError, RidbUpstreamError, RIDB_BASE_URL } from './ridbClient';

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchFacilities', () => {
  it('rejects when there is no API key, without making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchFacilities({ apiKey: '', query: 'x', state: 'MN', limit: 10, fetchImpl })).rejects.toBeInstanceOf(
      RidbConfigError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the documented apikey header and query params, and trims the response', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain(`${RIDB_BASE_URL}/facilities`);
      expect(String(url)).toContain('query=Norway');
      expect(String(url)).toContain('state=MN');
      expect(String(url)).toContain('limit=5');
      expect((init?.headers as Record<string, string>).apikey).toBe('secret-key');
      return fakeResponse(200, {
        RECDATA: [
          {
            FacilityID: '233144',
            FacilityName: 'Winnie Campground',
            FacilityDescription: '<p>On <b>Lake Winnibigoshish</b>.</p>',
            FacilityLatitude: 47.5,
            FacilityLongitude: -94.2,
            FacilityReservationURL: 'https://www.recreation.gov/camping/campgrounds/233144',
          },
        ],
      });
    });

    const results = await fetchFacilities({ apiKey: 'secret-key', query: 'Norway', state: 'MN', limit: 5, fetchImpl });
    expect(results).toEqual([
      {
        id: '233144',
        name: 'Winnie Campground',
        lat: 47.5,
        lng: -94.2,
        description: 'On Lake Winnibigoshish.',
        reservationUrl: 'https://www.recreation.gov/camping/campgrounds/233144',
      },
    ]);
  });

  it('falls back to a constructed reservation URL and drops malformed entries', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse(200, {
        RECDATA: [
          { FacilityID: 42, FacilityName: 'No Reservation URL' },
          { FacilityName: 'Missing an id' },
          { FacilityID: 'ok-2', FacilityName: '' },
          'not an object',
        ],
      }),
    );
    const results = await fetchFacilities({ apiKey: 'k', query: '', state: 'MN', limit: 20, fetchImpl });
    expect(results).toEqual([
      {
        id: '42',
        name: 'No Reservation URL',
        lat: null,
        lng: null,
        description: '',
        reservationUrl: 'https://www.recreation.gov/camping/campgrounds/42',
      },
    ]);
  });

  it('surfaces a non-OK response as RidbUpstreamError', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(500, {}));
    await expect(fetchFacilities({ apiKey: 'k', query: '', state: 'MN', limit: 20, fetchImpl })).rejects.toBeInstanceOf(
      RidbUpstreamError,
    );
  });

  it('surfaces a network failure as RidbUpstreamError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(fetchFacilities({ apiKey: 'k', query: '', state: 'MN', limit: 20, fetchImpl })).rejects.toBeInstanceOf(
      RidbUpstreamError,
    );
  });

  it('treats a missing RECDATA array as no results', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200, {}));
    await expect(fetchFacilities({ apiKey: 'k', query: '', state: 'MN', limit: 20, fetchImpl })).resolves.toEqual([]);
  });
});
