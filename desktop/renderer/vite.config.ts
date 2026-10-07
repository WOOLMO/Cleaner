import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    target: "chrome130",
    chunkSizeWarningLimit: 900,
  },
});
