/**
 * USFS Motor Vehicle Use Map (MVUM) source.
 *
 * Source: the Forest Service's public ArcGIS REST "EDW_MVUM" Map Service on
 * the FS Geodata Clearinghouse / Enterprise Data Warehouse (EDW):
 *   https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer
 * (there's also an EDW_MVUM_01 service with the same layers, unlabeled).
 * Sub-layers used here: 4 = "Motor Vehicle Use Map: Roads", 2 = "Motor
 * Vehicle Use Map: Trails" — both national in scope (every National Forest,
 * including Superior and Chippewa NF here in Minnesota).
 *
 * License/attribution: Forest Service EDW geospatial data is a U.S.
 * Government work released as open data (see "What Open Data means for the
 * Forest Service", fs.usda.gov), distributed with the Forest Service's
 * standard geodata disclaimer (no warranty as to accuracy/completeness/
 * currency) rather than a restrictive license. We attribute it as "USDA
 * Forest Service" and always show the legal-reference note below.
 *
 * NOT independently verified from this build environment: outbound network
 * access to apps.fs.usda.gov (and data.fs.usda.gov) is blocked by this
 * sandbox's egress proxy, so the exact service JSON, field names, and CORS
 * headers could not be fetched or curl-tested here. The URL and layer IDs
 * above come from the Forest Service's own public ArcGIS REST directory
 * listing (found via web search, not fetched directly). Before relying on
 * this in the field, the owner should open the URL above in a browser (it
 * renders the standard Esri REST directory page if reachable) and run:
 *   curl -sI "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer/export?bbox=-92,46,-91,47&bboxSR=4326&f=image"
 * and check for a 200 and (if opened from a browser) no CORS error. See
 * docs/phase-4.md for the full writeup and what to do if it's unreachable.
 *
 * Whatever this layer shows, it is a convenience overlay — the printed/
 * official MVUM for the forest is the legal reference for where motor
 * vehicle travel is allowed.
 */

export const MVUM_STATUS = 'verify' as const;

export const MVUM_SERVICE_URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer';

export const MVUM_LAYER_IDS = { roads: 4, trails: 2 } as const;

export const MVUM_ATTRIBUTION = 'USDA Forest Service — Motor Vehicle Use Map (EDW), unverified — verify';

export const MVUM_LEGAL_NOTE = 'The printed/official MVUM is the legal reference.';

/**
 * A MapLibre/Mapbox-GL raster `tiles` URL template using the special
 * `{bbox-epsg-3857}` placeholder, which MapLibre substitutes with each
 * tile's Web Mercator bounding box — the standard way to point a GL raster
 * source at a dynamic ArcGIS Server "export" endpoint instead of a
 * pre-tiled cache.
 */
export function mvumTileUrlTemplate(layerIds: readonly number[] = [MVUM_LAYER_IDS.roads, MVUM_LAYER_IDS.trails]): string {
  const layers = `show:${layerIds.join(',')}`;
  return (
    `${MVUM_SERVICE_URL}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857` +
    `&size=256,256&dpi=96&format=png32&transparent=true&f=image&layers=${layers}`
  );
}

export interface MvumRasterSourceSpec {
  type: 'raster';
  tiles: string[];
  tileSize: number;
  attribution: string;
  minzoom: number;
  maxzoom: number;
}

/** Pure source spec for `map.addSource(id, ...)` — no `Map` instance required, so this is unit-testable. */
export function mvumRasterSource(): MvumRasterSourceSpec {
  return {
    type: 'raster',
    tiles: [mvumTileUrlTemplate()],
    tileSize: 256,
    attribution: MVUM_ATTRIBUTION,
    minzoom: 8,
    maxzoom: 16,
  };
}
