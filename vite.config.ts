import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite config for the renderer (React) process.
// The Electron main/preload are built separately via tsc (see electron/tsconfig.json).
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
