import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 3000,
    proxy: (() => {
      const target = process.env.VITE_API_URL ?? "http://localhost:3001";
      const opts = { target, changeOrigin: true };
      return {
        "/api": opts,
        "/auth": opts,
        "/stats": opts,
        "/guilds": opts,
        "/health": opts,
        "/ready": opts,
      };
    })(),
  },
});
