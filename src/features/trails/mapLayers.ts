import maplibregl, { type GeoJSONSource, type IControl, type Map as MapLibreMap } from 'maplibre-gl';
import { ExpandControl, MvumInfoControl } from './mapTools';
import { fetchMvumLines, MVUM_VECTOR_MIN_ZOOM, VEHICLE_CLASS_STYLE } from './mvumVehicles';

const MVUM_VEC_SOURCE = 'trails-mvum-vec';
const MVUM_VEC_LAYER = 'trails-mvum-vec-line';
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

const MVUM_MIN_ZOOM = 6;

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

  /** Turn MVUM on from elsewhere (e.g. when road info is switched on). */
  turnOn() {
    if (this.pressed) return;
    this.pressed = true;
    this.onToggle(true);
    this.render();
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
      // Zoomed in, the app draws the roads itself, colored by allowed vehicles.
      map.setLayerZoomRange(MVUM_LAYER, 6, MVUM_VECTOR_MIN_ZOOM);
    }
    if (!map.getSource(MVUM_VEC_SOURCE)) map.addSource(MVUM_VEC_SOURCE, { type: 'geojson', data: emptyFC() });
    if (!map.getLayer(MVUM_VEC_LAYER)) {
      map.addLayer(
        {
          id: MVUM_VEC_LAYER,
          type: 'line',
          source: MVUM_VEC_SOURCE,
          minzoom: MVUM_VECTOR_MIN_ZOOM,
          layout: { visibility: readMvumPreference() ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 5],
            'line-color': [
              'match',
              ['get', 'cls'],
              'all',
              VEHICLE_CLASS_STYLE.all.color,
              'high-clearance',
              VEHICLE_CLASS_STYLE['high-clearance'].color,
              'ohv',
              VEHICLE_CLASS_STYLE.ohv.color,
              VEHICLE_CLASS_STYLE.other.color,
            ],
            'line-dasharray': ['case', ['==', ['get', 'seasonal'], true], ['literal', [2, 1.2]], ['literal', [1, 0]]],
          },
        },
        map.getLayer(ROUTES_LINE_LAYER) ? ROUTES_LINE_LAYER : undefined,
      );
    }
  } catch {
    // Style not ready, offline, or layers already present from a prior attach — ignore.
  }

  const control = new MvumToggleControl(readMvumPreference(), (show) => {
    writeMvumPreference(show);
    try {
      map.setLayoutProperty(MVUM_LAYER, 'visibility', show ? 'visible' : 'none');
      map.setLayoutProperty(MVUM_VEC_LAYER, 'visibility', show ? 'visible' : 'none');
    } catch {
      // ignore
    }
    if (show) refreshMvumLines();
  });

  // Fetch colored MVUM lines for the visible area (debounced; reuses the last box while inside it).
  let lastBox: [number, number, number, number] | null = null;
  let lastZoom = 0;
  let pending: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function refreshMvumLines() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!live || !readMvumPreference() || map.getZoom() < MVUM_VECTOR_MIN_ZOOM) return;
      const b = map.getBounds();
      const inside =
        lastBox && b.getWest() >= lastBox[0] && b.getSouth() >= lastBox[1] && b.getEast() <= lastBox[2] && b.getNorth() <= lastBox[3];
      if (inside && Math.abs(map.getZoom() - lastZoom) < 2) return;
      // Fetch a bit beyond the screen so small pans don't refetch.
      const padX = (b.getEast() - b.getWest()) * 0.25;
      const padY = (b.getNorth() - b.getSouth()) * 0.25;
      const box: [number, number, number, number] = [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
      pending?.abort();
      pending = new AbortController();
      const zoom = map.getZoom();
      fetchMvumLines(box, zoom, pending.signal)
        .then((fc) => {
          if (!live) return;
          lastBox = box;
          lastZoom = zoom;
          safeSetData(map, MVUM_VEC_SOURCE, fc as unknown as FeatureCollection);
        })
        .catch(() => {
          /* offline or service unavailable: the official picture layer still shows at lower zooms */
        });
    }, 400);
  }
  map.on('moveend', refreshMvumLines);
  refreshMvumLines();
  try {
    map.addControl(control, 'top-right');
  } catch {
    // ignore
  }
  const expand = new ExpandControl();
  const info = new MvumInfoControl(
    () => new maplibregl.Popup({ maxWidth: '300px', closeButton: true }),
    () => control.turnOn(),
  );
  try {
    map.addControl(info, 'top-right');
    map.addControl(expand, 'top-left');
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
    clearTimeout(timer);
    pending?.abort();
    map.off('moveend', refreshMvumLines);
    routesSub.unsubscribe();
    pinsSub.unsubscribe();
    try {
      map.removeControl(control);
      map.removeControl(info);
      map.removeControl(expand);
    } catch {
      // ignore
    }
    for (const id of [ROUTES_LINE_LAYER, PINS_CIRCLE_LAYER, PINS_LABEL_LAYER, MVUM_LAYER, MVUM_VEC_LAYER]) {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
      } catch {
        // ignore
      }
    }
    for (const id of [ROUTES_SOURCE, PINS_SOURCE, MVUM_SOURCE, MVUM_VEC_SOURCE]) {
      try {
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        // ignore
      }
    }
  };
}
