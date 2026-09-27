import { describe, expect, it } from 'vitest';
import { filterCampgrounds, NO_FILTER, stateOf } from './campgroundFilter';
import type { Campground } from '../../model/schemas';

const cg = (over: Partial<Campground>): Campground =>
  ({ name: 'X', agency: 'usfs', bookingSystem: 'recreation-gov', unit: '', location: null, electric: null, boatLaunch: null, ...over }) as Campground;

const rows = [
  { id: 'a', data: cg({ name: 'Bear Head Lake State Park', agency: 'mn-state-park', location: { lat: 47.79, lng: -92.08 }, electric: true, boatLaunch: true }) },
  { id: 'b', data: cg({ name: 'Custer State Park', agency: 'sd-state-park', location: { lat: 43.73, lng: -103.42 }, electric: true }) },
  { id: 'c', data: cg({ name: 'Winnie Campground', unit: 'Chippewa National Forest', location: { lat: 47.42, lng: -94.33 }, boatLaunch: true }) },
  { id: 'd', data: cg({ name: 'Norway Point (dispersed)', agency: 'other', unit: 'Superior National Forest' }) },
];

describe('campground finder', () => {
  it('works out the state from the agency or the pin', () => {
    expect(rows.map((r) => stateOf(r.data))).toEqual(['MN', 'SD', 'MN', null]);
  });

  it('searches name and unit, every word', () => {
    expect(filterCampgrounds(rows, { ...NO_FILTER, q: 'chippewa' }, null).map((h) => h.id)).toEqual(['c']);
    expect(filterCampgrounds(rows, { ...NO_FILTER, q: 'state park bear' }, null).map((h) => h.id)).toEqual(['a']);
  });

  it('filters by state, kind and features', () => {
    expect(filterCampgrounds(rows, { ...NO_FILTER, state: 'SD' }, null).map((h) => h.id)).toEqual(['b']);
    expect(filterCampgrounds(rows, { ...NO_FILTER, kind: 'national-forest' }, null).map((h) => h.id)).toEqual(['c']);
    expect(filterCampgrounds(rows, { ...NO_FILTER, electric: true, boatLaunch: true }, null).map((h) => h.id)).toEqual(['a']);
  });

  it('sorts nearest first from a reference point, pinless last', () => {
    const hits = filterCampgrounds(rows, NO_FILTER, { lat: 47.5, lng: -94.4 });
    expect(hits.map((h) => h.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(hits[0]!.distanceKm).toBeCloseTo(10.5, 0);
    expect(hits[3]!.distanceKm).toBeNull();
  });
});
