// Détection du format d'un fichier d'après son contenu (et, à défaut, son extension).

export const INPUT_FORMATS = {
  pdf: { label: "PDF", ext: "pdf" },
  docx: { label: "Word", ext: "docx" },
  odt: { label: "OpenDocument", ext: "odt" },
  rtf: { label: "RTF", ext: "rtf" },
  doc: { label: "Word 97-2003", ext: "doc" },
  html: { label: "Page web", ext: "html" },
  mhtml: { label: "Page web (MHTML)", ext: "mhtml" },
  txt: { label: "Texte", ext: "txt" },
};

/** Extensions acceptées comme ressources d'une page web enregistrée (dossier « _files »). */
export const RESOURCE_EXT = /\.(css|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf)$/i;

const startsWith = (b, s) => s.split("").every((c, i) => b[i] === c.charCodeAt(0));

function zipHas(bytes, name) {
  // recherche du nom de fichier dans le répertoire central du zip (sans décompresser)
  const needle = new TextEncoder().encode(name);
  outer: for (let i = 0; i < bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function detectFormat(name, bytes) {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  const head = bytes.subarray(0, 1024);
  if (startsWith(head, "%PDF") || /%PDF-/.test(new TextDecoder("latin1").decode(head))) return "pdf";
  if (startsWith(head, "PK\x03\x04")) {
    if (zipHas(bytes, "word/document.xml")) return "docx";
    if (zipHas(bytes, "application/vnd.oasis.opendocument.text")) return "odt";
    if (ext === "docx" || ext === "odt") return ext;
    return null;
  }
  const text = new TextDecoder("latin1").decode(head).replace(/^﻿|^ï»¿/, "").trimStart();
  if (text.startsWith("{\\rtf")) return "rtf";
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return ext === "doc" || ext === "dot" ? "doc" : "doc";
  if (/^(From:|MIME-Version:|Content-Type:\s*multipart\/related)/im.test(text.slice(0, 600)) && /multipart\/related/i.test(text)) return "mhtml";
  if (ext === "mht" || ext === "mhtml") return "mhtml";
  if (ext === "html" || ext === "htm" || ext === "xhtml" || /^<(!doctype html|html|head|body)/i.test(text)) return "html";
  if (ext === "txt" || ext === "text" || ext === "md" || ext === "csv" || ext === "log") return "txt";
  if (["docx", "odt", "rtf", "doc"].includes(ext)) return ext;
  return null;
}

/** Décodage d'un texte : BOM, UTF-8 strict, sinon Windows-1252 (fichiers Windows anciens). */
export function decodeText(bytes, hint) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (hint) { try { return new TextDecoder(hint, { fatal: true }).decode(bytes); } catch (e) { /* étiquette inconnue ou invalide */ } }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder("windows-1252").decode(bytes); }
}

export const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
