import { describe, expect, it } from 'vitest';
import { describeMvumAttributes } from './mapTools';

describe('MVUM road info', () => {
  it('labels known fields, hides internal ones, and lists the useful facts first', () => {
    const rows = describeMvumAttributes({
      OBJECTID: 12,
      SHAPE_Length: 1234.5,
      GIS_MILES: 2.1,
      SEASONAL: 'yearlong',
      NAME: 'NORWAY POINT RD',
      ID: '1234',
      HIGHCLEARANCEVEHICLE: 'open',
      PASSENGERVEHICLE: 'Null',
      SURFACETYPE: '',
      SOME_OTHER_FIELD: 'x',
    });
    expect(rows).toEqual([
      ['Name', 'NORWAY POINT RD'],
      ['Route number', '1234'],
      ['Seasonal', 'yearlong'],
      ['High-clearance vehicles', 'open'],
      ['Some other field', 'x'],
    ]);
  });
});
