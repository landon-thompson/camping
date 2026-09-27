import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
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
  className = 'h-[50vh] min-h-72 w-full',
}: {
  center: [number, number];
  zoom?: number;
  markers?: TripMapMarker[];
  /** Trip context passed to attachTrailLayers; null on the season map. */
  tripId: string | null;
  /** When set, tapping the map reports the lat/lng (used to place a trip's location). */
  onPick?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the initial center/zoom seed the map
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let cleanupTrails = () => undefined as void;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({ container, style: MAP_STYLE_URL, center, zoom, attributionControl: false });
    } catch {
      setError('The map couldn’t load. You can still enter coordinates by hand.');
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
      if (!cancelled) setError('Map tiles are unavailable right now (offline, or the tile server is unreachable). You can still enter coordinates by hand.');
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
    markersRef.current = markers.map((m) => {
      const el = document.createElement('div');
      const colors =
        m.variant === 'home'
          ? 'border-accent bg-accent text-white'
          : m.variant === 'plain'
            ? 'border-line bg-surface text-ink'
            : 'border-white bg-brand text-brand-ink';
      el.className = `grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-bold shadow ${colors}`;
      el.textContent = m.label;
      return new Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map);
    });
  }, [markers]);

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
