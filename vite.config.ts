import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri 2 dev defaults
// - Fixed port from env (TAURI_DEV_HOST) when running on a device, else auto.
// - HMR over WS on the same host:port.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,
  server: {
    // Unique per-app port so filehelm coexists with paliaplay overlay
    // (1420), taskmgr_TauriRust (1420), lobegui (5183), teki-bridge
    // (5174), and others. tauri.conf.json's devUrl must stay in sync.
    port: 5191,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5192 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
