// Écriture RTF (Rich Text Format). Sert aussi au format .doc "compatible Word 97-2003" :
// Word et LibreOffice ouvrent un RTF nommé .doc comme un document Word normal.
import { hex } from "./util.js";

export function writeRtf(model) {
  const fonts = ["Arial"], colors = ["000000"];
  const fi = (f) => { const n = f || "Arial"; let i = fonts.indexOf(n); if (i < 0) { fonts.push(n); i = fonts.length - 1; } return i; };
  const ci = (c) => { const h = hex(c || [0, 0, 0]); let i = colors.indexOf(h); if (i < 0) { colors.push(h); i = colors.length - 1; } return i + 1; };
  const tw = (pt) => Math.round(pt * 20);
  const m = model.margins;
  const contentW = model.pageW - m.l - m.r;

  const para = (b, pageBreak, inTable) => {
    const q = { left: "\\ql", center: "\\qc", right: "\\qr", justify: "\\qj" }[b.align || "left"];
    let s = `\\pard\\plain${inTable ? "\\intbl" : ""}${pageBreak ? "\\pagebb" : ""}${q}\\sb${tw(b.spaceBefore || 0)}\\sa0`;
    s += `\\li${tw(b.indent || 0)}\\fi${tw(b.firstLine || 0)}\\sl${Math.round(240 * (b.lineRatio || 1))}\\slmult1`;
    if (b.shade) {
      s += `\\cbpat${ci(b.shade)}`;
      if (b.shadePad) { const c = ci(b.shade), sp = tw(b.shadePad); s += `\\brdrt\\brdrs\\brdrw10\\brsp${sp}\\brdrcf${c}\\brdrb\\brdrs\\brdrw10\\brsp${sp}\\brdrcf${c}`; }
    }
    if (b.heading) s += "\\keepn";
    return s + " ";
  };
  const run = (r) => `{\\f${fi(r.font)}\\fs${Math.max(2, Math.round(r.size * 2))}${r.bold ? "\\b" : ""}${r.italic ? "\\i" : ""}\\cf${ci(r.color)} ${rtfText(r.text)}}`;
  const pict = (img, maxW) => {
    let w = img.wPt, h = img.hPt;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    const tag = img.mime === "image/png" ? "\\pngblip" : "\\jpegblip";
    return `{\\pict${tag}\\picw${Math.round(img.pxW)}\\pich${Math.round(img.pxH)}\\picwgoal${tw(w)}\\pichgoal${tw(h)}\n${toHexLines(img.data)}}`;
  };

  function blocks(bs, width, pageBreak, inTable) {
    let out = "";
    bs.forEach((b, idx) => {
      const brk = idx === 0 && pageBreak;
      if (b.kind === "p") out += para(b, brk, inTable) + b.runs.map(run).join("") + (inTable ? "" : "\\par\n");
      else if (b.kind === "img") out += para({ ...b, lineRatio: 1 }, brk, inTable) + pict(b, width - (b.indent || 0)) + (inTable ? "" : "\\par\n");
      else if (b.kind === "cols") out += table(b, width, brk, inTable);
      else if (b.kind === "table") out += inTable ? b.rows.map((r) => r.cells.map((c) => blocks(c.blocks, c.width, false, true)).join("\\tab ")).join("\\par\n") : gridTable(b, width, brk);
      if (inTable && idx < bs.length - 1) out += "\\par\n";
    });
    return out;
  }
  function table(b, width, pageBreak, nested) {
    if (nested) return b.cols.map((c) => blocks(c.blocks, c.width, false, true)).join("\\par\n"); // pas de tableaux imbriqués
    const total = b.cols.reduce((s, c) => s + c.width, 0) || width;
    const k = Math.min(1, width / total);
    let x = tw(b.indent || 0);
    let row = `\\pard\\plain${pageBreak ? "\\pagebb" : ""}\\sb${tw(b.spaceBefore || 0)}\\sa0\\fs2\\par\n\\trowd\\trgaph60\\trleft${x}`;
    const rights = b.cols.map((c) => { x += tw(c.width * k); return x; });
    rights.forEach((r) => { row += `\\clbrdrt\\brdrnone\\clbrdrl\\brdrnone\\clbrdrb\\brdrnone\\clbrdrr\\brdrnone\\cellx${r}`; });
    row += "\n";
    b.cols.forEach((c) => { row += (blocks(c.blocks, c.width * k - 6, false, true) || "\\pard\\intbl ") + "\\cell\n"; });
    return row + "\\row\n";
  }

  function gridTable(b, width, pageBreak) {
    const total = b.colWidths.reduce((a, v) => a + v, 0) || width;
    const k = Math.min(1, (width - (b.indent || 0)) / total);
    const bw = Math.max(2, Math.round(b.border.width * 20)), bc = ci(b.border.color);
    const brd = ["t", "l", "b", "r"].map((side) => `\\clbrdr${side}\\brdrs\\brdrw${bw}\\brdrcf${bc}`).join("");
    let out = `\\pard\\plain${pageBreak ? "\\pagebb" : ""}\\sb${tw(b.spaceBefore || 0)}\\sa0\\fs2\\par\n`;
    for (const row of b.rows) {
      let x = tw(b.indent || 0), ciIdx = 0;
      out += `\\trowd\\trgaph50\\trleft${x}\\trrh${tw(row.height * k)}`;
      const cellsX = row.cells.map((cell) => {
        const w = b.colWidths.slice(ciIdx, ciIdx + cell.span).reduce((a, v) => a + v, 0) * k;
        ciIdx += cell.span; x += tw(w);
        return { cell, w, x };
      });
      cellsX.forEach(({ cell, x: right }) => { out += brd + (cell.shade ? `\\clcbpat${ci(cell.shade)}` : "") + `\\cellx${right}`; });
      out += "\n";
      cellsX.forEach(({ cell, w }) => { out += (blocks(cell.blocks, w - 8, false, true) || "\\pard\\intbl ") + "\\cell\n"; });
      out += "\\row\n";
    }
    return out;
  }

  let body = "";
  model.pages.forEach((p, pi) => {
    if (!p.blocks.length && pi > 0) body += "\\pard\\pagebb\\par\n";
    body += blocks(p.blocks, contentW, pi > 0, false);
  });

  const header = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl${fonts.map((f, i) => `{\\f${i}\\fnil ${f.replace(/[{}\\;]/g, "")};}`).join("")}}{\\colortbl;${colors.map((h) => `\\red${parseInt(h.slice(0, 2), 16)}\\green${parseInt(h.slice(2, 4), 16)}\\blue${parseInt(h.slice(4, 6), 16)};`).join("")}}\n`;
  const page = `\\paperw${tw(model.pageW)}\\paperh${tw(model.pageH)}\\margl${tw(m.l)}\\margr${tw(m.r)}\\margt${tw(m.t)}\\margb${tw(m.b)}${model.pageW > model.pageH ? "\\landscape" : ""}\n`;
  // la table des polices/couleurs n'est connue qu'après le corps : on assemble à la fin
  return new TextEncoder().encode(header + page + body + "}");
}

function rtfText(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], code = s.charCodeAt(i);
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\t") out += "\\tab ";
    else if (ch === "\n") out += "\\line ";
    else if (code > 127) out += `\\u${code > 32767 ? code - 65536 : code}?`;
    else out += ch;
  }
  return out;
}

function toHexLines(bytes) {
  // Les lecteurs RTF exigent des données \pict découpées en lignes (une ligne géante est rejetée).
  const H = "0123456789abcdef";
  const lines = [];
  for (let i = 0; i < bytes.length; i += 64) {
    let line = "";
    const end = Math.min(bytes.length, i + 64);
    for (let j = i; j < end; j++) line += H[bytes[j] >> 4] + H[bytes[j] & 15];
    lines.push(line);
  }
  return lines.join("\n");
}
