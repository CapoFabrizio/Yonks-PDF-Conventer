// Analyse d'une page PDF avec pdf.js : extrait les fragments de texte (avec police,
// taille, gras/italique, couleur), les images (pixels d'origine, à leur position),
// les rectangles de fond et les graphiques vectoriels.
//
// Tout est exprimé en points PDF, origine en haut à gauche (espace "appareil" à l'échelle 1).

import { mul, apply, bboxOf, area, width, height, expand, intersect, union, contains } from "./geometry.js";

const IDENTITY = [1, 0, 0, 1, 0, 0];
const MAX_IMAGE_PX = 2400;   // résolution max d'une image extraite (côté le plus long)
const FIGURE_RENDER_SCALE = 2.5; // ~180 dpi pour les graphiques vectoriels découpés
const MAX_RENDER_PX = 5000;      // garde-fou mémoire pour les très grands formats (affiches)

/**
 * @param page     page pdf.js (PDFPageProxy)
 * @param pdfjs    module pdf.js (pour OPS)
 * @param env      { createCanvas(w,h), encode(canvas, mime, quality) -> Promise<Uint8Array> }
 */
export async function analyzePage(page, pdfjs, env, rotation) {
  const OPS = pdfjs.OPS;
  const viewport = page.getViewport(rotation === undefined ? { scale: 1 } : { scale: 1, rotation });
  const vt = viewport.transform;
  const W = viewport.width, H = viewport.height;

  const opList = await page.getOperatorList();
  const textContent = await page.getTextContent();

  // ---------- 1. Parcours des opérateurs : CTM, couleurs, images, chemins ----------
  const images = [];        // { bbox, matrix, obj | null, kind: 'image'|'mask' }
  const paths = [];         // { bbox, isRect, hasCurve, segments, filled, stroked, fill }
  const textOrigins = [];   // { x, y, color, invisible }

  let state = { ctm: IDENTITY, fill: [0, 0, 0], stroke: [0, 0, 0], renderMode: 0, lineWidth: 1, fillAlpha: 1, strokeAlpha: 1 };
  const stack = [];
  let tm = IDENTITY, lm = IDENTITY, leading = 0;
  let pendingPath = null;

  const fnArray = opList.fnArray, argsArray = opList.argsArray;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ...state }); break;
      case OPS.restore: if (stack.length) state = stack.pop(); break;
      case OPS.transform: state.ctm = mul(state.ctm, args); break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...state });
        if (Array.isArray(args[0]) && args[0].length === 6) state.ctm = mul(state.ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd: if (stack.length) state = stack.pop(); break;
      case OPS.setFillRGBColor: state.fill = [args[0], args[1], args[2]]; break;
      case OPS.setStrokeRGBColor: state.stroke = [args[0], args[1], args[2]]; break;
      case OPS.setTextRenderingMode: state.renderMode = args[0]; break;
      case OPS.setLineWidth: state.lineWidth = args[0]; break;
      case OPS.setGState:
        for (const [k, v] of args[0] || []) {
          if (k === "ca") state.fillAlpha = v;
          else if (k === "CA") state.strokeAlpha = v;
          else if (k === "LW") state.lineWidth = v;
        }
        break;
      case OPS.beginText: tm = IDENTITY; lm = IDENTITY; break;
      case OPS.setTextMatrix: tm = lm = args.slice(0, 6); break;
      case OPS.setLeading: leading = args[0]; break;
      case OPS.setLeadingMoveText: leading = -args[1]; // fallthrough
      case OPS.moveText:
        lm = [lm[0], lm[1], lm[2], lm[3], lm[4] + args[0] * lm[0] + args[1] * lm[2], lm[5] + args[0] * lm[1] + args[1] * lm[3]];
        tm = lm;
        break;
      case OPS.nextLine:
        lm = [lm[0], lm[1], lm[2], lm[3], lm[4] - leading * lm[2], lm[5] - leading * lm[3]];
        tm = lm;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText: {
        const m = mul(vt, mul(state.ctm, tm));
        textOrigins.push({ x: m[4], y: m[5], color: state.fill, invisible: state.renderMode === 3 || state.renderMode === 7 });
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat: {
        const m = mul(vt, state.ctm);
        const bbox = bboxOf(m, 0, 0, 1, 1);
        if (area(bbox) < 16) break; // pixels isolés / puces minuscules
        let obj = null;
        if (fn === OPS.paintInlineImageXObject) obj = args[0];
        else if (fn !== OPS.paintImageMaskXObject && typeof args[0] === "string") obj = await getObj(page, args[0]);
        images.push({ bbox, matrix: m, obj, kind: fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat ? "mask" : "image" });
        break;
      }
      case OPS.constructPath: {
        const geo = pathGeometry(args[0], args[1], OPS);
        if (!geo) { pendingPath = null; break; }
        const m = mul(vt, state.ctm);
        const straight = Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6;
        pendingPath = {
          bbox: bboxOf(m, geo.minX, geo.minY, geo.maxX, geo.maxY),
          hasCurve: geo.hasCurve, segments: geo.segments,
          isRect: geo.isRect, straightRect: straight,
          lineWidth: state.lineWidth * Math.hypot(m[0], m[1]),
        };
        break;
      }
      case OPS.fill: case OPS.eoFill: case OPS.fillStroke: case OPS.eoFillStroke:
      case OPS.closeFillStroke: case OPS.closeEOFillStroke: case OPS.stroke: case OPS.closeStroke:
        if (pendingPath) {
          const filled = fn !== OPS.stroke && fn !== OPS.closeStroke;
          const stroked = fn !== OPS.fill && fn !== OPS.eoFill;
          const visibleFill = filled && state.fillAlpha > 0.05;
          const visibleStroke = stroked && state.strokeAlpha > 0.05;
          if (visibleFill || visibleStroke) {
            paths.push({ ...pendingPath, filled: visibleFill, stroked: visibleStroke, fill: state.fill, stroke: state.stroke });
          }
          pendingPath = null;
        }
        break;
      case OPS.endPath: case OPS.clip: case OPS.eoClip:
        pendingPath = null; break;
      default: break;
    }
  }

  // ---------- 2. Texte ----------
  const fontCache = new Map();
  const items = [];
  for (const it of textContent.items) {
    if (typeof it.str !== "string" || it.str.length === 0) continue;
    const t = mul(vt, it.transform);
    const size = Math.hypot(t[2], t[3]);
    if (!(size > 1)) continue;
    const rotated = Math.abs(t[1]) > 0.2 * size;
    const font = fontInfo(page, it.fontName, fontCache);
    const style = textContent.styles[it.fontName] || {};
    const ascent = style.ascent && style.ascent > 0.4 ? style.ascent : 0.8;
    const descent = style.descent && style.descent < 0 ? -style.descent : 0.2;
    const x = t[4], baseline = t[5];
    const w = Math.max(0, it.width) * Math.hypot(vt[0], vt[1]);
    const origin = matchOrigin(textOrigins, x, baseline, size);
    items.push({
      str: sanitize(it.str), x, r: x + w, baseline, size,
      top: baseline - ascent * size, bottom: baseline + descent * size,
      rotated, eol: !!it.hasEOL, angle: (Math.round(Math.atan2(t[1], t[0]) / (Math.PI / 2)) * 90 + 360) % 360,
      font: font.family, bold: font.bold, italic: font.italic, math: font.math,
      color: origin ? origin.color : [0, 0, 0], invisible: origin ? origin.invisible : false,
    });
  }
  // Texte majoritairement vertical ou à l'envers (page tournée, tableau en paysage) :
  // on réanalyse la page redressée pour retrouver des lignes horizontales.
  if (rotation === undefined && items.length) {
    const byAngle = {};
    for (const it of items) byAngle[it.angle] = (byAngle[it.angle] || 0) + it.str.length;
    const total = Object.values(byAngle).reduce((a, v) => a + v, 0);
    const [dom, n] = Object.entries(byAngle).sort((a, b) => b[1] - a[1])[0];
    if (+dom !== 0 && n >= 0.6 * total) return analyzePage(page, pdfjs, env, (((page.rotate || 0) - +dom) % 360 + 360) % 360);
  }
  const visibleItems = items.filter((i) => !i.invisible && i.str.trim() !== "");
  const visibleChars = visibleItems.reduce((n, i) => n + i.str.trim().length, 0);
  const allInvisible = items.length > 0 && visibleItems.length === 0;

  // ---------- 3. Fonds (rectangles pleins) et figures vectorielles ----------
  const pageArea = W * H;
  const isWhite = (c) => c[0] > 245 && c[1] > 245 && c[2] > 245;
  // Couleur de fond de page (rectangle plein couvrant la page)
  const pageFill = paths.filter((p) => p.filled && p.isRect && area(p.bbox) >= 0.9 * W * H).pop();
  const pageBg = pageFill && !(pageFill.fill[0] > 245 && pageFill.fill[1] > 245 && pageFill.fill[2] > 245) ? pageFill.fill : null;
  const shades = paths
    .filter((p) => p.filled && p.isRect && p.straightRect && !isWhite(p.fill) && area(p.bbox) < 0.7 * pageArea && width(p.bbox) > 20 && height(p.bbox) > 8)
    .map((p) => ({ bbox: p.bbox, color: p.fill }));

  const tables = detectTables(paths, W, H).filter((t) => {
    // une grille sans texte est une illustration, pas un tableau
    const cells = (t.xs.length - 1) * (t.ys.length - 1);
    let filled = 0;
    for (let r = 0; r < t.ys.length - 1; r++) for (let c = 0; c < t.xs.length - 1; c++) {
      const cb = { x: t.xs[c], r: t.xs[c + 1], y: t.ys[r], b: t.ys[r + 1] };
      if (visibleItems.some((i) => contains(cb, (i.x + i.r) / 2, (i.top + i.bottom) / 2))) filled++;
    }
    const keep = filled >= 1 && filled >= 0.25 * cells;
    if (!keep) t.paths.forEach((pp) => { pp.usedByTable = false; });
    return keep;
  });
  const inTable = (b) => tables.some((t) => contains(expand(t.bbox, 1), (b.x + b.r) / 2, (b.y + b.b) / 2));

  const textBoxes = visibleItems.map((i) => ({ x: i.x, y: i.top, r: i.r, b: i.bottom, n: i.str.length }));
  const charsInside = (b) => textBoxes.reduce((n, t) => n + (contains(b, (t.x + t.r) / 2, (t.y + t.b) / 2) ? t.n : 0), 0);

  const figureCandidates = paths.filter((p) => {
    const a = area(p.bbox), w = width(p.bbox), h = height(p.bbox);
    if (p.usedByTable || inTable(p.bbox)) return false;
    if (a > 0.6 * pageArea) return false;                       // fond de page
    if ((h < 2.5 && w > 0.4 * W) || (w < 2.5 && h > 0.4 * H)) return false; // filets / bordures longues
    if (p.filled && p.isRect && isWhite(p.fill)) return false;
    if (p.isRect && p.filled && charsInside(p.bbox) > 0) return false; // fond derrière du texte -> trame
    return true;
  });
  const figures = clusterFigures(figureCandidates).filter((c) => {
    const w = width(c.bbox), h = height(c.bbox);
    if (w < 14 || h < 14) return false;
    // formes significatives : courbes, groupes de tracés, ou aplat de couleur (pastille, nuancier, barre…)
    if (!(c.hasCurve || c.count >= 3 || c.segments >= 6 || c.filledArea >= 300)) return false;
    if ((w < 28 || h < 28) && c.filledArea < 300) return false;
    if (!c.hasCurve && charsInside(c.bbox) > 60) return false; // tableau ou encadré textuel : on garde le texte
    if (c.onlyRects && charsInside(c.bbox) > 0) return false;  // cadre autour de texte : le texte reste éditable
    return true;
  }).map((c) => ({ bbox: clipBox(expand(c.bbox, 3), W, H) }));

  // Équations : lignes utilisant des polices mathématiques (intégrales, fractions, racines…).
  // Elles ne peuvent pas s'écrire en texte linéaire : on les restitue en image nette.
  for (const zone of mathZones(visibleItems, W)) figures.push({ bbox: clipBox(expand(zone, 2), W, H) });

  // ---------- 4. Images : pixels d'origine ----------
  let pageRender = null;
  const renderScale = Math.min(FIGURE_RENDER_SCALE, MAX_RENDER_PX / Math.max(W, H));
  const renderPage = async () => {
    if (!pageRender) {
      const vp = page.getViewport(rotation === undefined ? { scale: renderScale } : { scale: renderScale, rotation });
      const canvas = env.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pageRender = canvas;
    }
    return pageRender;
  };
  const cropRender = async (bbox) => {
    const src = await renderPage();
    const s = renderScale;
    const w = Math.max(1, Math.round(width(bbox) * s)), h = Math.max(1, Math.round(height(bbox) * s));
    const c = env.createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(src, Math.round(bbox.x * s), Math.round(bbox.y * s), w, h, 0, 0, w, h);
    return c;
  };

  const outImages = [];
  for (const img of images) {
    const bbox = clipBox(img.bbox, W, H);
    if (area(bbox) < 16) continue;
    if (figures.some((f) => inside(bbox, f.bbox))) continue; // déjà contenu dans une figure découpée
    let canvas = null;
    if (img.obj) {
      try { canvas = drawImageObject(img.obj, img.matrix, bbox, env); } catch (e) { canvas = null; }
    }
    if (!canvas) canvas = await cropRender(bbox);
    const encoded = await encodeSmart(canvas, env);
    outImages.push({ bbox, ...encoded });
  }

  // Images couvrant presque toute la page : scan ou fond.
  let background = null, ocrScan = false;
  const contentImages = [];
  for (const im of outImages) {
    const isFullPage = area(im.bbox) >= 0.8 * pageArea;
    if (isFullPage && allInvisible) { ocrScan = true; background = im; continue; }
    if (isFullPage && visibleChars >= 20) { background = im; continue; }
    contentImages.push(im);
  }

  const outFigures = [];
  for (const f of figures) {
    const canvas = await cropRender(f.bbox);
    const data = await env.encode(canvas, "image/png");
    outFigures.push({ bbox: f.bbox, data, mime: "image/png", pxW: canvas.width, pxH: canvas.height });
  }

  // Texte à conserver : visible (ou OCR), hors figures découpées (déjà dans l'image).
  const keptItems = (ocrScan ? items.filter((i) => i.str.trim() !== "") : visibleItems)
    .filter((i) => !outFigures.some((f) => contains(expand(f.bbox, 1), (i.x + i.r) / 2, (i.top + i.bottom) / 2)));

  return {
    width: W, height: H,
    items: keptItems,
    images: contentImages,
    tables,
    figures: outFigures,
    shades,
    pageBg,
    background: ocrScan ? null : background,
    ocrScan,
    rotation,
    renderPage: async (scale) => {
      const vp = page.getViewport(rotation === undefined ? { scale } : { scale, rotation });
      const canvas = env.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return canvas;
    },
  };
}

