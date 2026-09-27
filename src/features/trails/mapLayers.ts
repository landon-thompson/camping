import type { GeoJSONSource, IControl, Map as MapLibreMap } from 'maplibre-gl';
import { liveQuery } from 'dexie';
import type { FeatureCollection } from 'geojson';
import { db } from '../../db/local';
import { recordSchemas } from '../../model/schemas';
import type { Pin, Route } from '../../model/trails';
import { mvumRasterSource } from './mvum';

/** Phase 2 maps call this once loaded (see docs/CONTRACTS.md). */
export interface MapContext {
  /** Trip being shown, or null on the season/library map (show everything). */
  tripId: string | null;
}

const ROUTES_SOURCE = 'trails-routes';
const ROUTES_LINE_LAYER = 'trails-routes-line';
const PINS_SOURCE = 'trails-pins';
const PINS_CIRCLE_LAYER = 'trails-pins-circle';
const PINS_LABEL_LAYER = 'trails-pins-label';
const MVUM_SOURCE = 'trails-mvum';
const MVUM_LAYER = 'trails-mvum-raster';

/** Persisted so the toggle stays put across map remounts (per contract). */
export const MVUM_VISIBLE_STORAGE_KEY = 'trails.showMvum';

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function routesToFC(rows: { id: string; data: Route }[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.data.geometry,
      properties: {
        id: r.id,
        name: r.data.name,
        noTrailer: r.data.flags.noTrailer,
        fourWd: r.data.flags.fourWd,
        seasonalMud: r.data.flags.seasonalMud,
        difficulty: r.data.difficulty,
      },
    })),
  };
}

function pinsToFC(rows: { id: string; data: Pin }[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.data.position.lng, p.data.position.lat] },
      properties: { id: p.id, name: p.data.name, kind: p.data.kind },
    })),
  };
}

function safeSetData(map: MapLibreMap, sourceId: string, fc: FeatureCollection) {
  try {
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(fc);
  } catch {
    // Style mid-reload, or map gone offline mid-request — never throw from here.
  }
}

