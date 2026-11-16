// Word 97-2003 binaire (.doc) : lecture du texte via la table des pièces (format [MS-DOC]).
// La mise en forme fine (polices, couleurs) n'est pas reconstruite ; paragraphes, tableaux,
// sauts de ligne et de page le sont. Un .doc qui est en réalité un RTF passe par le lecteur RTF.
import CFB from "cfb";
import { documentHtml, escapeHtml } from "./common.js";

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function streamBytes(cfb, name) {
  const e = CFB.find(cfb, name);
  return e && e.content ? Uint8Array.from(e.content) : null;
}

export function docText(bytes) {
  const cfb = CFB.read(bytes, { type: "array" });
  const wd = streamBytes(cfb, "WordDocument");
  if (!wd) throw new Error("Fichier .doc illisible (flux WordDocument absent).");
  if (u16(wd, 0) !== 0xa5ec) throw new Error("Fichier .doc non reconnu.");
  const flags = u16(wd, 0x0a);
  if (flags & 0x0100) throw new Error("Ce document Word est protégé par un mot de passe : ouvrez-le dans Word, retirez la protection, puis réessayez.");
  const table = streamBytes(cfb, flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new Error("Fichier .doc illisible (table absente).");
  const ccpText = u32(wd, 0x4c);
  const fcClx = u32(wd, 0x1a2), lcbClx = u32(wd, 0x1a6);
  let pos = fcClx;
  const end = fcClx + lcbClx;
  while (pos < end && table[pos] === 0x01) pos += 3 + u16(table, pos + 1); // Prc (modificateurs) ignorés
  if (table[pos] !== 0x02) throw new Error("Fichier .doc illisible (table des pièces).");
  const lcb = u32(table, pos + 1);
  const plc = pos + 5;
  const n = (lcb - 4) / 12;
  const cps = [], pcds = [];
  for (let i = 0; i <= n; i++) cps.push(u32(table, plc + i * 4));
  for (let i = 0; i < n; i++) pcds.push(plc + (n + 1) * 4 + i * 8);
  let text = "";
  const dec1252 = new TextDecoder("windows-1252");
  for (let i = 0; i < n && cps[i] < ccpText; i++) {
    const len = Math.min(cps[i + 1], ccpText) - cps[i];
    const fcRaw = u32(table, pcds[i] + 2);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    if (compressed) text += dec1252.decode(wd.subarray(fc / 2, fc / 2 + len));
    else { let s = ""; for (let k = 0; k < len; k++) s += String.fromCharCode(u16(wd, fc + k * 2)); text += s; }
  }
  return cleanFields(text);
}

/** Champs Word : \x13 code \x14 résultat \x15 -> on garde le résultat affiché. */
function cleanFields(t) {
  let out = "", depth = [];
  for (const ch of t) {
    if (ch === "\x13") { depth.push("code"); continue; }
    if (ch === "\x14") { if (depth.length) depth[depth.length - 1] = "result"; continue; }
    if (ch === "\x15") { depth.pop(); continue; }
    if (depth.includes("code")) continue;
    out += ch;
  }
  return out;
}

export function readDoc(bytes, title) {
  const text = docText(bytes);
  const inline = (s) => escapeHtml(s.replace(/[\x01\x02\x05\x08]/g, "").replace(/\x1e/g, "‑").replace(/\x1f/g, "­")).replace(/\x0b/g, "<br>").replace(/\t/g, "&#9;");
  const parts = [];
  let row = [], cell = "", rows = [];
  const flushTable = () => {
    if (!rows.length) return;
    parts.push("<table class=\"doc-table\">" + rows.map((r) => "<tr>" + r.map((c) => `<td>${c.split("\r").map((p) => `<p>${inline(p) || "&nbsp;"}</p>`).join("")}</td>`).join("") + "</tr>").join("") + "</table>");
    rows = [];
  };
  // tokens : texte, \r (fin de paragraphe), \x07 (fin de cellule ; deux à la suite = fin de ligne)
  let i = 0, buf = "", lastWasCell = false;
  while (i <= text.length) {
    const ch = text[i];
    if (ch === "\x07") {
      if (lastWasCell && buf === "") { rows.push(row); row = []; lastWasCell = false; }
      else { row.push(buf); buf = ""; lastWasCell = true; }
    } else if (ch === "\r" || ch === undefined) {
      if (row.length) { buf += "\r"; }
      else {
        flushTable();
        const pages = buf.split("\x0c");
        pages.forEach((p, k) => { if (k > 0) parts.push('<div class="page-break"></div>'); if (k < pages.length - 1 || p !== "" || ch !== undefined) parts.push(`<p>${inline(p) || "&nbsp;"}</p>`); });
        buf = "";
      }
      lastWasCell = false;
    } else { buf += ch; lastWasCell = false; }
    i++;
  }
  if (row.length) rows.push(row);
  flushTable();
  const out = documentHtml({ title, body: parts.join(""), css: `.doc-table td { border: 1px solid #000; padding: 2px 6px; vertical-align: top; } p { white-space: pre-wrap; }` });
  out.warnings = ["Fichier .doc (format binaire) : seul le texte et les tableaux sont repris, pas les images ni la mise en forme fine des caractères. Pour une conversion complète, enregistrez d'abord le document en .docx."];
  return out;
}