// ---------------------------------------------------------------------------

function getObj(page, id) {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      if (store.has && store.has(id)) { resolve(store.get(id)); return; }
      store.get(id, (o) => resolve(o));
      setTimeout(() => resolve(null), 4000);
    } catch (e) { resolve(null); }
  });
}

function fontInfo(page, fontName, cache) {
  if (cache.has(fontName)) return cache.get(fontName);
  let raw = "", bold = false, italic = false;
  try {
    const f = page.commonObjs.get(fontName);
    if (f) { raw = f.name || ""; bold = !!(f.bold || f.black); italic = !!f.italic; }
  } catch (e) { /* police non encore chargée */ }
  const clean = raw.replace(/^[A-Z]{6}\+/, "");
  if (/bold|black|heavy|semibold|demi/i.test(clean)) bold = true;
  if (/italic|oblique/i.test(clean)) italic = true;
  const math = /(cmex|cmsy|msam|msbm|esint|math|stix|xits|asana|symbol|mt ?extra|euex|eusm|wasy|rsfs)/i.test(clean);
  const info = { family: mapFamily(clean), bold, italic, math };
  cache.set(fontName, info);
  return info;
}

function mapFamily(name) {
  let base = name.split(/[-,]/)[0].replace(/(MT|PS|PSMT|Std|Pro|LT)$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  const n = base.toLowerCase();
  if (!n) return "Arial";
  // polices de base PDF et clones libres -> équivalents présents sur tous les postes Office
  if (/^(helvetica|arial|nimbus ?sans|liberation ?sans|free ?sans|tex ?gyre ?heros|sans-serif)/.test(n)) return "Arial";
  if (/^(times|nimbus ?rom|liberation ?serif|free ?serif|tex ?gyre ?termes|serif$)/.test(n)) return "Times New Roman";
  if (/^(courier|nimbus ?mono|liberation ?mono|free ?mono|monospace)/.test(n)) return "Courier New";
  if (/^(carlito)/.test(n)) return "Calibri";
  if (/^(caladea)/.test(n)) return "Cambria";
  if (n.startsWith("symbol")) return "Symbol";
  if (n.startsWith("zapf")) return "Wingdings";
  return base;
}

function matchOrigin(origins, x, y, size) {
  let best = null, bestScore = Infinity;
  for (const o of origins) {
    const dy = Math.abs(o.y - y);
    if (dy > Math.max(1.5, 0.3 * size)) continue;
    const dx = x - o.x;
    const score = dx >= -1 ? dx : 1000 - dx; // on préfère l'origine immédiatement à gauche
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** Supprime les caractères interdits en XML (glyphes mal décodés, fréquents dans les PDF graphiques). */
export function sanitize(s) {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
}

function clipBox(b, W, H) {
  return { x: Math.max(0, b.x), y: Math.max(0, b.y), r: Math.min(W, b.r), b: Math.min(H, b.b) };
}

function inside(inner, outer) {
  const i = intersect(inner, outer);
  return !!i && area(i) >= 0.9 * area(inner);
}

function mathZones(items, W) {
  if (!items.some((i) => i.math)) return [];
  // rangées (même ligne de base)
  const rows = [];
  for (const it of items.slice().sort((a, b) => a.baseline - b.baseline)) {
    const row = rows.find((r) => Math.abs(r.baseline - it.baseline) <= 0.35 * Math.min(r.size, it.size) && it.x < r.r + 3 * it.size && it.r > r.x - 3 * it.size);
    if (row) { row.items.push(it); row.x = Math.min(row.x, it.x); row.r = Math.max(row.r, it.r); row.top = Math.min(row.top, it.top); row.bottom = Math.max(row.bottom, it.bottom); row.size = Math.max(row.size, it.size); }
    else rows.push({ baseline: it.baseline, size: it.size, items: [it], x: it.x, r: it.r, top: it.top, bottom: it.bottom });
  }
  const isMath = (r) => {
    const chars = r.items.reduce((n, i) => n + i.str.length, 0);
    const mathChars = r.items.reduce((n, i) => n + (i.math ? i.str.length : 0), 0);
    return mathChars >= 1 && (mathChars / chars > 0.15 || chars <= 12);
  };
  // agrandit chaque rangée mathématique avec les rangées courtes voisines (numérateurs, indices…)
  const zones = [];
  rows.filter(isMath).forEach((r) => {
    let z = { x: r.x, y: r.top, r: r.r, b: r.bottom };
    let grown = true;
    while (grown) {
      grown = false;
      for (const o of rows) {
        if (o.top >= z.y && o.bottom <= z.b && o.x >= z.x && o.r <= z.r) continue;
        const near = o.top < z.b + 0.6 * o.size && o.bottom > z.y - 0.6 * o.size;
        const overlapX = Math.min(o.r, z.r) - Math.max(o.x, z.x) > 0;
        const short = o.r - o.x < 0.5 * W;
        if (near && overlapX && (short || isMath(o))) { z = { x: Math.min(z.x, o.x), y: Math.min(z.y, o.top), r: Math.max(z.r, o.r), b: Math.max(z.b, o.bottom) }; grown = true; }
      }
    }
    const hit = zones.find((q) => intersect(expand(q, 2), z));
    if (hit) Object.assign(hit, union(hit, z)); else zones.push(z);
  });
  return zones.filter((z) => z.r - z.x > 4 && z.b - z.y > 4);
}

/** Bornes et nature d'un tracé à partir de ses points réels (points de contrôle inclus). */
function pathGeometry(ops, args, OPS) {
  if (!ops || !args) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, hasCurve = false, j = 0;
  const pts = [];
  const add = (x, y) => { pts.push([x, y]); if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  let onlyLines = true, rects = 0;
  for (const op of ops) {
    if (op === OPS.moveTo || op === OPS.lineTo) { add(args[j], args[j + 1]); j += 2; }
    else if (op === OPS.curveTo) { add(args[j], args[j + 1]); add(args[j + 2], args[j + 3]); add(args[j + 4], args[j + 5]); j += 6; hasCurve = true; onlyLines = false; }
    else if (op === OPS.curveTo2 || op === OPS.curveTo3) { add(args[j], args[j + 1]); add(args[j + 2], args[j + 3]); j += 4; hasCurve = true; onlyLines = false; }
    else if (op === OPS.rectangle) { const [x, y, w, h] = [args[j], args[j + 1], args[j + 2], args[j + 3]]; add(x, y); add(x + w, y + h); j += 4; rects++; onlyLines = false; }
    else if (op === OPS.closePath) { /* rien */ }
  }
  if (!isFinite(minX)) return null;
  const e = 1e-3 * Math.max(1, maxX - minX, maxY - minY);
  const onEdges = pts.length >= 4 && pts.length <= 6 && pts.every(([x, y]) => (Math.abs(x - minX) < e || Math.abs(x - maxX) < e) && (Math.abs(y - minY) < e || Math.abs(y - maxY) < e));
  const drawOps = ops.filter((o) => o !== OPS.closePath).length;
  return { minX, minY, maxX, maxY, hasCurve, segments: ops.length, isRect: (rects === 1 && drawOps === 1) || (onlyLines && onEdges) };
}

/**
 * Détecte les tableaux tracés avec des filets (lignes fines ou rectangles d'une épaisseur de ~1 pt).
 * Renvoie { bbox, xs, ys, vSegs, color, width } pour chaque grille trouvée.
 */
function detectTables(paths, W, H) {
  const hs = [], vs = [];
  for (const p of paths) {
    const w = width(p.bbox), h = height(p.bbox);
    const color = p.filled ? p.fill : p.stroke;
    if (h <= 3 && w >= 6) hs.push({ y: (p.bbox.y + p.bbox.b) / 2, x1: p.bbox.x, x2: p.bbox.r, t: Math.max(h, p.lineWidth || 0.5), color, path: p });
    else if (w <= 3 && h >= 6) vs.push({ x: (p.bbox.x + p.bbox.r) / 2, y1: p.bbox.y, y2: p.bbox.b, t: Math.max(w, p.lineWidth || 0.5), color, path: p });
    else if (p.stroked && p.isRect && p.straightRect && w >= 6 && h >= 6 && w < 0.95 * W) {
      const t = p.lineWidth || 0.5, c = p.stroke;
      hs.push({ y: p.bbox.y, x1: p.bbox.x, x2: p.bbox.r, t, color: c, path: p }, { y: p.bbox.b, x1: p.bbox.x, x2: p.bbox.r, t, color: c, path: p });
      vs.push({ x: p.bbox.x, y1: p.bbox.y, y2: p.bbox.b, t, color: c, path: p }, { x: p.bbox.r, y1: p.bbox.y, y2: p.bbox.b, t, color: c, path: p });
    }
  }
  if (hs.length < 2 || vs.length < 2) return [];
  // composantes connexes (une ligne H touche une ligne V)
  const segs = [...hs.map((s) => ({ ...s, kind: "h" })), ...vs.map((s) => ({ ...s, kind: "v" }))];
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const tol = 2.5;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    let touch = false;
    if (a.kind !== b.kind) {
      const h = a.kind === "h" ? a : b, v = a.kind === "h" ? b : a;
      touch = v.x >= h.x1 - tol && v.x <= h.x2 + tol && h.y >= v.y1 - tol && h.y <= v.y2 + tol;
    }
    if (touch) parent[find(i)] = find(j);
  }
  const groups = new Map();
  segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  const tables = [];
  for (const g of groups.values()) {
    const gh = g.filter((s) => s.kind === "h"), gv = g.filter((s) => s.kind === "v");
    const ys = mergeCoords(gh.map((s) => s.y)), xs = mergeCoords(gv.map((s) => s.x));
    if (ys.length < 2 || xs.length < 2) continue;
    const bbox = { x: xs[0], y: ys[0], r: xs[xs.length - 1], b: ys[ys.length - 1] };
    if (width(bbox) < 30 || height(bbox) < 10 || area(bbox) > 0.9 * W * H) continue;
    g.forEach((s) => { s.path.usedByTable = true; });
    const paths = [...new Set(g.map((s) => s.path))];
    const t = gh.concat(gv).reduce((a, s) => a + s.t, 0) / g.length;
    tables.push({ paths, bbox, xs, ys, vSegs: gv.map((s) => ({ x: s.x, y1: s.y1, y2: s.y2 })), color: g[0].color, width: Math.max(0.25, Math.min(3, t)) });
  }
  return tables;
}

function mergeCoords(values) {
  const v = values.slice().sort((a, b) => a - b), out = [];
  for (const x of v) { if (!out.length || x - out[out.length - 1] > 2.5) out.push(x); else out[out.length - 1] = (out[out.length - 1] + x) / 2; }
  return out;
}

function clusterFigures(paths) {
  const solid = (p) => ((p.filled && !(p.fill[0] > 245 && p.fill[1] > 245 && p.fill[2] > 245)) || (p.stroked && p.isRect) ? area(p.bbox) : 0);
  const clusters = paths.map((p) => ({ bbox: p.bbox, hasCurve: p.hasCurve, count: 1, segments: p.segments, filledArea: solid(p), onlyRects: !!p.isRect }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (intersect(expand(clusters[i].bbox, 6), clusters[j].bbox)) {
          const a = clusters[i], b = clusters[j];
          clusters[i] = { bbox: union(a.bbox, b.bbox), hasCurve: a.hasCurve || b.hasCurve, count: a.count + b.count, segments: a.segments + b.segments, filledArea: a.filledArea + b.filledArea, onlyRects: a.onlyRects && b.onlyRects };
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return clusters;
}

/** Dessine les pixels d'origine d'une image pdf.js en respectant sa matrice (miroir, rotation). */
function drawImageObject(obj, m, bbox, env) {
  const iw = obj.width, ih = obj.height;
  if (!iw || !ih) return null;
  let src;
  if (obj.bitmap) {
    src = obj.bitmap;
  } else if (obj.data) {
    src = env.createCanvas(iw, ih);
    const ctx = src.getContext("2d");
    const out = ctx.createImageData(iw, ih);
    const d = out.data, s = obj.data;
    if (obj.kind === 3) {
      d.set(s.subarray ? s.subarray(0, iw * ih * 4) : s.slice(0, iw * ih * 4));
    } else if (obj.kind === 2) {
      for (let p = 0, q = 0; p < iw * ih; p++, q += 3) { d[p * 4] = s[q]; d[p * 4 + 1] = s[q + 1]; d[p * 4 + 2] = s[q + 2]; d[p * 4 + 3] = 255; }
    } else if (obj.kind === 1) {
      const stride = (iw + 7) >> 3;
      for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
        const v = (s[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
        const o = (y * iw + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
    } else return null;
    ctx.putImageData(out, 0, 0);
  } else return null;

  // Taille de sortie : résolution native de l'image, plafonnée.
  const bw = width(bbox), bh = height(bbox);
  let scale = Math.max(iw / bw, ih / bh);
  scale = Math.min(scale, MAX_IMAGE_PX / Math.max(bw, bh));
  scale = Math.max(scale, 1);
  const cw = Math.max(1, Math.round(bw * scale)), ch = Math.max(1, Math.round(bh * scale));
  const canvas = env.createCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  // espace appareil -> pixels du canevas, puis carré unité -> appareil (matrice PDF), puis inversion verticale image.
  ctx.setTransform(scale, 0, 0, scale, -bbox.x * scale, -bbox.y * scale);
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.transform(1 / iw, 0, 0, -1 / ih, 0, 1);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

async function encodeSmart(canvas, env) {
  // PNG si transparence, JPEG sinon (bien plus léger pour les photos).
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let alpha = false;
  for (let i = 3; i < data.length; i += 4 * 7) { if (data[i] < 250) { alpha = true; break; } }
  const mime = alpha ? "image/png" : "image/jpeg";
  const bytes = await env.encode(canvas, mime, 0.9);
  return { data: bytes, mime, pxW: canvas.width, pxH: canvas.height };
}
