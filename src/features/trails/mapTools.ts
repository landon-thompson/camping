import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { MVUM_LAYER_IDS, MVUM_SERVICE_URL } from './mvum';
import { MVUM_VECTOR_MIN_ZOOM, VEHICLE_CLASS_STYLE } from './mvumVehicles';

/**
 * Shared map tools added to every app map by attachTrailLayers:
 *  - Expand: full-screen map (iPhone Safari has no element fullscreen, so this is CSS).
 *  - Road info: while on, a tap asks the USFS MVUM service what road/trail is there.
 *  - Legend: the official MVUM symbols, straight from the service.
 */

const INFO_FLAG = '__campRoadInfo';

/** Page-level tap handlers (drop pin, set location) should skip taps while road info mode is on. */
export function isRoadInfoMode(map: MapLibreMap): boolean {
  return (map as unknown as Record<string, unknown>)[INFO_FLAG] === true;
}

function setRoadInfoMode(map: MapLibreMap, on: boolean) {
  (map as unknown as Record<string, unknown>)[INFO_FLAG] = on;
  map.getCanvas().style.cursor = on ? 'help' : '';
}

const btnCss =
  'min-height:44px;padding:0 12px;border-radius:10px;font-weight:700;font-size:13px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)';

function button(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.style.cssText = btnCss;
  return b;
}

function pressed(b: HTMLButtonElement, on: boolean) {
  b.setAttribute('aria-pressed', String(on));
  b.style.background = on ? 'var(--color-brand)' : 'var(--color-surface)';
  b.style.color = on ? 'var(--color-brand-ink)' : 'var(--color-ink)';
}

/** Full-screen toggle, top-left. */
export class ExpandControl implements IControl {
  private container: HTMLElement | null = null;
  private expanded = false;
  private map: MapLibreMap | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.expanded) this.toggle();
  };
  private btn: HTMLButtonElement | null = null;

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    const c = document.createElement('div');
    c.className = 'maplibregl-ctrl';
    const b = button('⤢ Expand', 'Show the map full screen');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => this.toggle());
    c.appendChild(b);
    this.btn = b;
    this.container = c;
    document.addEventListener('keydown', this.onKey);
    return c;
  }

  private toggle() {
    const map = this.map;
    if (!map || !this.btn) return;
    this.expanded = !this.expanded;
    const el = map.getContainer();
    el.classList.toggle('camp-map-expanded', this.expanded);
    document.documentElement.classList.toggle('camp-map-open', this.expanded);
    this.btn.textContent = this.expanded ? '✕ Close' : '⤢ Expand';
    this.btn.setAttribute('aria-pressed', String(this.expanded));
    requestAnimationFrame(() => map.resize());
  }

  onRemove(): void {
    if (this.expanded) this.toggle();
    document.removeEventListener('keydown', this.onKey);
    this.container?.remove();
    this.map = null;
  }
}

/** Human-friendly field names for common MVUM attributes; anything else is shown tidied up. */
const FIELD_LABELS: Record<string, string> = {
  NAME: 'Name',
  ID: 'Route number',
  SYMBOL_NAME: 'Road type',
  SEASONAL: 'Seasonal',
  PASSENGERVEHICLE: 'Passenger vehicles',
  PASSENGERVEHICLE_DATESOPEN: 'Passenger vehicles — dates open',
  HIGHCLEARANCEVEHICLE: 'High-clearance vehicles',
  HIGHCLEARANCEVEHICLE_DATESOPEN: 'High-clearance — dates open',
  TRUCK: 'Trucks',
  MOTORHOME: 'Motorhomes',
  BUS: 'Buses',
  ATV: 'ATVs',
  MOTORCYCLE: 'Motorcycles',
  OTHERWHEELED_OHV: 'Other OHVs',
  FOURWD_GT50INCHES: '4WD > 50 in',
  TWOWD_GT50INCHES: '2WD > 50 in',
  E_BIKE_CLASS1: 'E-bike class 1',
  E_BIKE_CLASS2: 'E-bike class 2',
  E_BIKE_CLASS3: 'E-bike class 3',
  JURISDICTION: 'Jurisdiction',
  OPERATIONALMAINTLEVEL: 'Maintenance level',
  SURFACETYPE: 'Surface',
  SYSTEM: 'System',
  SBS_SYMBOL_NAME: 'Symbol',
};

const HIDDEN = /^(objectid|shape|shape_length|shape_area|gis_|globalid|rte_cn|cn$|gis_miles|seg_length|bmp|emp|fid|forest|district|admin_org|securityid|symbol$|mvum_symbol|revision|mvumdate|ignore)/i;

export function describeMvumAttributes(attrs: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    const text = String(v).trim();
    if (!text || text === 'Null' || text === 'N/A' || HIDDEN.test(k)) continue;
    const key = k.toUpperCase();
    const label =
      FIELD_LABELS[key] ??
      k
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase());
    rows.push([label, text]);
  }
  // Named, well-known fields first.
  const order = Object.values(FIELD_LABELS);
  return rows.sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

async function identify(map: MapLibreMap, lng: number, lat: number) {
  const b = map.getBounds();
  const canvas = map.getCanvas();
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: `visible:${MVUM_LAYER_IDS.roads},${MVUM_LAYER_IDS.trails}`,
    tolerance: '10',
    mapExtent: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
    imageDisplay: `${canvas.clientWidth},${canvas.clientHeight},96`,
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetch(`${MVUM_SERVICE_URL}/identify?${params}`);
  if (!res.ok) throw new Error(`MVUM service answered ${res.status}`);
  const data = (await res.json()) as { results?: { layerName?: string; attributes?: Record<string, unknown> }[] };
  return data.results ?? [];
}

