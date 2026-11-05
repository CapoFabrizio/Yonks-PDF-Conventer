// Texte brut : paragraphes séparés par une ligne vide, tableaux en colonnes tabulées.
function blocksText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === "p") out.push(b.runs.map((r) => r.text).join(""));
    else if (b.kind === "cols") b.cols.forEach((c) => out.push(...blocksText(c.blocks)));
    else if (b.kind === "table") out.push(b.rows.map((r) => r.cells.map((c) => blocksText(c.blocks).join(" ")).join("\t")).join("\n"));
  }
  return out;
}

export function writeTxt(model) {
  const pages = model.pages.map((p) => blocksText(p.blocks).filter((t) => t.trim()).join("\n\n"));
  return new TextEncoder().encode("\uFEFF" + pages.join("\n\n\f\n"));
}
