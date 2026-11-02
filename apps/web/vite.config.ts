import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/events": "http://127.0.0.1:8765", "/auth": "http://127.0.0.1:8765", "/session": "http://127.0.0.1:8765", "/lap": "http://127.0.0.1:8765", "/field": "http://127.0.0.1:8765", "/track": "http://127.0.0.1:8765", "/pit": "http://127.0.0.1:8765", "/config": "http://127.0.0.1:8765", "/mfd": "http://127.0.0.1:8765" },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
