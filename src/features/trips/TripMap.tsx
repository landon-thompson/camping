import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE_URL } from '../../lib/map';
import { isRoadInfoMode } from '../trails/mapTools';
import { attachTrailLayers } from '../trails/mapLayers';

export interface TripMapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Short label drawn inside the pin (e.g. a trip level number). */
  label: string;
  variant?: 'trip' | 'home' | 'plain';
  /** Name shown beside the pin (and read by screen readers). */
  title?: string;
}

/**
 * Shared map surface for every screen this feature draws a map on (season
 * map, a trip's location, the public share page). Always attaches Phase 4's
 * trail layers once loaded, and turns a tile/offline failure into a message
 * instead of a crash.
 */
export function TripMap({
  center,
  zoom = 9,
  markers = [],
  tripId,
  onPick,
  onMarkerClick,
  fitMarkers = false,
  className = 'h-[50vh] min-h-72 w-full',
}: {
  center: [number, number];
  zoom?: number;
  markers?: TripMapMarker[];
  /** Trip context passed to attachTrailLayers; null on the season map. */
  tripId: string | null;
  /** When set, tapping the map reports the lat/lng (used to place a trip's location). */
  onPick?: (lat: number, lng: number) => void;
  /** When set, pins are buttons (e.g. open that trip). */
  onMarkerClick?: (id: string) => void;
  /** Zoom to show every pin once they first appear. */
  fitMarkers?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const fittedRef = useRef('');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the initial center/zoom seed the map
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let cleanupTrails = () => undefined as void;
    let map: MapLibreMap;
    const coordHint = () => (onPickRef.current ? ' You can still enter coordinates by hand.' : '');
    try {
      map = new MapLibreMap({ container, style: MAP_STYLE_URL, center, zoom, attributionControl: false });
    } catch {
      setError(`The map couldn’t load.${coordHint()}`);
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
      if (!cancelled) setError(`Map tiles are unavailable right now (offline, or the tile server is unreachable).${coordHint()}`);
    });
    map.on('load', () => {
      if (cancelled) return;
      cleanupTrails = attachTrailLayers(map, { tripId });
    });
    map.on('click', (e) => {
      if (isRoadInfoMode(map)) return;
      onPickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      cancelled = true;
      cleanupTrails();
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    const clickable = !!onMarkerClickRef.current;
    markersRef.current = markers.map((m) => {
      const el = document.createElement(clickable ? 'button' : 'div');
      const colors =
        m.variant === 'home'
          ? 'border-accent bg-accent text-white'
          : m.variant === 'plain'
            ? 'border-line bg-surface text-ink'
            : 'border-white bg-brand text-brand-ink';
      const pin = document.createElement('span');
      pin.className = `grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold shadow ${colors}`;
      pin.textContent = m.label;
      el.appendChild(pin);
      if (m.title) {
        el.setAttribute('aria-label', m.title);
        el.setAttribute('title', m.title);
        if (clickable) {
          const tag = document.createElement('span');
          tag.className = 'max-w-32 truncate rounded-md bg-surface/90 px-1.5 py-0.5 text-xs font-semibold text-ink shadow';
          tag.textContent = m.title;
          el.appendChild(tag);
        }
      }
      if (clickable) {
        // 44px tap target around the pin; the name tag hangs to the right.
        el.className = 'flex min-h-11 min-w-11 items-center gap-1 pl-2';
        (el as HTMLButtonElement).type = 'button';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onMarkerClickRef.current?.(m.id);
        });
      }
      return new Marker({ element: el, anchor: clickable && m.title ? 'left' : 'center', offset: clickable && m.title ? [-22, 0] : [0, 0] })
        .setLngLat([m.lng, m.lat])
        .addTo(map);
    });
    // Re-fit when the set of pins changes (records load in stages), not on every re-render.
    const pinKey = markers.map((m) => `${m.id}@${m.lat},${m.lng}`).join('|');
    if (fitMarkers && markers.length && fittedRef.current !== pinKey) {
      fittedRef.current = pinKey;
      if (markers.length === 1) map.jumpTo({ center: [markers[0]!.lng, markers[0]!.lat], zoom: 9 });
      else {
        const b = new LngLatBounds();
        for (const m of markers) b.extend([m.lng, m.lat]);
        map.fitBounds(b, { padding: 50, maxZoom: 10, animate: false });
      }
    }
  }, [markers, fitMarkers]);

  return (
    <div className={`${className} relative overflow-hidden rounded-xl border border-line bg-surface-2`}>
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <p role="alert" className="absolute inset-x-2 bottom-2 rounded-lg bg-warn-bg p-2 text-sm text-warn">
          {error}
        </p>
      )}
      {onPick && !error && (
        <p className="pointer-events-none absolute left-2 top-2 rounded-lg bg-surface/90 px-2 py-1 text-xs font-semibold text-ink-2">
          Tap the map to set the location
        </p>
      )}
    </div>
  );
}
