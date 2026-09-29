import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [vue()],
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // Route API calls to a local bridge so `pnpm dev` works against a live,
    // logged-in server (cookies are host-scoped, so the admin session carries
    // over from 127.0.0.1:8765 to the dev origin). Point MICLAW_DEV_API at a
    // mock (see ../dev-mock.mjs) for UI work without a real account.
    proxy: {
      "/api": {
        target: process.env.MICLAW_DEV_API ?? "http://127.0.0.1:8765",
        // Forward the bridge's own Host: the loopback Host guard rejects
        // requests addressed as localhost:1420.
        changeOrigin: true,
      },
      "/v1": {
        target: process.env.MICLAW_DEV_API ?? "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
