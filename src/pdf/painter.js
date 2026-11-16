// Peintre PDF : transforme un document HTML déjà rendu (dans un iframe réel, donc avec la mise
// en page exacte du navigateur) en PDF vectoriel sélectionnable, page par page, sans jamais
// couper une ligne de texte, une image ou une ligne de tableau.
import { jsPDF } from "jspdf";
import { FONTS, COVERAGE } from "./fonts.js";

const PX = 0.75; // 1 px CSS -> 0,75 pt (96 dpi -> 72 dpi)

// ---------------------------------------------------------------- couleurs
const colorCache = new Map();
let colorCanvas = null;
function parseColor(css) {
  if (!css) return null;
  if (colorCache.has(css)) return colorCache.get(css);
  if (css === "transparent" || css === "rgba(0, 0, 0, 0)") { colorCache.set(css, null); return null; }
  colorCanvas ||= document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 1;
  const ctx = colorCanvas.getContext("2d");
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const out = a === 0 ? null : [r, g, b];
  colorCache.set(css, out);
  return out;
}

// ---------------------------------------------------------------- polices
function familyKey(cssFontFamily) {
  const f = (cssFontFamily || "").toLowerCase();
  if (/mono|courier|consolas|menlo|ubuntu mono/.test(f)) return "mono";
  if (/serif/.test(f) && !/sans-serif/.test(f) || /times|georgia|cambria|garamond|liberation serif/.test(f)) return "serif";
  return "sans";
}
function styleKey(bold, italic) { return bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal"; }
const EMBEDDED = new Set();
function pdfFontName(family) { return `Yonks${family[0].toUpperCase()}${family.slice(1)}`; }
function ensureFont(doc, family, style) {
  const key = `${family}-${style}`;
  const fname = pdfFontName(family);
  if (EMBEDDED.has(key)) return fname;
  const b64 = FONTS[key] || FONTS[`${family}-normal`];
  const file = `${key}.ttf`;
  doc.addFileToVFS(file, b64);
  doc.addFont(file, fname, style === "normal" ? "normal" : style === "bold" ? "bold" : style === "italic" ? "italic" : "bolditalic", "Identity-H");
  EMBEDDED.add(key);
  return fname;
}
function covered(ch) {
  const cp = ch.codePointAt(0);
  for (const [a, b] of COVERAGE) if (cp >= a && cp <= b) return true;
  return false;
}
function isCovered(text) { for (const ch of text) if (!covered(ch)) return false; return true; }

// ---------------------------------------------------------------- mesure du DOM
function closestTr(el) { return el.closest ? el.closest("tr") : null; }

function computedFontOf(el) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  return {
    family: familyKey(cs.fontFamily),
    size: parseFloat(cs.fontSize) || 12,
    bold: parseFloat(cs.fontWeight) >= 600,
    italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique",
    color: parseColor(cs.color) || [0, 0, 0],
    underline: /underline/.test(cs.textDecorationLine || cs.textDecoration || ""),
    strike: /line-through/.test(cs.textDecorationLine || cs.textDecoration || ""),
    cssFamily: cs.fontFamily,
  };
}

