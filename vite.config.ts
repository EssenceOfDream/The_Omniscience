import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const host = process.env.TAURI_DEV_HOST;
const configDir = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@viewRuntime": path.resolve(configDir, "src/viewRuntime/index.js"),
      "@themes": path.resolve(configDir, "themes"),
    },
  },

  build: {
    rollupOptions: {
      input: {
        desktop: path.resolve(configDir, "index.html"),
        panel: path.resolve(configDir, "panel.html"),
        controls: path.resolve(configDir, "controls.html"),
        overview: path.resolve(configDir, "overview.html"),
        windowSettings: path.resolve(configDir, "window-settings.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    fs: {
      allow: [
        configDir,
        path.join(configDir, "componentapps", "desktop"),
        path.join(configDir, "componentapps", "topbar-panel"),
        path.join(configDir, "componentapps", "window-controls"),
        path.join(configDir, "src"),
        path.join(configDir, "node_modules"),
      ],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 1420,
    strictPort: true,
  },
}));
