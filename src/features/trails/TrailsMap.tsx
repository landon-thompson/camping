import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE_URL, MN_CENTER } from '../../lib/map';
import { attachTrailLayers } from './mapLayers';

export interface TrailsMapProps {
  /** Trip to filter routes/pins to, or null to show everything (the /trails library map). */
  tripId: string | null;
  center?: [number, number];
  zoom?: number;
  className?: string;
  onReady?: (map: MapLibreMap) => void;
  /** Tap-to-drop-a-pin support. */
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
}

/**
 * A small embedded map for the trip trails section (and the /trails
 * library page). Always calls `attachTrailLayers` itself once loaded, so
 * routes/pins/MVUM show up here even before Phase 2's trip map exists.
 */
export function TrailsMap({ tripId, center, zoom = 10, className = 'h-64 w-full overflow-hidden rounded-xl border border-line', onReady, onMapClick }: TrailsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onMapClickRef = useRef(onMapClick);
  onReadyRef.current = onReady;
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cleanupLayers: () => void = () => undefined;
    let map: MapLibreMap | null = null;
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLE_URL,
        center: center ?? MN_CENTER,
        zoom,
      });
    } catch {
      // WebGL unavailable (rare, but shouldn't crash the trip page).
      return;
    }

    const handleClick = (e: MapMouseEvent) => onMapClickRef.current?.(e.lngLat);
    map.on('click', handleClick);
    map.on('load', () => {
      if (!map) return;
      cleanupLayers = attachTrailLayers(map, { tripId });
      onReadyRef.current?.(map);
    });

    return () => {
      map?.off('click', handleClick);
      cleanupLayers();
      map?.remove();
    };
    // Re-create the map if the trip we're scoping it to changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  return <div ref={containerRef} className={className} role="img" aria-label="Map of imported routes and pins" />;
}
