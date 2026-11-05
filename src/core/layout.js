// Reconstruction de la structure : lignes -> paragraphes -> arbre de zones (ordre de lecture,
// colonnes, images côte à côte) via un découpage XY récursif.

import { contains, area, width, height, clamp } from "./geometry.js";

const BULLET_RE = /^\s*([•·▪■●◦‣\-–—*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

// ---------- Lignes ----------
export function buildLines(items) {
  const sorted = items.filter((i) => !i.rotated || true).slice().sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  // 1. regroupe par ligne de base
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.baseline - it.baseline) <= 0.4 * Math.min(r.size, it.size));
    if (row) { row.items.push(it); row.size = Math.max(row.size, it.size); }
    else rows.push({ baseline: it.baseline, size: it.size, items: [it] });
  }
  // 2. découpe chaque rangée en segments (colonnes / cellules) selon les grands écarts
  const lines = [];
  for (const row of rows) {
    const its = row.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of its) {
      const gap = cur ? it.x - cur.r : 0;
      const sz = Math.max(it.size, cur ? cur.size : 0);
      if (!cur || gap > Math.max(1.6 * sz, 9) || gap < -2 * sz) {
        if (cur) lines.push(finishLine(cur));
        cur = { items: [it], x: it.x, r: it.r, top: it.top, bottom: it.bottom, baseline: it.baseline, size: it.size };
      } else {
        cur.items.push(it);
        cur.r = Math.max(cur.r, it.r); cur.top = Math.min(cur.top, it.top); cur.bottom = Math.max(cur.bottom, it.bottom);
        cur.size = Math.max(cur.size, it.size);
      }
    }
    if (cur) lines.push(finishLine(cur));
  }
  return lines.filter((l) => l.text.trim() !== "");
}

function styleKey(i) {
  return [i.font, i.bold, i.italic, Math.round(i.size * 2) / 2, i.color.join(",")].join("|");
}

function finishLine(l) {
  const runs = [];
  let prev = null;
  for (const it of l.items) {
    let text = it.str;
    if (prev) {
      const gap = it.x - prev.r;
      const needSpace = gap > 0.18 * Math.min(it.size, prev.size) && !/\s$/.test(prevText(runs)) && !/^\s/.test(text);
      if (needSpace) text = " " + text;
    }
    const key = styleKey(it);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.text += text;
    else runs.push({ key, text, font: it.font, bold: it.bold, italic: it.italic, size: it.size, color: it.color });
    prev = it;
  }
  const text = runs.map((r) => r.text).join("");
  const boldChars = runs.reduce((n, r) => n + (r.bold ? r.text.trim().length : 0), 0);
  const chars = Math.max(1, text.trim().length);
  return { ...l, runs, text, allBold: boldChars / chars > 0.8 };
}
function prevText(runs) { return runs.length ? runs[runs.length - 1].text : ""; }

// ---------- Paragraphes ----------
export function buildParagraphs(lines) {
  const ls = lines.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const paras = [];
  for (const line of ls) {
    let best = null, bestPitch = Infinity;
    for (const p of paras) {
      if (p.closed) continue;
      const last = p.lines[p.lines.length - 1];
      const pitch = line.baseline - last.baseline;
      const sz = Math.max(line.size, last.size);
      if (pitch < 0.5 * sz || pitch > 1.85 * sz) continue;
      if (Math.max(line.size, p.size) / Math.min(line.size, p.size) > 1.18) continue;
      const overlap = Math.min(line.r, p.r) - Math.max(line.x, p.x);
      if (overlap <= 0) continue;
      if (line.x > p.x + 4 * sz && line.x > last.x + 4 * sz) continue;
      if (p.pitch && Math.abs(pitch - p.pitch) > 0.35 * p.pitch) continue;
      if (last.allBold !== line.allBold) continue;
      if (BULLET_RE.test(line.text)) continue;
      // Fin de paragraphe si le premier mot de cette ligne aurait tenu à la fin de la précédente.
      const maxR = Math.max(p.r, line.r);
      if (maxR - last.r > firstWordWidth(line) + 0.6 * sz) continue;
      if (pitch < bestPitch) { bestPitch = pitch; best = p; }
    }
    if (best) {
      best.pitch = best.pitch ? (best.pitch * (best.lines.length - 1) + bestPitch) / best.lines.length : bestPitch;
      best.lines.push(line);
      best.x = Math.min(best.x, line.x); best.r = Math.max(best.r, line.r); best.bottom = line.bottom;
    } else {
      paras.push({ lines: [line], x: line.x, r: line.r, top: line.top, bottom: line.bottom, size: line.size, pitch: 0 });
    }
  }
  return paras.map(finishParagraph);
}

