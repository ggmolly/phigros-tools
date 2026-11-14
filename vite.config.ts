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
      serverDir: "server",
      compressPublicAssets: { gzip: true, zstd: true },
      routeRules: {
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
