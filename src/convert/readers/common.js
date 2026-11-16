// Gabarit commun des documents « bureautiques » (TXT, DOC, RTF, ODT) affichés avant conversion.
import { escapeHtml } from "../detect.js";

export const A4 = { w: 595.28, h: 841.89 };
export const PX = 0.75; // 1 px CSS = 0,75 pt

/** Document HTML dont la largeur de corps est exactement la largeur utile de la page. */
export function documentHtml({ title = "", body, css = "", page }) {
  const p = page || { w: A4.w, h: A4.h, margins: { t: 56.7, r: 56.7, b: 56.7, l: 56.7 } };
  const contentPx = (p.w - p.margins.l - p.margins.r) / PX;
  return {
    html: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
html { background: #fff; }
body { margin: 0; width: ${contentPx.toFixed(2)}px; font-family: Calibri, Carlito, "Liberation Sans", Arial, sans-serif; font-size: 14.667px; line-height: 1.15; color: #000; overflow-wrap: break-word; }
p { margin: 0; min-height: 1em; }
table { border-collapse: collapse; }
img { max-width: 100%; }
.page-break { break-before: page; height: 0; }
${css}
</style></head><body>${body}</body></html>`,
    page: p,
    title,
  };
}

export { escapeHtml };
