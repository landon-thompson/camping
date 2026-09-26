import type { Map as MapLibreMap } from 'maplibre-gl';

export interface MapContext {
  /** Trip being shown, or null on the season map. */
  tripId: string | null;
}

/**
 * CONTRACT: every app map (Phase 2) calls this once the map has loaded.
 * Phase 4 adds MVUM roads, imported routes and pins here. Returns cleanup.
 */
export function attachTrailLayers(_map: MapLibreMap, _ctx: MapContext): () => void {
  return () => undefined;
}
