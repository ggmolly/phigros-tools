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
    nitro({ serverDir: "server", compressPublicAssets: { gzip: true, zstd: true } }),
  ],
});
