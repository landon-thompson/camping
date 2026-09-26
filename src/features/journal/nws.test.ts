import { describe, expect, it, vi } from 'vitest';
import {
  NwsError,
  fetchNwsForecast,
  formatAsOf,
  formatPeriod,
  parseForecastResponse,
  parsePeriod,
  parsePointsResponse,
} from './nws';

// Fixtures shaped per NWS's published API docs (api.weather.gov/openapi.json and
// the developer docs at weather-gov.github.io/api). Not captured from a live
// call — see the file header note on why (sandbox network access is blocked).
const POINTS_FIXTURE = {
  properties: {
    gridId: 'MPX',
    gridX: 109,
    gridY: 71,
    forecast: 'https://api.weather.gov/gridpoints/MPX/109,71/forecast',
    forecastHourly: 'https://api.weather.gov/gridpoints/MPX/109,71/forecast/hourly',
  },
};

const FORECAST_FIXTURE = {
  properties: {
    updated: '2027-06-01T10:23:00+00:00',
    periods: [
      {
        number: 1,
        name: 'This Afternoon',
        startTime: '2027-06-01T13:00:00-05:00',
        endTime: '2027-06-01T18:00:00-05:00',
        isDaytime: true,
        temperature: 78,
        temperatureUnit: 'F',
        probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 20 },
        windSpeed: '10 mph',
        windDirection: 'NW',
        shortForecast: 'Mostly Sunny',
        detailedForecast: 'Mostly sunny, with a high near 78.',
      },
      {
        number: 2,
        name: 'Tonight',
        startTime: '2027-06-01T18:00:00-05:00',
        endTime: '2027-06-02T06:00:00-05:00',
        isDaytime: false,
        temperature: 54,
        temperatureUnit: 'F',
        probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
        windSpeed: '5 mph',
        windDirection: 'W',
        shortForecast: 'Clear',
        detailedForecast: 'Clear, with a low around 54.',
      },
    ],
  },
};

describe('parsePointsResponse', () => {
  it('extracts the forecast + forecastHourly URLs', () => {
    expect(parsePointsResponse(POINTS_FIXTURE)).toEqual({
      forecast: 'https://api.weather.gov/gridpoints/MPX/109,71/forecast',
      forecastHourly: 'https://api.weather.gov/gridpoints/MPX/109,71/forecast/hourly',
    });
  });

  it('throws a bad-response NwsError when the shape is unexpected', () => {
    expect(() => parsePointsResponse({})).toThrow(NwsError);
    expect(() => parsePointsResponse(null)).toThrow(NwsError);
    try {
      parsePointsResponse({});
    } catch (e) {
      expect((e as NwsError).kind).toBe('bad-response');
    }
  });

  it('tolerates a missing forecastHourly', () => {
    const r = parsePointsResponse({ properties: { forecast: 'https://x/forecast' } });
    expect(r.forecastHourly).toBeNull();
  });
});

describe('parsePeriod', () => {
  it('parses a well-formed period, including precip percent', () => {
    const p = parsePeriod(FORECAST_FIXTURE.properties.periods[0]);
    expect(p).toEqual({
      name: 'This Afternoon',
      startTime: '2027-06-01T13:00:00-05:00',
      isDaytime: true,
      temperature: 78,
      temperatureUnit: 'F',
      windSpeed: '10 mph',
      windDirection: 'NW',
      shortForecast: 'Mostly Sunny',
      probabilityOfPrecipitation: 20,
    });
  });

  it('maps a null precip value to null (no chance reported)', () => {
    const p = parsePeriod(FORECAST_FIXTURE.properties.periods[1]);
    expect(p?.probabilityOfPrecipitation).toBeNull();
  });

  it('returns null for garbage input instead of throwing', () => {
    expect(parsePeriod(null)).toBeNull();
    expect(parsePeriod('nope')).toBeNull();
    expect(parsePeriod({})).toBeNull();
  });
});

describe('parseForecastResponse', () => {
  it('parses every period in the fixture', () => {
    const periods = parseForecastResponse(FORECAST_FIXTURE);
    expect(periods).toHaveLength(2);
    expect(periods[0]?.name).toBe('This Afternoon');
    expect(periods[1]?.name).toBe('Tonight');
  });

  it('drops unparseable entries but keeps the rest', () => {
    const periods = parseForecastResponse({
      properties: { periods: [FORECAST_FIXTURE.properties.periods[0], null, 'garbage'] },
    });
    expect(periods).toHaveLength(1);
  });

  it('throws bad-response when periods is missing entirely', () => {
    expect(() => parseForecastResponse({ properties: {} })).toThrow(NwsError);
  });
});

describe('formatPeriod', () => {
  it('formats a compact one-line summary with precip', () => {
    const p = parsePeriod(FORECAST_FIXTURE.properties.periods[0])!;
    expect(formatPeriod(p)).toBe('This Afternoon: 78°F, NW 10 mph — Mostly Sunny, 20% precip');
  });

  it('omits the precip clause when NWS reports none', () => {
    const p = parsePeriod(FORECAST_FIXTURE.properties.periods[1])!;
    expect(formatPeriod(p)).toBe('Tonight: 54°F, W 5 mph — Clear');
  });
});

describe('formatAsOf', () => {
  const now = 1_800_000_000_000;
  it('reports just now, minutes, hours and days', () => {
    expect(formatAsOf(now, now)).toBe('as of just now');
    expect(formatAsOf(now - 5 * 60_000, now)).toBe('as of 5 min ago');
    expect(formatAsOf(now - 3 * 60 * 60_000, now)).toBe('as of 3 hr ago');
    expect(formatAsOf(now - 2 * 24 * 60 * 60_000, now)).toBe('as of 2 days ago');
    expect(formatAsOf(now - 1 * 24 * 60 * 60_000, now)).toBe('as of 1 day ago');
  });
});

describe('fetchNwsForecast', () => {
  it('chains points → forecast and returns parsed periods', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => POINTS_FIXTURE } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => FORECAST_FIXTURE } as Response);
    const result = await fetchNwsForecast(46.5, -92.1, fetchFn as unknown as typeof fetch);
    expect(result.periods).toHaveLength(2);
    expect(fetchFn).toHaveBeenNthCalledWith(1, 'https://api.weather.gov/points/46.5000,-92.1000', expect.anything());
    expect(fetchFn).toHaveBeenNthCalledWith(2, POINTS_FIXTURE.properties.forecast, expect.anything());
  });

  it('maps a 404 from /points to a no-coverage error', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as Response);
    await expect(fetchNwsForecast(0, 0, fetchFn as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'no-coverage' });
  });

  it('maps a thrown fetch error (offline) to a network error', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchNwsForecast(0, 0, fetchFn as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps a non-2xx forecast response to a bad-response error', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => POINTS_FIXTURE } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response);
    await expect(fetchNwsForecast(46.5, -92.1, fetchFn as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'bad-response' });
  });
});
