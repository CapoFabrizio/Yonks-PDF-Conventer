import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build = un seul fichier dist/index.html autonome (JS, CSS et worker pdf.js inclus).
// Il fonctionne aussi bien hébergé (Hostinger, GitHub Pages…) qu'ouvert en double-clic.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  worker: { format: "iife" },
  build: { target: "es2020", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
