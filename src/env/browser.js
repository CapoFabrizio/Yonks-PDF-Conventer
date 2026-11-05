// Environnement navigateur : pdf.js + worker embarqué (aucune dépendance réseau).
import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.js?worker&inline";

// Un seul worker, persistant et passé explicitement à chaque document : ainsi fermer un
// document (aperçu, conversion) ne détruit pas le worker utilisé par les autres.
const worker = new pdfjs.PDFWorker({ port: new PdfWorker() });

export { pdfjs };

export const env = {
  createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  },
  encode(canvas, mime, quality = 0.9) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("Encodage d'image impossible (page trop grande ?)")); return; }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, mime, quality);
    });
  },
};

// Polices standard et tables CJK : chargées à la demande seulement si le PDF en a besoin.
export const docOptions = {
  worker,
  cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/",
  useSystemFonts: true,
};
