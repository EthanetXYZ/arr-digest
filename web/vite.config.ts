import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Arr Digest",
        short_name: "Arr Digest",
        description: "Live Sonarr/Radarr activity feed and Discord digest",
        start_url: "/",
        display: "standalone",
        background_color: "#020617",
        theme_color: "#020617",
        // PNGs too: iOS and some Android launchers ignore SVG icons. The
        // 512px one is also the Unraid template icon.
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        // This app is a live dashboard (WebSocket + polling API) — caching
        // API responses would show stale data, so only the static app
        // shell (JS/CSS/HTML/icon) is precached. /api/* always hits the
        // network, and SPA routes (e.g. /settings) still fall back to the
        // cached index.html so deep links work once installed.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
