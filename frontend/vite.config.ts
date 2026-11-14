import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'pictos/*.png'],
      manifest: {
        name: 'Encuesta de Díadas',
        short_name: 'Díadas',
        description: 'Instrumento de la Fase II: barrio caminable de personas con síndrome de Down en Santiago',
        lang: 'es-CL',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f7f6',
        theme_color: '#0e7c6b',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Estilo, tipografías e íconos del mapa: permiten reabrir un mapa ya visto con mala conexión.
            urlPattern: /^https:\/\/api\.mapbox\.com\/(styles|fonts)\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'mapa-estilos', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' }, fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 2500 },
});
