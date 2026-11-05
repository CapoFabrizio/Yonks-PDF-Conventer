import { pdfToModel } from "./convert.js";
import { writeDocx } from "./writers/docx.js";
import { writeOdt } from "./writers/odt.js";
import { writeRtf } from "./writers/rtf.js";
import { writeTxt } from "./writers/txt.js";

export const FORMATS = {
  docx: { label: "Word (.docx)", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  odt: { label: "OpenDocument (.odt)", mime: "application/vnd.oasis.opendocument.text", ext: "odt" },
  rtf: { label: "Rich Text (.rtf)", mime: "application/rtf", ext: "rtf" },
  doc: { label: "Word 97-2003 (.doc)", mime: "application/msword", ext: "doc" },
  txt: { label: "Texte brut (.txt)", mime: "text/plain;charset=utf-8", ext: "txt" },
};

/**
 * Convertit un PDF.
 * @param {Uint8Array} data
 * @param {string} format  docx | odt | rtf | doc | txt
 * @param {object} opts    { pdfjs, env, mode: 'editable'|'exact', title, onProgress, docOptions }
 */
export async function convertPdf(data, format, opts) {
  if (!FORMATS[format]) throw new Error(`Format inconnu : ${format}`);
  const model = await pdfToModel(data, opts);
  model.title = opts.title || "Document converti";
  let bytes;
  if (format === "docx") bytes = await writeDocx(model);
  else if (format === "odt") bytes = await writeOdt(model);
  else if (format === "rtf" || format === "doc") bytes = writeRtf(model);
  else bytes = writeTxt(model);
  return { bytes, ...FORMATS[format], stats: model.stats, warnings: model.warnings, model };
}
