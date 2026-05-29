import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Default je 2 MiB, ale náš main bundle s Three.js + Butterchurn +
        // Mediabunny dělá ~2.1 MB. Zvyšujeme na 5 MiB s rezervou pro budoucí
        // růst (Fáze 3 přidá AI image generation klient).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'DJ Enda — Hudební videoklipy',
        short_name: 'DJ Enda',
        description:
          'Tvor hudební videoklipy přímo v prohlížeči ze Suno AI tracků.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'cs',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        // SW v dev módu vypnutý — dělal cache/reload neplechu a na ladění není
        // potřeba (PWA se testuje na produkčním buildu).
        enabled: false,
      },
    }),
  ],
})