function readMvumPreference(): boolean {
  try {
    return localStorage.getItem(MVUM_VISIBLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMvumPreference(show: boolean): void {
  try {
    localStorage.setItem(MVUM_VISIBLE_STORAGE_KEY, show ? '1' : '0');
  } catch {
    // Private browsing / storage disabled — the toggle just won't persist.
  }
}

const MVUM_MIN_ZOOM = 8;

/** MVUM on/off button with a visible state and a hint when zoomed too far out to draw. */
class MvumToggleControl implements IControl {
  private container: HTMLElement | null = null;
  private map: MapLibreMap | null = null;
  private button: HTMLButtonElement | null = null;
  private hint: HTMLElement | null = null;
  private onZoom = () => this.render();

  constructor(
    private pressed: boolean,
    private onToggle: (show: boolean) => void,
  ) {}

  private render() {
    if (!this.button || !this.hint) return;
    this.button.setAttribute('aria-pressed', String(this.pressed));
    this.button.textContent = this.pressed ? 'MVUM on' : 'MVUM off';
    this.button.style.background = this.pressed ? 'var(--color-brand)' : 'var(--color-surface)';
    this.button.style.color = this.pressed ? 'var(--color-brand-ink)' : 'var(--color-ink)';
    const tooFar = this.pressed && (this.map?.getZoom() ?? MVUM_MIN_ZOOM) < MVUM_MIN_ZOOM;
    this.hint.textContent = tooFar ? 'Zoom in to see MVUM roads' : '';
    this.hint.hidden = !tooFar;
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'flex-end';
    container.style.gap = '4px';
    const button = document.createElement('button');
    button.type = 'button';
    button.style.minHeight = '44px';
    button.style.padding = '0 12px';
    button.style.borderRadius = '10px';
    button.style.fontWeight = '700';
    button.style.fontSize = '13px';
    button.style.border = '1px solid var(--color-line)';
    button.title = 'USFS Motor Vehicle Use Map roads & trails. The printed/official MVUM is the legal reference.';
    button.addEventListener('click', () => {
      this.pressed = !this.pressed;
      this.onToggle(this.pressed);
      this.render();
    });
    const hint = document.createElement('div');
    hint.setAttribute('role', 'status');
    hint.style.cssText =
      'background:var(--color-surface);color:var(--color-ink);border:1px solid var(--color-line);border-radius:8px;padding:4px 8px;font-size:12px;font-weight:600';
    container.append(button, hint);
    this.container = container;
    this.button = button;
    this.hint = hint;
    map.on('zoomend', this.onZoom);
    this.render();
    return container;
  }

  onRemove(): void {
    this.map?.off('zoomend', this.onZoom);
    this.container?.remove();
    this.container = null;
    this.map = null;
  }
}

/**
 * CONTRACT: every app map (Phase 2) calls this once the map has loaded.
 * Adds imported routes/pins (styled by flags/kind) and an MVUM toggle;
 * live-updates from Dexie as records change; returns a cleanup function.
 * Designed to never throw, including offline or mid-style-reload.
 */
export function attachTrailLayers(map: MapLibreMap, ctx: MapContext): () => void {
  let live = true;

  try {
    if (!map.getSource(ROUTES_SOURCE)) map.addSource(ROUTES_SOURCE, { type: 'geojson', data: emptyFC() });
    if (!map.getSource(PINS_SOURCE)) map.addSource(PINS_SOURCE, { type: 'geojson', data: emptyFC() });

    if (!map.getLayer(ROUTES_LINE_LAYER)) {
      map.addLayer({
        id: ROUTES_LINE_LAYER,
        type: 'line',
        source: ROUTES_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 3,
          // Color flags "no trailer" routes (narrow / no turnaround) in warning red.
          'line-color': ['case', ['==', ['get', 'noTrailer'], true], '#a3231a', '#1c4f8a'],
          // Dashed = seasonal mud.
          'line-dasharray': ['case', ['==', ['get', 'seasonalMud'], true], ['literal', [2, 1.5]], ['literal', [1, 0]]],
        },
      });
    }

    if (!map.getLayer(PINS_CIRCLE_LAYER)) {
      map.addLayer({
        id: PINS_CIRCLE_LAYER,
        type: 'circle',
        source: PINS_SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-color': [
            'match',
            ['get', 'kind'],
            'dispersed',
            '#1f4d36',
            'launch',
            '#1c4f8a',
            'water',
            '#0e7490',
            'turnaround',
            '#8a5a00',
            /* other/default */ '#3f4a42',
          ],
        },
      });
    }

    if (!map.getLayer(PINS_LABEL_LAYER)) {
      map.addLayer({
        id: PINS_LABEL_LAYER,
        type: 'symbol',
        source: PINS_SOURCE,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: { 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
      });
    }

    if (!map.getSource(MVUM_SOURCE)) map.addSource(MVUM_SOURCE, mvumRasterSource());
    if (!map.getLayer(MVUM_LAYER)) {
      map.addLayer({
        id: MVUM_LAYER,
        type: 'raster',
        source: MVUM_SOURCE,
        layout: { visibility: readMvumPreference() ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.85 },
      });
    }
  } catch {
    // Style not ready, offline, or layers already present from a prior attach — ignore.
  }

  const control = new MvumToggleControl(readMvumPreference(), (show) => {
    writeMvumPreference(show);
    try {
      map.setLayoutProperty(MVUM_LAYER, 'visibility', show ? 'visible' : 'none');
    } catch {
      // ignore
    }
  });
  try {
    map.addControl(control, 'top-right');
  } catch {
    // ignore
  }

  const routesSub = liveQuery(() => db.records.where('[type+deleted]').equals(['route', 0]).toArray()).subscribe({
    next: (rows) => {
      if (!live) return;
      const parsed: { id: string; data: Route }[] = [];
      for (const r of rows) {
        const p = recordSchemas.route.safeParse(r.data);
        if (!p.success) continue;
        if (ctx.tripId && p.data.tripId !== ctx.tripId) continue;
        parsed.push({ id: r.id, data: p.data });
      }
      safeSetData(map, ROUTES_SOURCE, routesToFC(parsed));
    },
    error: () => undefined, // Offline / DB hiccup — never throw from a live subscription.
  });

  const pinsSub = liveQuery(() => db.records.where('[type+deleted]').equals(['pin', 0]).toArray()).subscribe({
    next: (rows) => {
      if (!live) return;
      const parsed: { id: string; data: Pin }[] = [];
      for (const r of rows) {
        const p = recordSchemas.pin.safeParse(r.data);
        if (!p.success) continue;
        if (ctx.tripId && p.data.tripId !== ctx.tripId) continue;
        parsed.push({ id: r.id, data: p.data });
      }
      safeSetData(map, PINS_SOURCE, pinsToFC(parsed));
    },
    error: () => undefined,
  });

  return () => {
    live = false;
    routesSub.unsubscribe();
    pinsSub.unsubscribe();
    try {
      map.removeControl(control);
    } catch {
      // ignore
    }
    for (const id of [ROUTES_LINE_LAYER, PINS_CIRCLE_LAYER, PINS_LABEL_LAYER, MVUM_LAYER]) {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
      } catch {
        // ignore
      }
    }
    for (const id of [ROUTES_SOURCE, PINS_SOURCE, MVUM_SOURCE]) {
      try {
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        // ignore
      }
    }
  };
}
