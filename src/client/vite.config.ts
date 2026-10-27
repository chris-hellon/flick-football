import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The ASP.NET Core server listens here in development (see launchSettings.json).
const serverUrl = process.env.FF_SERVER_URL ?? "http://localhost:5080";

export default defineConfig({
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
