import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so the site works at a domain root or in a subfolder.
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2023", chunkSizeWarningLimit: 900 },
  server: { port: 5174, strictPort: true },
  preview: { port: 5175, strictPort: true },
});
