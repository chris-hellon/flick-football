import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// The ASP.NET Core server listens here in development (see launchSettings.json).
const serverUrl = process.env.FF_SERVER_URL ?? "http://localhost:5080";

// Google Analytics measurement ID, used by production builds only (so local play isn't counted),
// and loaded only after the player accepts cookies (ui/consent.ts).
const gaId = process.env.FF_GA_ID ?? "G-VJ02JE8H42";

// "Buy me a coffee" link.
const tipUrl = process.env.FF_TIP_URL ?? "https://revolut.me/c_hellon";

const THEME = "#0b1411";

export default defineConfig(({ command }) => ({
  define: {
    __GA_ID__: JSON.stringify(command === "build" && /^G-[A-Z0-9]+$/.test(gaId) ? gaId : ""),
    __TIP_URL__: JSON.stringify(/^https:\/\//.test(tipUrl) ? tipUrl : ""),
  },
  plugins: [
    // Installable web app: manifest, icons and a service worker that keeps the whole game
    // (everything but online matches) working offline.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Flick Football",
        short_name: "Flick Football",
        description:
          "A table-football flicking game. Build your club, flick your players, win the Cup.",
        lang: "en-GB",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: THEME,
        background_color: THEME,
        categories: ["games", "sports"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // The app shell and woff2 fonts (every browser that runs a service worker reads woff2).
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Club names are typed in Latin scripts; the Vietnamese font subset is never needed offline.
        globIgnores: ["**/*vietnamese*"],
        navigateFallback: "/index.html",
        // The online hub and the health check always go to the server.
        navigateFallbackDenylist: [/^\/hubs\//, /^\/healthz/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Tests run from the repo root, so keep caches inside this package.
  cacheDir: fileURLToPath(new URL("node_modules/.vite", import.meta.url)),
  server: {
    proxy: {
      "/hubs": { target: serverUrl, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "../FlickFootball.Server/wwwroot",
    emptyOutDir: true,
  },
  test: {
    root: "../..",
    include: ["tests/client/**/*.test.ts"],
  },
}));
