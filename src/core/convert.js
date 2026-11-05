// Orchestration : PDF -> modèle de document indépendant du format de sortie.

import { analyzePage } from "./analyze.js";
import { buildLines, buildParagraphs, xyCut, finalizeBlocks, buildTable } from "./layout.js";
import { clamp } from "./geometry.js";

/**
 * @param {Uint8Array} data  contenu du PDF
 * @param {object} opts { pdfjs, env, mode: 'editable'|'exact', onProgress(done,total,label), docOptions }
 * @returns modèle { pageW, pageH, margins, pages:[{blocks, background}], stats }
 */
export async function pdfToModel(data, opts) {
  const { pdfjs, env, mode = "editable", onProgress = () => {}, docOptions = {} } = opts;
  const doc = await pdfjs.getDocument({ data, verbosity: 0, ...docOptions }).promise;
  const n = doc.numPages;
  const analyses = [];
  const warnings = [];
  for (let i = 1; i <= n; i++) {
    onProgress(i - 1, n, `Analyse de la page ${i}/${n}`);
    const page = await doc.getPage(i);
    try {
      if (mode === "exact") {
        const vp = page.getViewport({ scale: 1 });
        analyses.push({ exact: true, page, width: vp.width, height: vp.height });
      } else {
        analyses.push(await analyzePage(page, pdfjs, env));
      }
    } catch (e) {
      warnings.push(`Page ${i} : ${e && e.message ? e.message : e}`);
      const vp = page.getViewport({ scale: 1 });
      analyses.push({ exact: true, page, width: vp.width, height: vp.height, failed: true });
    }
  }

  const pageW = analyses[0].width, pageH = analyses[0].height;
  const stats = { pages: n, paragraphs: 0, tables: 0, images: 0, figures: 0, ocrPages: 0, exactPages: 0 };

  // Marges : enveloppe du contenu sur l'ensemble des pages analysées.
  let minX = Infinity, minY = Infinity, maxR = -Infinity, maxB = -Infinity;
  for (const a of analyses) {
    if (a.exact) continue;
    const boxes = [
      ...a.items.map((i) => ({ x: i.x, y: i.top, r: i.r, b: i.bottom })),
      ...a.images.map((i) => i.bbox), ...a.figures.map((f) => f.bbox),
    ];
    for (const b of boxes) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxR = Math.max(maxR, b.r); maxB = Math.max(maxB, b.b); }
  }
  const allExact = analyses.every((a) => a.exact);
  const margins = allExact || !isFinite(minX)
    ? { l: 0, r: 0, t: 0, b: 0 }
    : {
        l: clamp(minX - 2, 18, 100), r: clamp(pageW - maxR - 2, 18, 100),
        t: clamp(minY - 4, 18, 100), b: clamp(pageH - maxB - 2, 18, 90),
      };

  const pages = [];
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    onProgress(i, n, `Mise en page ${i + 1}/${n}`);
    if (a.exact) {
      // Mode fidèle : la page entière en image haute définition.
      const scale = Math.min(170 / 72, 5000 / Math.max(a.width, a.height));
      const vp = a.page.getViewport({ scale });
      const canvas = env.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await a.page.render({ canvasContext: ctx, viewport: vp }).promise;
      const bytes = await env.encode(canvas, "image/jpeg", 0.92);
      const m = allExact ? margins : margins;
      const availW = pageW - m.l - m.r, availH = pageH - m.t - m.b;
      const k = Math.min(availW / a.width, (availH - 2) / a.height);
      pages.push({
        blocks: [{ kind: "img", data: bytes, mime: "image/jpeg", pxW: canvas.width, pxH: canvas.height,
          wPt: a.width * k, hPt: a.height * k, bbox: { x: m.l, y: m.t, r: m.l + a.width * k, b: m.t + a.height * k },
          spaceBefore: 0, indent: 0, align: "center" }],
        background: null,
      });
      stats.exactPages++;
      continue;
    }
    const region = { x: margins.l, r: pageW - margins.r };
    const items = a.items.slice();
    const pageImages = [...a.images, ...a.figures];
    const tables = (a.tables || []).map((t) => buildTable(t, items, pageImages, a.shades));
    const paragraphs = buildParagraphs(buildLines(items));
    const imgs = pageImages.map((im) => ({ kind: "img", ...im }));
    const blocks = finalizeBlocks(xyCut([...paragraphs, ...imgs, ...tables], region), region, a.shades, margins.t, a.pageBg || (a.background ? null : undefined));
    stats.paragraphs += paragraphs.length;
    stats.tables = (stats.tables || 0) + tables.length;
    stats.images += a.images.length;
    stats.figures += a.figures.length;
    if (a.ocrScan) stats.ocrPages++;
    let background = a.background || null;
    if (!background && a.pageBg) {
      const c = env.createCanvas(16, 16), ctx = c.getContext("2d");
      ctx.fillStyle = `rgb(${a.pageBg.map(Math.round).join(",")})`; ctx.fillRect(0, 0, 16, 16);
      background = { bbox: { x: 0, y: 0, r: a.width, b: a.height }, data: await env.encode(c, "image/png"), mime: "image/png", pxW: 16, pxH: 16 };
    }
    pages.push({ blocks, background });
  }
  onProgress(n, n, "Génération du fichier");
  await doc.destroy();
  return { pageW, pageH, margins, pages, stats, warnings, mode };
}

/** Texte brut d'un bloc (pour TXT et pour les tests). */
export function blockText(b) {
  if (b.kind === "p") return b.runs.map((r) => r.text).join("");
  if (b.kind === "cols") return b.cols.map((c) => c.blocks.map(blockText).filter(Boolean).join("\n")).join("\n");
  if (b.kind === "table") return b.rows.map((r) => r.cells.map((c) => c.blocks.map(blockText).join(" ")).join("\t")).join("\n");
  return "";
}