function finishParagraph(p) {
  const runs = [];
  p.lines.forEach((line, idx) => {
    line.runs.forEach((run, j) => {
      let text = run.text;
      if (idx > 0 && j === 0) {
        const prev = runs[runs.length - 1];
        if (prev && /[A-Za-zÀ-ÿ]-$/.test(prev.text) && /^[a-zà-ÿ]/.test(text)) prev.text = prev.text.slice(0, -1); // césure
        else if (prev && !/\s$/.test(prev.text)) text = " " + text.replace(/^\s+/, "");
      }
      const last = runs[runs.length - 1];
      if (last && last.key === run.key) last.text += text;
      else runs.push({ ...run, text });
    });
  });
  // taille dominante
  const bySize = {};
  runs.forEach((r) => { const k = Math.round(r.size * 2) / 2; bySize[k] = (bySize[k] || 0) + r.text.length; });
  const size = +Object.entries(bySize).sort((a, b) => b[1] - a[1])[0][0];
  const first = p.lines[0];
  const others = p.lines.slice(1);
  const minX = Math.min(...p.lines.map((l) => l.x));
  return {
    kind: "p",
    bbox: { x: p.x, y: p.top, r: p.r, b: p.bottom },
    lines: p.lines,
    runs: runs.map(({ key, ...r }) => r),
    size,
    pitch: p.pitch || size * 1.2,
    firstLineOffset: others.length ? first.x - minX : 0,
    bullet: BULLET_RE.test(first.text),
  };
}

function firstWordWidth(line) {
  const t = line.text.replace(/^\s+/, "");
  const word = (t.match(/^\S+/) || [""])[0];
  return (word.length / Math.max(1, t.length)) * (line.r - line.x);
}

// ---------- Arbre de zones (XY-cut) ----------
/** boxes: éléments {kind, bbox, ...}. region: {x, r}. Renvoie une liste de blocs ordonnés. */
export function xyCut(boxes, region, depth = 0) {
  if (boxes.length <= 1 || depth > 12) return boxes.slice().sort(byTop);
  // coupe horizontale : bandes séparées par du blanc
  const byY = boxes.slice().sort(byTop);
  const groups = [[byY[0]]];
  let maxB = byY[0].bbox.b;
  for (let i = 1; i < byY.length; i++) {
    const bx = byY[i];
    if (bx.bbox.y >= maxB - 0.5) groups.push([bx]);
    else groups[groups.length - 1].push(bx);
    maxB = Math.max(maxB, bx.bbox.b);
  }
  if (groups.length > 1) return groups.flatMap((g) => xyCut(g, region, depth + 1));

  // coupe verticale : colonnes séparées par une gouttière
  const byX = boxes.slice().sort((a, b) => a.bbox.x - b.bbox.x);
  const cols = [[byX[0]]];
  let maxR = byX[0].bbox.r;
  for (let i = 1; i < byX.length; i++) {
    const bx = byX[i];
    if (bx.bbox.x >= maxR + 6) cols.push([bx]);
    else cols[cols.length - 1].push(bx);
    maxR = Math.max(maxR, bx.bbox.r);
  }
  if (cols.length > 1) {
    const ext = cols.map((c) => ({ x: Math.min(...c.map((b) => b.bbox.x)), r: Math.max(...c.map((b) => b.bbox.r)) }));
    const colRegions = ext.map((e, i) => ({
      x: i === 0 ? Math.min(region.x, e.x) : (ext[i - 1].r + e.x) / 2,
      r: i === ext.length - 1 ? Math.max(region.r, e.r) : (e.r + ext[i + 1].x) / 2,
    }));
    const bbox = {
      x: Math.min(...boxes.map((b) => b.bbox.x)), y: Math.min(...boxes.map((b) => b.bbox.y)),
      r: Math.max(...boxes.map((b) => b.bbox.r)), b: Math.max(...boxes.map((b) => b.bbox.b)),
    };
    return [{
      kind: "cols", bbox,
      cols: cols.map((c, i) => ({ region: colRegions[i], blocks: xyCut(c, colRegions[i], depth + 1) })),
    }];
  }
  return byY; // éléments qui se chevauchent : ordre vertical simple
}

