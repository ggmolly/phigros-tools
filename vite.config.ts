import babel from "@rolldown/plugin-babel";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    nitro({
      // the server runs on Bun (deploy.sh), whose own WebSocket server carries the pages' live events (server/live.ts)
      preset: "bun",
      features: { websocket: true },
      serverDir: "server",
      // drizzle talks to PostgreSQL through Bun's own client, which it imports by this name
      builtinModules: ["bun"],
      compressPublicAssets: { gzip: true, zstd: true },
      routeRules: {
        // what an admin sees is kept by no cache, the browser's included
        "/api/admin/**": { headers: { "cache-control": "private, no-store" } },
        "/**": {
          headers: {
            "strict-transport-security": "max-age=31536000",
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
            "content-security-policy": "frame-ancestors 'none'",
            "x-frame-options": "DENY",
          },
        },
      },
    }),
  ],
});
