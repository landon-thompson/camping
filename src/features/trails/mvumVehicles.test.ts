import { describe, expect, it } from 'vitest';
import { classifyVehicles, esriLinesToGeoJSON, fetchMvumLines } from './mvumVehicles';

describe('MVUM vehicle colors', () => {
  it('classifies by the most permissive highway vehicle allowed', () => {
    expect(classifyVehicles({ PASSENGERVEHICLE: 'open', HIGHCLEARANCEVEHICLE: 'open' }).cls).toBe('all');
    expect(classifyVehicles({ PASSENGERVEHICLE: null, HIGHCLEARANCEVEHICLE: 'open' }).cls).toBe('high-clearance');
    expect(classifyVehicles({ PASSENGERVEHICLE: 'Null', ATV: 'open', MOTORCYCLE: 'open' }).cls).toBe('ohv');
    expect(classifyVehicles({ OTHER_OHV_LT50INCHES: 'open' }).cls).toBe('ohv');
    expect(classifyVehicles({ NAME: 'x' }).cls).toBe('other');
  });

  it('detects seasonal roads', () => {
    expect(classifyVehicles({ SEASONAL: 'yearlong' }).seasonal).toBe(false);
    expect(classifyVehicles({ SEASONAL: 'seasonal' }).seasonal).toBe(true);
    expect(classifyVehicles({ HIGHCLEARANCEVEHICLE_DATESOPEN: '05/15-11/30' }).seasonal).toBe(true);
    // Year-round roads list 01/01-12/31: not seasonal. The SEASONAL field wins when present.
    expect(classifyVehicles({ PASSENGERVEHICLE: 'open', PASSENGERVEHICLE_DATESOPEN: '01/01-12/31' }).seasonal).toBe(false);
    expect(classifyVehicles({ SEASONAL: 'yearlong', ATV_DATESOPEN: '05/15-11/30' }).seasonal).toBe(false);
  });

  it('turns Esri polylines into GeoJSON and queries roads + trails for the box', async () => {
    const fc = esriLinesToGeoJSON([
      { attributes: { NAME: 'FR 123', HIGHCLEARANCEVEHICLE: 'open' }, geometry: { paths: [[[-92, 47], [-92.1, 47.1]]] } },
      { attributes: { NAME: 'no geometry' } },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties).toEqual({ cls: 'high-clearance', seasonal: false, name: 'FR 123' });

    const urls: string[] = [];
    const fake = (async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ features: [{ attributes: { PASSENGERVEHICLE: 'open' }, geometry: { paths: [[[-92, 47], [-92, 47.1]]] } }] }));
    }) as typeof fetch;
    const lines = await fetchMvumLines([-92.5, 46.9, -91.5, 47.5], 11, undefined, fake);
    expect(lines.features).toHaveLength(2);
    expect(urls.map((u) => u.match(/MapServer\/(\d+)\/query/)?.[1])).toEqual(['4', '2']);
    expect(urls[0]).toContain('geometryType=esriGeometryEnvelope');
  });
});