const byTop = (a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;

// ---------- Finitions : alignement, retraits, espacements, trames ----------
export function finalizeBlocks(blocks, region, shades, prevBottom, pageBg) {
  let bottom = prevBottom;
  for (const b of blocks) {
    b.spaceBefore = clamp(b.bbox.y - bottom, 0, 72);
    b.indent = clamp(b.bbox.x - region.x, 0, Math.max(0, width(region) - 24));
    if (b.kind === "p") finalizeParagraph(b, region, shades, pageBg);
    if (b.kind === "cols") {
      b.cols.forEach((c) => finalizeBlocks(c.blocks, c.region, shades, b.bbox.y, pageBg));
      b.cols.forEach((c) => { c.width = width(c.region); });
    }
    if (b.kind === "table") {
      const tw = b.colWidths.reduce((a, v) => a + v, 0);
      if (b.indent + tw > width(region)) b.indent = Math.max(0, width(region) - tw);
    }
    if (b.kind === "img") {
      const maxW = width(region) - b.indent;
      const w = Math.min(width(b.bbox), maxW);
      b.wPt = w; b.hPt = height(b.bbox) * (w / width(b.bbox));
      // centrage approximatif
      const center = (b.bbox.x + b.bbox.r) / 2, rc = (region.x + region.r) / 2;
      b.align = Math.abs(center - rc) < 0.06 * width(region) && width(b.bbox) < 0.9 * width(region) ? "center" : "left";
      if (b.align === "center") b.indent = 0;
    }
    bottom = b.bbox.b;
  }
  // Bandeau coloré contenant un seul paragraphe : on lui rend sa hauteur (remplissage vertical).
  blocks.forEach((b, i) => {
    if (b.kind !== "p" || !b.shadeRef) return;
    const shared = blocks.filter((o) => o.kind === "p" && o.shadeRef === b.shadeRef).length > 1;
    const extra = height(b.shadeRef.bbox) - height(b.bbox);
    if (shared || extra < 6) return;
    b.shadePad = clamp(extra / 2, 0, 31);
    b.spaceBefore = Math.max(0, b.spaceBefore - b.shadePad);
    const next = blocks[i + 1];
    if (next) next.spaceBefore = Math.max(0, (next.spaceBefore || 0) - b.shadePad);
  });
  blocks.forEach((b) => { delete b.shadeRef; });
  return blocks;
}

function finalizeParagraph(p, region, shades, pageBg) {
  const rw = width(region);
  const lines = p.lines;
  const rc = (region.x + region.r) / 2;
  const centered = lines.every((l) => Math.abs((l.x + l.r) / 2 - rc) < Math.max(4, 0.03 * rw)) && lines.some((l) => l.r - l.x < 0.85 * rw);
  const rightAligned = !centered && lines.length >= 1 && lines.every((l) => Math.abs(l.r - region.r) < 6) && p.bbox.x > region.x + 0.3 * rw;
  const bodyLines = lines.slice(0, -1);
  const justified = !centered && bodyLines.length >= 2 && bodyLines.every((l) => Math.abs(l.r - p.bbox.r) < 2.5);
  p.align = centered ? "center" : rightAligned ? "right" : justified ? "justify" : "left";
  if (p.align === "center" || p.align === "right") p.indent = 0;
  p.firstLine = p.align === "left" || p.align === "justify" ? clamp(p.firstLineOffset, -72, 72) : 0;
  p.lineRatio = clamp(p.pitch / (p.size * 1.15), 1, 2.2);
  p.heading = p.size >= 14 || (p.lines.length === 1 && p.runs.every((r) => r.bold) && p.size >= 12);

  // trame de fond (texte posé sur un rectangle coloré)
  const cx = (p.bbox.x + p.bbox.r) / 2, cy = (p.bbox.y + p.bbox.b) / 2;
  const sh = shades.filter((s) => contains(s.bbox, cx, cy)).sort((a, b) => area(a.bbox) - area(b.bbox))[0];
  p.shade = sh ? sh.color : null;
  p.shadeRef = sh || null;
  // éviter le texte blanc sur fond blanc dans Word
  // pageBg === null : fond = image (photo, scan) -> on ne touche pas aux couleurs
  if (!p.shade && pageBg === null) return;
  const bg = p.shade || pageBg || [255, 255, 255];
  p.runs.forEach((r) => {
    if (contrast(r.color, bg) < 1.6) r.color = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  });
}

function luminance(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------- Tableaux à bordures ----------
/**
 * Transforme une grille détectée en bloc tableau. Consomme les fragments de texte et les images
 * situés dans ses cellules (ils sont retirés de `items` / `images`).
 */
export function buildTable(t, items, images, shades) {
  const { xs, ys } = t;
  const nc = xs.length - 1;
  const center = (b) => [(b.x + b.r) / 2, (b.y + b.b) / 2];
  const hasVLine = (x, y) => t.vSegs.some((s) => Math.abs(s.x - x) < 2.5 && s.y1 <= y + 1 && s.y2 >= y - 1);
  const rows = [];
  for (let r = 0; r < ys.length - 1; r++) {
    const y0 = ys[r], y1 = ys[r + 1], mid = (y0 + y1) / 2;
    if (y1 - y0 < 3) continue; // double filet
    const cells = [];
    let c = 0;
    while (c < nc) {
      let span = 1;
      while (c + span < nc && !hasVLine(xs[c + span], mid)) span++; // cellule fusionnée
      const cb = { x: xs[c], r: xs[c + span], y: y0, b: y1 };
      const mine = [];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (contains(cb, (it.x + it.r) / 2, (it.top + it.bottom) / 2)) { mine.push(it); items.splice(i, 1); }
      }
      const imgs = [];
      for (let i = images.length - 1; i >= 0; i--) {
        const [cx, cy] = center(images[i].bbox);
        if (contains(cb, cx, cy)) { imgs.push({ kind: "img", ...images[i] }); images.splice(i, 1); }
      }
      const region = { x: cb.x + 3, r: cb.r - 3 };
      const paras = buildParagraphs(buildLines(mine.reverse()));
      const cellShades = shades.filter((s) => { const i = overlapArea(s.bbox, cb); return i > 0.5 * area(cb); });
      const shade = cellShades.length ? cellShades.sort((a, b) => area(b.bbox) - area(a.bbox))[0].color : null;
      const blocks = finalizeBlocks(xyCut([...paras, ...imgs], region), region, shade ? [{ bbox: cb, color: shade }] : [], cb.y + 2);
      blocks.forEach((b) => { if (b.kind === "p") b.shade = null; }); // le fond est porté par la cellule
      cells.push({ span, width: cb.r - cb.x, blocks, shade });
      c += span;
    }
    rows.push({ height: y1 - y0, cells });
  }
  return {
    kind: "table", bbox: t.bbox,
    colWidths: xs.slice(1).map((x, i) => x - xs[i]),
    rows, border: { color: t.color || [0, 0, 0], width: t.width || 0.5 },
  };
}

function overlapArea(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.x, b.x), h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
