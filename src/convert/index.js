// Orchestrateur : convertit n'importe quel format pris en charge vers n'importe quel autre.
// PDF <-> (DOCX, ODT, RTF, DOC, TXT, HTML). Pour les formats non-PDF, le document est d'abord
// rendu par le moteur du navigateur dans un cadre isolé ; de là : TXT = texte visible (innerText),
// HTML = la page rendue, PDF = peinture vectorielle ; les autres formats bureautiques passent par
// ce PDF intermédiaire puis par le même extracteur/écrivain que la conversion PDF classique.
import { detectFormat } from "./detect.js";
import { createFrame, settle } from "./frame.js";
import { readHtml, readMhtml } from "./readers/html.js";
import { readTxt } from "./readers/txt.js";
import { readDoc } from "./readers/doc.js";
import { readRtf } from "./readers/rtf.js";
import { readOdt } from "./readers/odt.js";
import { readDocx } from "./readers/docx.js";
import { paintToPdf } from "../pdf/painter.js";
import { pdfToModel } from "../core/convert.js";
import { writeDocx } from "../core/writers/docx.js";
import { writeOdt } from "../core/writers/odt.js";
import { writeRtf } from "../core/writers/rtf.js";
import { writeTxt } from "../core/writers/txt.js";
import { writeHtml } from "../core/writers/html.js";

export { detectFormat };

export const ALL_FORMATS = {
  pdf: { label: "PDF (.pdf)", mime: "application/pdf", ext: "pdf" },
  docx: { label: "Word (.docx)", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  odt: { label: "OpenDocument (.odt)", mime: "application/vnd.oasis.opendocument.text", ext: "odt" },
  rtf: { label: "Rich Text (.rtf)", mime: "application/rtf", ext: "rtf" },
  doc: { label: "Word 97-2003 (.doc)", mime: "application/msword", ext: "doc" },
  txt: { label: "Texte brut (.txt)", mime: "text/plain;charset=utf-8", ext: "txt" },
  html: { label: "Page web (.html)", mime: "text/html;charset=utf-8", ext: "html" },
};
export const INPUT_EXTRA = { html: "Page web (.html)", htm: "Page web (.htm)", mht: "Archive web (.mht)", mhtml: "Archive web (.mhtml)" };

const A4 = { w: 595.28, h: 841.89, margins: { t: 56.7, r: 56.7, b: 56.7, l: 56.7 } };

async function readToHtmlDoc(bytes, name, format, opts) {
  const title = opts.title || name.replace(/\.[^.]+$/, "");
  switch (format) {
    case "docx": return await readDocx(bytes, title);
    case "odt": return await readOdt(bytes, title);
    case "rtf": return readRtf(bytes, title);
    case "doc": return readDoc(bytes, title);
    case "txt": return readTxt(bytes, title);
    case "mhtml": return await readMhtml(bytes);
    case "html": return await readHtml(bytes, opts.resources);
    default: throw new Error(`Ce format d'entrée n'est pas pris en charge : ${format}`);
  }
}

async function renderToPdfBytes(htmlDoc, opts) {
  const page = htmlDoc.page || A4;
  const contentWidthPx = (page.w - page.margins.l - page.margins.r) / 0.75;
  const frame = createFrame(contentWidthPx, 2000);
  try {
    frame.write(htmlDoc.html);
    await settle(frame.doc);
    return await paintToPdf(frame.doc, { page, title: htmlDoc.title, onProgress: opts.onProgress });
  } finally {
    frame.destroy();
  }
}

/** Texte visible à l'œil nu une fois le document ouvert/affiché — jamais le code source. */
export async function extractVisibleText(htmlDoc) {
  const frame = createFrame(900, 2000);
  try {
    frame.write(htmlDoc.html);
    await settle(frame.doc);
    const text = frame.doc.body.innerText || "";
    return text.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n");
  } finally {
    frame.destroy();
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {string} name          nom du fichier (pour la détection de format et le titre)
 * @param {string} target        pdf | docx | odt | rtf | doc | txt | html
 * @param {object} opts          { pdfjs, env, mode, title, onProgress, docOptions, resources, sourceFormat, password }
 */
export async function convertAny(bytes, name, target, opts = {}) {
  if (!ALL_FORMATS[target]) throw new Error(`Format de sortie inconnu : ${target}`);
  const srcFormat = opts.sourceFormat || detectFormat(name, bytes);
  if (!srcFormat) throw new Error(`Format de « ${name} » non reconnu.`);
  const title = opts.title || name.replace(/\.[^.]+$/, "");

  if (srcFormat === "pdf") {
    if (target === "pdf") return { bytes, ...ALL_FORMATS.pdf };
    const model = await pdfToModel(bytes, opts);
    model.title = title;
    if (target === "html") {
      const out = writeHtml(model);
      return { bytes: out, ...ALL_FORMATS.html, stats: model.stats, warnings: model.warnings, model };
    }
    if (target === "txt") {
      const out = writeTxt(model);
      return { bytes: out, ...ALL_FORMATS.txt, stats: model.stats, warnings: model.warnings, model, text: new TextDecoder("utf-8").decode(out) };
    }
    let out;
    if (target === "docx") out = await writeDocx(model);
    else if (target === "odt") out = await writeOdt(model);
    else out = writeRtf(model); // rtf et doc (même structure, extension différente)
    return { bytes: out, ...ALL_FORMATS[target], stats: model.stats, warnings: model.warnings, model };
  }

  // Formats non-PDF (DOCX, ODT, RTF, DOC, TXT, HTML, MHTML)
  const htmlDoc = await readToHtmlDoc(bytes, name, srcFormat, opts);
  const readerWarnings = htmlDoc.warnings || [];

  if (target === "html") {
    const out = new TextEncoder().encode(htmlDoc.html);
    return { bytes: out, ...ALL_FORMATS.html, warnings: readerWarnings };
  }
  if (target === "txt") {
    const text = await extractVisibleText(htmlDoc);
    const out = new TextEncoder().encode(text);
    return { bytes: out, ...ALL_FORMATS.txt, warnings: readerWarnings, text };
  }

  const pdfBytes = await renderToPdfBytes(htmlDoc, opts);
  if (target === "pdf") return { bytes: pdfBytes, ...ALL_FORMATS.pdf, warnings: readerWarnings };

  const model = await pdfToModel(pdfBytes, { ...opts, mode: opts.mode || "exact" });
  model.title = title;
  let out;
  if (target === "docx") out = await writeDocx(model);
  else if (target === "odt") out = await writeOdt(model);
  else out = writeRtf(model);
  return { bytes: out, ...ALL_FORMATS[target], stats: model.stats, warnings: [...readerWarnings, ...(model.warnings || [])], model };
}
