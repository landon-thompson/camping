import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// --- Phase 4 (trails) — supports the `workbox` section below only. ---
// The base map style host (default OpenFreeMap; swappable via VITE_MAP_STYLE_URL,
// see src/lib/map.ts). Read at build time so the runtime-cache rule below tracks
// whichever style URL this build was configured with.
const MAP_STYLE_HOST = (() => {
  try {
    return new URL(process.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty').host;
  } catch {
    return 'tiles.openfreemap.org';
  }
})();
// USFS MVUM overlay host (see src/features/trails/mvum.ts).
const MVUM_HOST = 'apps.fs.usda.gov';
// `runtimeCaching[].urlPattern` functions are serialized with `Function#toString()`
// into the generated service worker file, so they can't close over these `const`s —
// build a RegExp instead (workbox-build serializes RegExp literally, no closure needed).
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAP_STYLE_HOST_PATTERN = new RegExp(`^https://${escapeRegExp(MAP_STYLE_HOST)}/`);
const MVUM_HOST_PATTERN = new RegExp(`^https://${escapeRegExp(MVUM_HOST)}/`);
// ---

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The preview build runs inside a page where service workers aren't allowed.
      disable: process.env.VITE_PREVIEW === '1',
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Camp Planner',
        short_name: 'Camp',
        description: 'Family camping & overland trip planner',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1a14',
        theme_color: '#1f4d36',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached; data lives in IndexedDB, so the app opens fully offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        // Never let the service worker answer login or API requests.
        navigateFallbackDenylist: [/^\/\.auth\//, /^\/api\//],
        cleanupOutdatedCaches: true,
        // Phase 4 (trails): we deliberately do NOT bulk-prefetch map tiles — see
        // docs/phase-4.md for the tile-policy decision (OpenFreeMap's public terms
        // don't clearly allow scripted bulk/offline downloading). Instead, any tile
        // the app actually requests (while the owner views the map, or during the
        // "prepare offline" pass in src/features/trails/offline.ts, which just pans
        // a real map view) gets cached here so it works again offline.
        runtimeCaching: [
          {
            // Base map style JSON, sprites, glyphs and vector/raster tiles.
            urlPattern: MAP_STYLE_HOST_PATTERN,
            handler: 'CacheFirst',
            options: {
              // Keep in sync with MAP_TILE_CACHE_NAME in src/features/trails/offline.ts.
              cacheName: 'camp-planner-map-tiles',
              expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // USFS MVUM overlay images (apps.fs.usda.gov ArcGIS REST "export" endpoint,
            // see src/features/trails/mvum.ts) — a convenience layer, not the legal
            // reference, so a smaller/shorter cache than the base map is enough.
            urlPattern: MVUM_HOST_PATTERN,
            handler: 'CacheFirst',
            options: {
              // Keep in sync with MVUM_TILE_CACHE_NAME in src/features/trails/offline.ts.
              cacheName: 'camp-planner-mvum-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      // Used when running the Functions host directly (see README → Local development).
      '/api': 'http://localhost:7071',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
