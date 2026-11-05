export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const hex = (c) => c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
export const extOf = (mime) => (mime === "image/png" ? "png" : "jpeg");

/** Parcourt tous les blocs (y compris dans les colonnes). */
export function walkBlocks(blocks, fn) {
  for (const b of blocks) {
    fn(b);
    if (b.kind === "cols") b.cols.forEach((c) => walkBlocks(c.blocks, fn));
    if (b.kind === "table") b.rows.forEach((r) => r.cells.forEach((c) => walkBlocks(c.blocks, fn)));
  }
}

/** Aplatit les colonnes (gauche puis droite) pour les formats sans tableaux imbriqués. */
export function flatten(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === "cols") b.cols.forEach((c) => out.push(...flatten(c.blocks)));
    else if (b.kind === "table") b.rows.forEach((r) => r.cells.forEach((c) => out.push(...flatten(c.blocks))));
    else out.push(b);
  }
  return out;
}