function walk(doc) {
  const win = doc.defaultView;
  const body = doc.body;
  const items = [];
  const seenBg = new WeakSet();

  // fonds et bordures des éléments de bloc
  const all = doc.querySelectorAll("*");
  for (const el of all) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    // un saut de page forcé est un marqueur de hauteur nulle : il doit être détecté avant le
    // filtre « élément sans surface visible » ci-dessous, sinon il est ignoré à tort.
    if ((el.classList && el.classList.contains("page-break")) || cs.breakBefore === "page" || cs.pageBreakBefore === "always") {
      items.push({ type: "break", top: rect.top, bottom: rect.top });
    }
    if (rect.width <= 0 || rect.height <= 0) continue;
    const bg = parseColor(cs.backgroundColor);
    if (bg && !seenBg.has(el)) items.push({ type: "bg", top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height, color: bg });
    const borders = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const w = parseFloat(cs[`border${side[0].toUpperCase()}${side.slice(1)}Width`]);
      const style = cs[`border${side[0].toUpperCase()}${side.slice(1)}Style`];
      if (w > 0 && style !== "none") borders[side] = { width: w, color: parseColor(cs[`border${side[0].toUpperCase()}${side.slice(1)}Color`]) || [0, 0, 0] };
    }
    if (Object.keys(borders).length) items.push({ type: "border", top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height, borders });
  }

  // images
  for (const img of doc.querySelectorAll("img")) {
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    items.push({ type: "img", top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height, el: img });
  }

  // texte : mot par mot (segments non blancs), pour un placement précis et des liens cliquables
  const tw = doc.createTreeWalker(body, win.NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return win.NodeFilter.FILTER_REJECT;
      let p = n.parentElement;
      while (p) { if (p.tagName === "SCRIPT" || p.tagName === "STYLE" || p.hidden) return win.NodeFilter.FILTER_REJECT; p = p.parentElement; }
      return win.NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  const fontCache = new Map();
  while ((node = tw.nextNode())) {
    const parent = node.parentElement;
    let font = fontCache.get(parent);
    if (!font) { font = computedFontOf(parent); fontCache.set(parent, font); }
    const anchor = parent.closest("a[href]");
    const href = anchor ? anchor.getAttribute("href") : null;
    const text = node.nodeValue;
    const re = /\S+\s*/g;
    let m;
    while ((m = re.exec(text))) {
      const range = doc.createRange();
      const trimmed = m[0].replace(/\s+$/, "");
      if (!trimmed) continue;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + trimmed.length);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      for (const r of rects) {
        if (r.width <= 0 || r.height <= 0) continue;
        items.push({ type: "text", top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height, text: trimmed, font, href });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------- pagination (bandes + décalage)
function paginate(items, pageContentHeightPx) {
  const rowItems = new Map(); // tr -> items
  const loose = [];
  for (const it of items) {
    const tr = it.el ? closestTr(it.el) : null;
    if (tr) { (rowItems.get(tr) || rowItems.set(tr, []).get(tr)).push(it); }
    else loose.push(it);
  }
  // les items texte n'ont pas d'élément direct exploitable pour closest(); on les rattache via un marqueur
  // (géré plus haut : seuls les items 'img' portent .el ; le texte dans un tableau reste dans `loose`
  // mais sera naturellement regroupé par chevauchement vertical avec les autres cellules de la même ligne)

  loose.sort((a, b) => a.top - b.top);
  const bands = [];
  let current = null;
  for (const it of loose) {
    if (it.type === "break") { bands.push({ top: it.top, bottom: it.top, items: [], forceBreak: true }); current = null; continue; }
    if (current && it.top < current.bottom - 0.5) { current.items.push(it); current.bottom = Math.max(current.bottom, it.bottom); current.top = Math.min(current.top, it.top); }
    else { current = { top: it.top, bottom: it.bottom, items: [it] }; bands.push(current); }
  }
  for (const [, arr] of rowItems) {
    const top = Math.min(...arr.map((i) => i.top)), bottom = Math.max(...arr.map((i) => i.bottom));
    bands.push({ top, bottom, items: arr });
  }
  bands.sort((a, b) => a.top - b.top || a.bottom - b.bottom);

  let shift = 0;
  let maxPage = 0;
  const placed = [];
  for (const band of bands) {
    if (band.forceBreak) {
      const outTop = band.top + shift;
      const target = (Math.floor(outTop / pageContentHeightPx) + (outTop % pageContentHeightPx > 0.01 ? 1 : 0)) * pageContentHeightPx;
      shift += target - outTop;
      continue;
    }
    let outTop = band.top + shift;
    let outBottom = band.bottom + shift;
    const pTop = Math.floor(outTop / pageContentHeightPx);
    const pBottom = Math.floor(Math.max(outTop, outBottom - 0.01) / pageContentHeightPx);
    if (pBottom > pTop && outBottom - outTop < pageContentHeightPx) {
      const newOutTop = (pTop + 1) * pageContentHeightPx;
      shift += newOutTop - outTop;
      outTop = newOutTop; outBottom = band.bottom + shift;
    }
    const page = Math.floor(outTop / pageContentHeightPx);
    maxPage = Math.max(maxPage, page);
    for (const it of band.items) placed.push({ ...it, page, localTop: it.top + shift - page * pageContentHeightPx });
  }
  return { placed, totalPages: maxPage + 1 };
}

// ---------------------------------------------------------------- rasterisation de secours (hors couverture Latin)
function rasterizeWord(text, font) {
  const scale = 3;
  const sizePx = font.size * scale;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const weight = font.bold ? "bold" : "normal";
  const style = font.italic ? "italic" : "normal";
  ctx.font = `${style} ${weight} ${sizePx}px ${font.cssFamily}, sans-serif`;
  const metrics = ctx.measureText(text);
  const w = Math.max(1, Math.ceil(metrics.width) + 4);
  const h = Math.max(1, Math.ceil(sizePx * 1.4));
  c.width = w; c.height = h;
  ctx.font = `${style} ${weight} ${sizePx}px ${font.cssFamily}, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = `rgb(${font.color[0]},${font.color[1]},${font.color[2]})`;
  const baseline = Math.round(h * 0.78);
  ctx.fillText(text, 2, baseline);
  return { canvas: c, w, h, baseline };
}

const metricsCache = new Map();
function ascentRatio(font) {
  const key = `${font.cssFamily}|${font.bold}|${font.italic}`;
  if (metricsCache.has(key)) return metricsCache.get(key);
  let ratio = 0.8;
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.font = `${font.italic ? "italic" : ""} ${font.bold ? "bold" : ""} 100px ${font.cssFamily}, sans-serif`.trim();
    const m = ctx.measureText("Hxjpqy");
    if (m.fontBoundingBoxAscent) ratio = m.fontBoundingBoxAscent / 100;
  } catch (e) { /* valeur par défaut conservée */ }
  metricsCache.set(key, ratio);
  return ratio;
}

// ---------------------------------------------------------------- image -> source utilisable par jsPDF
async function imageSource(img) {
  if (img.complete && img.naturalWidth > 0) return img;
  await new Promise((res) => { img.onload = res; img.onerror = res; });
  return img.naturalWidth > 0 ? img : null;
}

// ---------------------------------------------------------------- peinture
export async function paintToPdf(doc, { page, title, onProgress } = {}) {
  const body = doc.body;
  const contentWidthPx = body.getBoundingClientRect().width;
  const marginL = page.margins.l, marginT = page.margins.t;
  const contentHeightPt = page.h - page.margins.t - page.margins.b;
  const pageContentHeightPx = contentHeightPt / PX;

  const rawItems = walk(doc);
  const { placed, totalPages } = paginate(rawItems, pageContentHeightPx);

  const pdf = new jsPDF({ unit: "pt", format: [page.w, page.h], putOnlyUsedFonts: true, compress: true });
  if (title) pdf.setProperties({ title });
  for (let p = 1; p < totalPages; p++) pdf.addPage([page.w, page.h]);

  const byPage = new Map();
  for (const it of placed) { (byPage.get(it.page) || byPage.set(it.page, []).get(it.page)).push(it); }

  for (let p = 0; p < totalPages; p++) {
    pdf.setPage(p + 1);
    const list = byPage.get(p) || [];
    // fonds
    for (const it of list) if (it.type === "bg") {
      pdf.setFillColor(...it.color);
      pdf.rect(marginL + it.left * PX, marginT + it.localTop * PX, it.width * PX, it.height * PX, "F");
    }
    // images
    for (const it of list) if (it.type === "img") {
      const src = await imageSource(it.el);
      if (!src) continue;
      try { pdf.addImage(src, "PNG", marginL + it.left * PX, marginT + it.localTop * PX, it.width * PX, it.height * PX, undefined, "SLOW"); }
      catch (e) { /* image illisible (tainted/format non pris en charge) : ignorée */ }
    }
    // bordures
    for (const it of list) if (it.type === "border") {
      const x = marginL + it.left * PX, y = marginT + it.localTop * PX, w = it.width * PX, h = it.height * PX;
      for (const side of Object.keys(it.borders)) {
        const b = it.borders[side];
        pdf.setDrawColor(...b.color);
        pdf.setLineWidth(Math.max(0.3, b.width * PX));
        if (side === "top") pdf.line(x, y, x + w, y);
        else if (side === "bottom") pdf.line(x, y + h, x + w, y + h);
        else if (side === "left") pdf.line(x, y, x, y + h);
        else pdf.line(x + w, y, x + w, y + h);
      }
    }
    // texte
    for (const it of list) if (it.type === "text") {
      const style = styleKey(it.font.bold, it.font.italic);
      const x = marginL + it.left * PX;
      const yTop = marginT + it.localTop * PX;
      if (isCovered(it.text)) {
        const fname = ensureFont(pdf, it.font.family, style);
        pdf.setFont(fname, style === "normal" ? "normal" : style);
        pdf.setFontSize(it.font.size * PX);
        pdf.setTextColor(...it.font.color);
        const ascent = ascentRatio(it.font);
        const baselineY = yTop + it.height * PX * ascent * 0.92;
        const scaleX = it.width > 0 ? (pdf.getStringUnitWidth(it.text) * it.font.size * PX) : 0;
        const opts = {};
        if (scaleX > 0) opts.maxWidth = undefined;
        if (it.href) { try { pdf.link(x, yTop, it.width * PX, it.height * PX, { url: /^https?:|^mailto:/.test(it.href) ? it.href : undefined }); } catch (e) { /* ignore */ } }
        try {
          const natural = pdf.getTextWidth(it.text);
          const hs = natural > 0 ? (it.width * PX) / natural : 1;
          pdf.text(it.text, x, baselineY, { horizontalScale: Math.min(3, Math.max(0.3, hs)) });
        } catch (e) { pdf.text(it.text, x, baselineY); }
        if (it.font.underline) { pdf.setDrawColor(...it.font.color); pdf.setLineWidth(Math.max(0.4, it.font.size * PX * 0.05)); pdf.line(x, yTop + it.height * PX * 0.92, x + it.width * PX, yTop + it.height * PX * 0.92); }
        if (it.font.strike) { pdf.setDrawColor(...it.font.color); pdf.setLineWidth(Math.max(0.4, it.font.size * PX * 0.05)); pdf.line(x, yTop + it.height * PX * 0.55, x + it.width * PX, yTop + it.height * PX * 0.55); }
      } else {
        const r = rasterizeWord(it.text, it.font);
        try { pdf.addImage(r.canvas, "PNG", x, yTop, it.width * PX, it.height * PX); } catch (e) { /* ignore */ }
        if (it.href) { try { pdf.link(x, yTop, it.width * PX, it.height * PX, { url: /^https?:|^mailto:/.test(it.href) ? it.href : undefined }); } catch (e) { /* ignore */ } }
      }
    }
    if (onProgress) onProgress((p + 1) / totalPages);
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
