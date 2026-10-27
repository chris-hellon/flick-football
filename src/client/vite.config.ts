import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The ASP.NET Core server listens here in development (see launchSettings.json).
const serverUrl = process.env.FF_SERVER_URL ?? "http://localhost:5080";

// Google Analytics measurement ID. Added to production builds only, so local play isn't counted.
const gaId = process.env.FF_GA_ID ?? "G-VJ02JE8H42";

/** The Google tag (gtag.js), first thing in <head> as Google recommends. */
function googleTag(id: string): Plugin {
  return {
    name: "google-tag",
    apply: "build",
    transformIndexHtml: (): HtmlTagDescriptor[] =>
      /^G-[A-Z0-9]+$/.test(id)
        ? [
            {
              tag: "script",
              attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
              injectTo: "head-prepend",
            },
            {
              tag: "script",
              children: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');`,
              injectTo: "head-prepend",
            },
          ]
        : [],
  };
}

export default defineConfig({
  plugins: [googleTag(gaId)],
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
});
