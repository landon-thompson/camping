/**
 * Base map provider. Swappable via VITE_MAP_STYLE_URL (any MapLibre style URL).
 * Default: OpenFreeMap (free, no key). Respect the provider's usage policy,
 * including for offline caching (Phase 4 must check it).
 */
export const MAP_STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

/** Rough center of the season's area (between the Twin Cities and the North Shore). */
export const MN_CENTER: [number, number] = [-93.2, 46.4];
