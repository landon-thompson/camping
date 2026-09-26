import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
