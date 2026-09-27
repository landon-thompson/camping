import type { Agency, Campground, LatLng } from '../../model/schemas';
import { distanceKm } from '../places/arcgis';

export type StateCode = 'MN' | 'SD';
export type Kind = 'state-park' | 'national-forest' | 'state-forest' | 'other';

export const KIND_LABEL: Record<Kind, string> = {
  'state-park': 'State parks',
  'national-forest': 'National forest',
  'state-forest': 'State forest',
  other: 'Other / dispersed',
};

const KIND_OF: Record<Agency, Kind> = {
  'mn-state-park': 'state-park',
  'sd-state-park': 'state-park',
  'mn-state-forest': 'state-forest',
  usfs: 'national-forest',
  other: 'other',
};
export const kindOf = (cg: Campground): Kind => KIND_OF[cg.agency];

/** Which state a campground is in: from its agency, else from its pin. */
export function stateOf(cg: Campground): StateCode | null {
  if (cg.agency === 'sd-state-park') return 'SD';
  if (cg.agency === 'mn-state-park' || cg.agency === 'mn-state-forest') return 'MN';
  const p = cg.location;
  if (!p) return null;
  if (p.lat >= 42.4 && p.lat <= 45.95 && p.lng >= -104.1 && p.lng <= -96.44) return 'SD';
  if (p.lat >= 43.4 && p.lat <= 49.4 && p.lng > -97.3 && p.lng <= -89.4) return 'MN';
  return null;
}

export interface CampgroundFilter {
  q: string;
  state: StateCode | null;
  kind: Kind | null;
  electric: boolean;
  boatLaunch: boolean;
}
export const NO_FILTER: CampgroundFilter = { q: '', state: null, kind: null, electric: false, boatLaunch: false };

export interface CampgroundHit {
  id: string;
  data: Campground;
  distanceKm: number | null;
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Filter by search text (every word must appear in name/unit), state, kind and features; nearest first when there's a reference point. */
export function filterCampgrounds(rows: { id: string; data: Campground }[], f: CampgroundFilter, near: LatLng | null): CampgroundHit[] {
  const terms = words(f.q).split(' ').filter(Boolean);
  const hits: CampgroundHit[] = [];
  for (const r of rows) {
    const cg = r.data;
    if (terms.length) {
      const hay = words(`${cg.name} ${cg.unit}`);
      if (!terms.every((t) => hay.includes(t))) continue;
    }
    if (f.state && stateOf(cg) !== f.state) continue;
    if (f.kind && kindOf(cg) !== f.kind) continue;
    if (f.electric && cg.electric !== true) continue;
    if (f.boatLaunch && cg.boatLaunch !== true) continue;
    hits.push({ id: r.id, data: cg, distanceKm: near && cg.location ? Math.round(distanceKm(near, cg.location) * 10) / 10 : null });
  }
  return hits.sort((a, b) => {
    if (near) {
      const d = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      if (d) return d;
    }
    return a.data.name.localeCompare(b.data.name);
  });
}
