import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync("../../package.json", "utf8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