/** The app's own color key for vehicle-coded roads. */
function colorKey(): string {
  const rows = Object.values(VEHICLE_CLASS_STYLE)
    .map(
      (v) =>
        `<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="display:inline-block;flex:0 0 26px;width:26px;height:5px;border-radius:3px;background:${v.color}"></span><span><strong>${v.label}</strong> — ${v.note}</span></div>`,
    )
    .join('');
  return (
    `<p style="margin:0 0 4px;font-weight:700">Road colors (zoom ${MVUM_VECTOR_MIN_ZOOM}+)</p>${rows}` +
    '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="display:inline-block;flex:0 0 26px;width:26px;border-top:4px dashed #555"></span><span>Dashed = seasonal (open part of the year)</span></div>' +
    '<p style="margin:4px 0 0;font-size:11px">From Forest Service data. The printed/official MVUM is the legal reference.</p>'
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Road info + legend buttons, added next to the MVUM on/off toggle. */
export class MvumInfoControl implements IControl {
  private container: HTMLElement | null = null;
  private map: MapLibreMap | null = null;
  private infoOn = false;
  private popup: import('maplibre-gl').Popup | null = null;

  constructor(
    private popupFactory: () => import('maplibre-gl').Popup,
    private ensureMvumVisible: () => void,
  ) {}

  private onClick = async (e: { lngLat: { lng: number; lat: number } }) => {
    const map = this.map;
    if (!map || !this.infoOn) return;
    const { lng, lat } = e.lngLat;
    this.popup?.remove();
    this.popup = this.popupFactory().setLngLat([lng, lat]).setHTML('<p style="margin:0">Looking up this road…</p>').addTo(map);
    try {
      const results = await identify(map, lng, lat);
      if (results.length === 0) {
        this.popup.setHTML('<p style="margin:0">No MVUM road or trail right here. Tap directly on a line.</p>');
        return;
      }
      const html = results
        .slice(0, 3)
        .map((r) => {
          const rows = describeMvumAttributes(r.attributes ?? {})
            .map(([k, v]) => `<tr><th style="text-align:left;padding:2px 8px 2px 0;font-weight:600">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
            .join('');
          return `<p style="margin:0 0 4px;font-weight:700">${escapeHtml(r.layerName ?? 'MVUM')}</p><table style="font-size:13px;border-collapse:collapse">${rows}</table>`;
        })
        .join('<hr style="margin:8px 0">');
      this.popup.setHTML(
        `<div style="max-height:50vh;overflow:auto">${html}<p style="margin:8px 0 0;font-size:12px">The printed/official MVUM is the legal reference.</p></div>`,
      );
    } catch {
      this.popup.setHTML('<p style="margin:0">Couldn’t reach the Forest Service map service. Check your signal.</p>');
    }
  };

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    const c = document.createElement('div');
    c.className = 'maplibregl-ctrl';
    c.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:4px';
    const info = button('ⓘ Road info', 'Tap a road to see its MVUM details');
    pressed(info, false);
    info.addEventListener('click', () => {
      this.infoOn = !this.infoOn;
      pressed(info, this.infoOn);
      setRoadInfoMode(map, this.infoOn);
      if (this.infoOn) this.ensureMvumVisible();
      else this.popup?.remove();
    });
    const legendBtn = button('Legend', 'MVUM symbols');
    pressed(legendBtn, false);
    const legend = document.createElement('div');
    legend.hidden = true;
    legend.style.cssText =
      'max-height:45vh;max-width:260px;overflow:auto;background:var(--color-surface);color:var(--color-ink);border:1px solid var(--color-line);border-radius:10px;padding:8px;font-size:12px';
    legendBtn.addEventListener('click', () => {
      legend.hidden = !legend.hidden;
      pressed(legendBtn, !legend.hidden);
      if (!legend.hidden && !legend.dataset.loaded) void this.loadLegend(legend);
    });
    c.append(info, legendBtn, legend);
    this.container = c;
    map.on('click', this.onClick);
    return c;
  }

  private async loadLegend(el: HTMLElement) {
    el.textContent = 'Loading legend…';
    try {
      const res = await fetch(`${MVUM_SERVICE_URL}/legend?f=json`);
      const data = (await res.json()) as {
        layers?: { layerId: number; layerName: string; legend: { label: string; imageData: string; contentType: string }[] }[];
      };
      const wanted: number[] = [MVUM_LAYER_IDS.roads, MVUM_LAYER_IDS.trails];
      const layers = (data.layers ?? []).filter((l) => wanted.includes(l.layerId));
      if (layers.length === 0) throw new Error('empty');
      el.innerHTML = colorKey() + '<p style="margin:8px 0 4px;font-weight:700">Official MVUM symbols (zoomed out)</p>' + layers
        .map(
          (l) =>
            `<p style="margin:4px 0;font-weight:700">${escapeHtml(l.layerName)}</p>` +
            l.legend
              .map(
                (g) =>
                  `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><img alt="" src="data:${escapeHtml(g.contentType)};base64,${g.imageData}" style="width:28px;height:18px;object-fit:contain"><span>${escapeHtml(g.label || '—')}</span></div>`,
              )
              .join(''),
        )
        .join('');
      el.dataset.loaded = '1';
    } catch {
      el.innerHTML = colorKey() + '<p style="margin:8px 0 0">Couldn’t load the official symbols from the Forest Service.</p>';
    }
  }

  onRemove(): void {
    this.map?.off('click', this.onClick);
    if (this.map) setRoadInfoMode(this.map, false);
    this.popup?.remove();
    this.container?.remove();
    this.map = null;
  }
}
