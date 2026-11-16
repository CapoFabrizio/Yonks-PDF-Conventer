import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "url";

// Build = un seul fichier dist/index.html autonome (JS, CSS et worker pdf.js inclus).
// Il fonctionne aussi bien hébergé (Hostinger, GitHub Pages…) qu'ouvert en double-clic.
const emptyModule = fileURLToPath(new URL("./scripts/empty-module.js", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  worker: { format: "iife" },
  build: { target: "es2020", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  resolve: {
    alias: {
      // jsPDF ne charge ces modules que pour sa méthode html() (non utilisée ici) : on évite
      // de les empaqueter (ils ne sont même pas installés).
      html2canvas: emptyModule,
      dompurify: emptyModule,
      canvg: emptyModule,
    },
  },
});
