// Écriture HTML à partir du modèle de document extrait d'un PDF : une page web autonome,
// avec les images intégrées en data URI, lisible dans n'importe quel navigateur.
import { esc, hex } from "./util.js";

function runHtml(r) {
  const css = [
    `font-family:'${esc(r.font || "Liberation Sans")}',sans-serif`,
    `font-size:${(r.size || 11).toFixed(2)}pt`,
    r.bold ? "font-weight:bold" : "",
    r.italic ? "font-style:italic" : "",
    `color:#${hex(r.color || [0, 0, 0])}`,
  ].filter(Boolean).join(";");
  return `<span style="${css}">${esc(r.text).replace(/ {2}/g, " &nbsp;")}</span>`;
}

function blockHtml(b, widthPt) {
  if (b.kind === "img") {
    const w = Math.min(b.wPt, widthPt);
    const h = b.hPt * (w / b.wPt);
    const align = { left: "left", center: "center", right: "right" }[b.align || "left"];
    return `<div style="text-align:${align};margin:${(b.spaceBefore || 0).toFixed(1)}pt 0 0 ${(b.indent || 0).toFixed(1)}pt"><img src="data:${b.mime};base64,${toBase64(b.data)}" style="width:${w.toFixed(1)}pt;height:${h.toFixed(1)}pt;max-width:100%" alt=""></div>`;
  }
  if (b.kind === "cols") {
    return `<div style="display:flex;gap:6pt">${b.cols.map((c) => `<div style="flex:0 0 ${c.width.toFixed(1)}pt">${c.blocks.map((bb) => blockHtml(bb, c.width)).join("")}</div>`).join("")}</div>`;
  }
  if (b.kind === "table") {
    const border = b.border ? `border:${Math.max(0.5, b.border.width || 0.75).toFixed(2)}pt solid #${hex(b.border.color || [0, 0, 0])}` : "border:0.75pt solid #000";
    const cols = b.colWidths && b.colWidths.length ? `<colgroup>${b.colWidths.map((w) => `<col style="width:${w.toFixed(1)}pt">`).join("")}</colgroup>` : "";
    const rows = b.rows.map((row) => `<tr${row.height ? ` style="height:${row.height.toFixed(1)}pt"` : ""}>${row.cells.map((cell) => {
      if (cell.skip) return "";
      const bg = cell.shade ? `background-color:#${hex(cell.shade)};` : "";
      return `<td${cell.span > 1 ? ` colspan="${cell.span}"` : ""} style="${bg}${border};padding:2pt 4pt;vertical-align:top">${cell.blocks.map((bb) => blockHtml(bb, cell.width)).join("") || "&nbsp;"}</td>`;
    }).join("")}</tr>`).join("");
    return `<table style="border-collapse:collapse;width:100%;margin:${(b.spaceBefore || 0).toFixed(1)}pt 0 0">${cols}${rows}</table>`;
  }
  // paragraphe
  const align = { left: "left", center: "center", right: "right", justify: "justify" }[b.align || "left"];
  const css = [
    `text-align:${align}`,
    `margin:${(b.spaceBefore || 0).toFixed(1)}pt 0 0 ${(b.indent || 0).toFixed(1)}pt`,
    b.firstLine ? `text-indent:${b.firstLine.toFixed(1)}pt` : "",
    `line-height:${(b.lineRatio || 1.15).toFixed(2)}`,
    b.shade ? `background-color:#${hex(b.shade)}` : "",
    b.shade && b.shadePad ? `padding:${b.shadePad.toFixed(1)}pt 4pt` : "",
  ].filter(Boolean).join(";");
  const tag = b.heading ? "h2" : "p";
  const inner = (b.runs || []).map(runHtml).join("") || "&nbsp;";
  return `<${tag} style="${css}">${inner}</${tag}>`;
}

function toBase64(data) {
  if (typeof data === "string") return data;
  let bin = "";
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** model : { pageW, pageH, margins, pages:[{blocks, background}], title } */
export function writeHtml(model) {
  const contentW = model.pageW - model.margins.l - model.margins.r;
  const pagesHtml = model.pages.map((page, i) => {
    const bg = page.background ? `background-color:#${hex(page.background)};` : "background:#fff;";
    const content = (page.blocks || []).map((b) => blockHtml(b, contentW)).join("");
    return `<section class="page" style="${bg}width:${model.pageW.toFixed(1)}pt;min-height:${model.pageH.toFixed(1)}pt;padding:${model.margins.t.toFixed(1)}pt ${model.margins.r.toFixed(1)}pt ${model.margins.b.toFixed(1)}pt ${model.margins.l.toFixed(1)}pt;box-sizing:border-box;margin:0 auto 16pt;box-shadow:0 1px 4px rgba(0,0,0,.25)">${content}</section>`;
  }).join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(model.title || "Document")}</title><style>
html,body { margin:0; background:#e5e5e5; font-family: "Liberation Sans", Arial, sans-serif; }
p,h1,h2,h3 { margin:0; }
table { border-collapse: collapse; }
@media print { html,body { background:#fff; } .page { box-shadow:none !important; margin:0 !important; } }
</style></head><body>${pagesHtml}</body></html>`;
  return new TextEncoder().encode(html);
}
