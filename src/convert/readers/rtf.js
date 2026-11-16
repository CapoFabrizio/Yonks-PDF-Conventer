// Lecteur RTF (Word, WordPad, LibreOffice, et les .doc/.rtf produits par ce convertisseur).
// Reconstruit paragraphes (alignement, retraits, espacements, trames), styles de caractères
// (police, taille, gras, italique, souligné, barré, couleurs, exposant/indice), tableaux
// (largeurs, bordures, fonds, fusions), images PNG/JPEG, liens, puces/numéros et sauts de page.
import { documentHtml, escapeHtml } from "./common.js";

const CHARSET_CP = { 0: null, 1: null, 2: null, 77: "macintosh", 128: "shift_jis", 129: "euc-kr", 130: "euc-kr", 134: "gbk", 136: "big5", 161: "windows-1253", 162: "windows-1254", 163: "windows-1258", 177: "windows-1255", 178: "windows-1256", 186: "windows-1257", 204: "windows-1251", 222: "windows-874", 238: "windows-1250" };
const FONT_GENERIC = { roman: "serif", swiss: "sans-serif", modern: "monospace", script: "cursive", decor: "fantasy", tech: "sans-serif", nil: "sans-serif", bidi: "sans-serif" };

// Destinations dont le contenu n'est pas du texte du document.
const SKIP = new Set(["stylesheet", "info", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "footnote", "annotation", "atnid", "atnauthor", "atrfstart", "atrfend", "atndate", "atnref", "nonshppict", "shprslt", "objdata", "objclass", "datafield", "themedata", "colorschememapping", "latentstyles", "datastore", "listtable", "listoverridetable", "rsidtbl", "generator", "pgdsctbl", "xmlnstbl", "mmathPr", "ftnsep", "ftnsepc", "aftnsep", "aftnsepc", "pn", "pnseclvl", "revtbl", "template", "docvar", "userprops", "bkmkstart", "bkmkend", "pgdsc", "xe", "tc", "sn", "wgrffmtfilter", "fchars", "lchars", "protusertbl", "passwordhash", "filetbl", "formfield", "falt", "panose", "fname", "picprop", "blipuid", "listname", "liststylename", "levelnumbers", "leveltext", "background", "oldcprops", "oldpprops", "oldtprops", "oldsprops"]);
// Destinations (souvent précédées de \*) que l'on traite.
const KNOWN = new Set(["fonttbl", "colortbl", "pict", "shppict", "fldinst", "fldrslt", "field", "listtext", "pntext", "shp", "shpinst", "shptxt", "sp", "sv", "object", "result", "shpgrp", "do", "dptxbxtext"]);

const tw = (n) => n / 20; // twips -> points

export function readRtf(bytes, title) {
  const src = new TextDecoder("latin1").decode(bytes);
  const n = src.length;

  // ---------- état ----------
  const fonts = {}, colors = [];
  let deff = 0, ansicp = "windows-1252";
  const page = { w: 12240, h: 15840, l: 1800, r: 1800, t: 1440, b: 1440 };
  const charDefaults = () => ({ b: false, i: false, ul: false, strike: false, fs: 24, f: deff, cf: 0, cb: 0, sup: false, sub: false, v: false, caps: false });
  const paraDefaults = () => ({ align: "left", li: 0, ri: 0, fi: 0, sb: 0, sa: 0, sl: 0, slmult: 1, intbl: false, cbpat: 0, pagebb: false, borders: null, pad: null });
  let st = { dest: "normal", uc: 1, star: false, pictOwner: false, link: null, field: null, assoc: null, ...charDefaults(), ...paraDefaults() };
  const stack = [];
  let skip = 0;              // caractères de repli à ignorer après \uN
  let pending = [];          // octets \'hh en attente de décodage
  const decoders = {};
  const decode = (arr, cp) => {
    const label = cp || ansicp;
    try { return (decoders[label] ||= new TextDecoder(label)).decode(Uint8Array.from(arr)); }
    catch (e) { return (decoders.w ||= new TextDecoder("windows-1252")).decode(Uint8Array.from(arr)); }
  };
  const fontCp = () => { const f = fonts[st.f]; return f && f.charset != null ? CHARSET_CP[f.charset] : null; };

  // ---------- structure produite ----------
  const body = [];
  let table = null, rowCells = [], cellBlocks = [];
  let para = { runs: [] };
  let rowDef = newRowDef(), cellDef = newCellDef(), borderTarget = null;
  let pendingBreak = false;
  let fontDef = null, colorDef = null, pict = null;
  const warnings = new Set();

  function newRowDef() { return { cells: [], left: 0, height: 0 }; }
  function newCellDef() { return { bg: 0, borders: {}, valign: "top", mergeFirst: false, merged: false, vFirst: false, vMerged: false }; }

  // ---------- rendu ----------
  const color = (i) => (i > 0 && colors[i - 0] ? colors[i] : null);
  function charCss(s) {
    const css = [];
    const f = fonts[s.f];
    if (f && f.name) css.push(`font-family:${JSON.stringify(f.name).replace(/"/g, "'")},${FONT_GENERIC[f.family] || "sans-serif"}`);
    const size = s.fs / 2 * (s.sup || s.sub ? 0.65 : 1);
    css.push(`font-size:${+size.toFixed(2)}pt`);
    if (s.b) css.push("font-weight:bold");
    if (s.i) css.push("font-style:italic");
    const deco = [s.ul ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) css.push(`text-decoration:${deco}`);
    const c = color(s.cf); if (c) css.push(`color:${c}`);
    const bg = color(s.cb); if (bg) css.push(`background-color:${bg}`);
    if (s.sup) css.push("vertical-align:super"); else if (s.sub) css.push("vertical-align:sub");
    if (s.caps) css.push("text-transform:uppercase");
    return css.join(";");
  }
  function addText(t) {
    if (!t || st.v) return;
    const css = charCss(st), href = st.link;
    const last = para.runs[para.runs.length - 1];
    if (last && last.text != null && last.css === css && last.href === href) last.text += t;
    else para.runs.push({ text: t, css, href });
  }
  function paraHtml(p, s) {
    const css = [];
    if (s.align !== "left") css.push(`text-align:${s.align}`);
    if (s.li) css.push(`margin-left:${tw(s.li)}pt`);
    if (s.ri) css.push(`margin-right:${tw(s.ri)}pt`);
    if (s.fi) css.push(`text-indent:${tw(s.fi)}pt`);
    if (s.sb) css.push(`margin-top:${tw(s.sb)}pt`);
    if (s.sa) css.push(`margin-bottom:${tw(s.sa)}pt`);
    if (s.sl) css.push(s.slmult ? `line-height:${+(Math.abs(s.sl) / 240 * 1.15).toFixed(3)}` : `line-height:${tw(Math.abs(s.sl))}pt`);
    const bg = color(s.cbpat); if (bg) css.push(`background-color:${bg}`);
    if (s.borders) for (const side of Object.keys(s.borders)) {
      const b = s.borders[side];
      if (b.style !== "none") css.push(`border-${side}:${Math.max(0.5, tw(b.w || 10))}pt solid ${color(b.c) || "#000"}`);
      if (b.sp) css.push(`padding-${side}:${tw(b.sp)}pt`);
    }
    let inner = "";
    for (const r of p.runs) {
      if (r.br) { inner += "<br>"; continue; }
      if (r.img) { inner += r.img; continue; }
      let h = `<span style="${r.css}">${escapeHtml(r.text)}</span>`;
      if (r.href) h = `<a href="${escapeHtml(r.href)}">${h}</a>`;
      inner += h;
    }
    if (!p.runs.some((r) => r.img || (r.text && r.text.trim() !== ""))) inner += `<span style="font-size:${s.fs / 2}pt">&#8203;</span><br>`;
    const cls = pendingBreak || s.pagebb ? ' class="rtf-break"' : "";
    pendingBreak = false;
    return `<p${cls} style="${css.join(";")}">${inner}</p>`;
  }
  function endPara(force) {
    if (!force && !para.runs.length && st.dest !== "normal") return;
    const html = paraHtml(para, st);
    para = { runs: [] };
    if (st.intbl || rowCells.length || cellBlocks.length) cellBlocks.push(html);
    else { closeTable(); body.push(html); }
  }
  function endCell() {
    if (para.runs.length || !cellBlocks.length) cellBlocks.push(paraHtml(para, st));
    para = { runs: [] };
    rowCells.push(cellBlocks); cellBlocks = [];
  }
  function endRow() {
    if (!rowCells.length && !cellBlocks.length) return;
    if (cellBlocks.length) { rowCells.push(cellBlocks); cellBlocks = []; }
    table ||= { rows: [] };
    table.rows.push({ cells: rowCells, def: rowDef });
    rowCells = [];
  }
  function closeTable() {
    if (!table) return;
    body.push(tableHtml(table));
    table = null;
  }
  function tableHtml(t) {
    let html = `<table class="rtf-table"${t.rows[0] && t.rows[0].def.left ? ` style="margin-left:${tw(t.rows[0].def.left)}pt"` : ""}>`;
    const open = []; // fusions verticales en cours : index de colonne (bord droit) -> cellule
    t.rows.forEach((row) => {
      const defs = row.def.cells;
      let x = row.def.left;
      const tds = [];
      for (let c = 0; c < row.cells.length; c++) {
        const d = defs[c] || newCellDef();
        const right = d.right != null ? d.right : x + 1440;
        const w = right - x;
        if (d.merged && tds.length) { tds[tds.length - 1].span++; tds[tds.length - 1].w += w; x = right; continue; }
        if (d.vMerged) { const o = open.find((k) => Math.abs(k.right - right) < 15); if (o) { o.td.rows++; x = right; continue; } }
        const td = { d, w, span: 1, rows: 1, blocks: row.cells[c] };
        if (d.vFirst) { const i = open.findIndex((k) => Math.abs(k.right - right) < 15); if (i >= 0) open.splice(i, 1); open.push({ right, td }); }
        tds.push(td);
        x = right;
      }
      html += `<tr${row.def.height ? ` style="height:${tw(Math.abs(row.def.height))}pt"` : ""}>`;
      row.html = tds;
      html += "\u0000" + (t.rows.indexOf(row)) + "\u0000</tr>";
    });
    // deuxième passe : les rowspan ne sont connus qu'après lecture de toutes les lignes
    html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => t.rows[+i].html.map((td) => {
      const css = [`width:${tw(td.w)}pt`, `vertical-align:${td.d.valign}`];
      const bg = color(td.d.bg); if (bg) css.push(`background-color:${bg}`);
      for (const side of ["top", "left", "bottom", "right"]) {
        const b = td.d.borders[side];
        if (b && b.style !== "none") css.push(`border-${side}:${Math.max(0.5, tw(b.w || 10))}pt solid ${color(b.c) || "#000"}`);
      }
      return `<td${td.span > 1 ? ` colspan="${td.span}"` : ""}${td.rows > 1 ? ` rowspan="${td.rows}"` : ""} style="${css.join(";")}">${td.blocks.join("")}</td>`;
    }).join(""));
    return html + "</table>";
  }

  // ---------- images ----------
  function finishPict(p, parentDest) {
    if (parentDest !== "normal" && parentDest !== "shape") return;
    if (p.type !== "png" && p.type !== "jpeg") { warnings.add("Images vectorielles Windows (WMF/EMF) non reprises."); return; }
    let b64;
    if (p.bin) b64 = btoa(p.bin);
    else {
      const hex = p.hex.join("").replace(/[^0-9a-fA-F]/g, "");
      let bin = "";
      for (let i = 0; i + 1 < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      b64 = btoa(bin);
    }
    let w = p.goalw ? tw(p.goalw) : p.w ? p.w * 0.75 : 0, h = p.goalh ? tw(p.goalh) : p.h ? p.h * 0.75 : 0;
    w *= (p.sx || 100) / 100; h *= (p.sy || 100) / 100;
    const size = w && h ? ` style="width:${+w.toFixed(2)}pt;height:${+h.toFixed(2)}pt"` : "";
    para.runs.push({ img: `<img src="data:image/${p.type};base64,${b64}"${size} alt="">` });
  }

  // ---------- mots de contrôle ----------
  function control(word, param) {
    if (skip > 0) skip = 0;
    if (st.star) {
      st.star = false;
      if (!KNOWN.has(word)) { st.dest = "skip"; return; }
    }
    if (st.dest === "skip") return;
    if (SKIP.has(word)) { st.dest = "skip"; return; }
    const d = st.dest;

    // --- destinations ---
    switch (word) {
      case "fonttbl": st.dest = "fonttbl"; fontDef = { idx: 0, family: "nil", charset: null, name: "" }; return;
      case "colortbl": st.dest = "colortbl"; colorDef = { r: null, g: null, b: null }; return;
      case "pict": if (d === "normal" || d === "shape") { st.dest = "pict"; st.pictOwner = true; pict = { hex: [], sx: 100, sy: 100 }; } else st.dest = "skip"; return;
      case "shppict": case "listtext": case "pntext": case "shptxt": case "result": case "dptxbxtext": if (d === "shape" || d === "normal") st.dest = "normal"; return;
      case "shpinst": case "sp": case "sv": case "shp": case "shpgrp": case "do": st.dest = d === "normal" || d === "shape" ? "shape" : d; return;
      case "object": return;
      case "field": st.field = { inst: "" }; return;
      case "fldinst": st.dest = "fldinst"; return;
      case "fldrslt": {
        st.dest = "normal";
        const m = st.field && st.field.inst.match(/HYPERLINK\s+(?:\\l\s+)?"?([^"\s]+)"?/i);
        if (m) st.link = /^\w+:|^#/.test(m[1]) ? m[1] : null;
        return;
      }
      default: break;
    }

    if (d === "fonttbl") {
      if (word === "f") fontDef.idx = param;
      else if (word === "fcharset") fontDef.charset = param;
      else if (/^f(nil|roman|swiss|modern|script|decor|tech|bidi)$/.test(word)) fontDef.family = word.slice(1);
      return;
    }
    if (d === "colortbl") {
      if (word === "red") colorDef.r = param; else if (word === "green") colorDef.g = param; else if (word === "blue") colorDef.b = param;
      return;
    }
    if (d === "pict") {
      switch (word) {
        case "pngblip": pict.type = "png"; break;
        case "jpegblip": pict.type = "jpeg"; break;
        case "emfblip": pict.type = "emf"; break;
        case "wmetafile": pict.type = "wmf"; break;
        case "dibitmap": case "wbitmap": pict.type = "bmp"; break;
        case "picw": pict.w = param; break;
        case "pich": pict.h = param; break;
        case "picwgoal": pict.goalw = param; break;
        case "pichgoal": pict.goalh = param; break;
        case "picscalex": pict.sx = param; break;
        case "picscaley": pict.sy = param; break;
        default: break;
      }
      return;
    }
    if (d === "fldinst") return;

    switch (word) {
      // --- document ---
      case "deff": deff = param; st.f = param; break;
      case "ansicpg": if (param && param !== 65001) ansicp = `windows-${param}`; if ([932, 936, 949, 950].includes(param)) ansicp = { 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5" }[param]; break;
      case "uc": st.uc = param; break;
      case "paperw": case "pgwsxn": page.w = param; break;
      case "paperh": case "pghsxn": page.h = param; break;
      case "margl": case "marglsxn": page.l = param; break;
      case "margr": case "margrsxn": page.r = param; break;
      case "margt": case "margtsxn": page.t = param; break;
      case "margb": case "margbsxn": page.b = param; break;
      // --- caractères ---
      case "plain": Object.assign(st, charDefaults()); break;
      case "b": st.b = param !== 0; break;
      case "i": st.i = param !== 0; break;
      case "ul": case "uld": case "uldb": case "ulw": case "ulth": case "uldash": case "ulwave": st.ul = param !== 0; break;
      case "ulnone": st.ul = false; break;
      case "strike": case "striked": st.strike = param !== 0; break;
      case "fs": if (param) st.fs = param; break;
      case "f": if (!st.assoc) st.f = param; break;
      case "hich": case "dbch": st.assoc = word; break;
      case "loch": st.assoc = null; break;
      case "cf": st.cf = param || 0; break;
      case "cb": case "highlight": case "chcbpat": st.cb = param || 0; break;
      case "super": st.sup = param !== 0; st.sub = false; break;
      case "sub": st.sub = param !== 0; st.sup = false; break;
      case "nosupersub": st.sup = st.sub = false; break;
      case "v": st.v = param !== 0; break;
      case "caps": st.caps = param !== 0; break;
      // --- paragraphes ---
      case "pard": Object.assign(st, paraDefaults()); borderTarget = null; break;
      case "ql": st.align = "left"; break;
      case "qc": st.align = "center"; break;
      case "qr": st.align = "right"; break;
      case "qj": st.align = "justify"; break;
      case "li": case "lin": st.li = param || 0; break;
      case "ri": case "rin": st.ri = param || 0; break;
      case "fi": st.fi = param || 0; break;
      case "sb": st.sb = param || 0; break;
      case "sa": st.sa = param || 0; break;
      case "sl": st.sl = param || 0; break;
      case "slmult": st.slmult = param || 0; break;
      case "intbl": st.intbl = true; break;
      case "cbpat": st.cbpat = param || 0; break;
      case "pagebb": st.pagebb = true; break;
      case "brdrt": case "brdrb": case "brdrl": case "brdrr": {
        const side = { t: "top", b: "bottom", l: "left", r: "right" }[word[4]];
        st.borders = { ...(st.borders || {}), [side]: { style: "none" } };
        borderTarget = st.borders[side];
        break;
      }
      case "brsp": if (borderTarget) borderTarget.sp = param; break;
      // --- bordures (cellule ou paragraphe, selon la dernière cible) ---
      case "brdrs": case "brdrth": case "brdrdb": case "brdrdot": case "brdrdash": case "brdrhair": case "brdrsh": if (borderTarget) borderTarget.style = "solid"; break;
      case "brdrnone": case "brdrnil": if (borderTarget) borderTarget.style = "none"; break;
      case "brdrw": if (borderTarget) borderTarget.w = param; break;
      case "brdrcf": if (borderTarget) borderTarget.c = param; break;
      // --- tableaux ---
      case "trowd": rowDef = newRowDef(); cellDef = newCellDef(); borderTarget = null; break;
      case "trleft": rowDef.left = param || 0; break;
      case "trrh": rowDef.height = param || 0; break;
      case "clcbpat": cellDef.bg = param || 0; break;
      case "clbrdrt": case "clbrdrb": case "clbrdrl": case "clbrdrr": {
        const side = { t: "top", b: "bottom", l: "left", r: "right" }[word[6]];
        borderTarget = cellDef.borders[side] = { style: "none" };
        break;
      }
      case "clvertalt": cellDef.valign = "top"; break;
      case "clvertalc": cellDef.valign = "middle"; break;
      case "clvertalb": cellDef.valign = "bottom"; break;
      case "clmgf": cellDef.mergeFirst = true; break;
      case "clmrg": cellDef.merged = true; break;
      case "clvmgf": cellDef.vFirst = true; break;
      case "clvmrg": cellDef.vMerged = true; break;
      case "cellx": cellDef.right = param; rowDef.cells.push(cellDef); cellDef = newCellDef(); borderTarget = null; break;
      case "cell": case "nestcell": endCell(); break;
      case "row": case "nestrow": endRow(); break;
      // --- texte spécial ---
      case "par": case "sect": endPara(true); break;
      case "page": if (para.runs.length) endPara(true); pendingBreak = true; break;
      case "line": case "lbr": para.runs.push({ br: true }); break;
      case "tab": addText("\t"); break;
      case "emdash": addText("—"); break;
      case "endash": addText("–"); break;
      case "emspace": addText(" "); break;
      case "enspace": addText(" "); break;
      case "qmspace": addText(" "); break;
      case "bullet": addText("•"); break;
      case "lquote": addText("‘"); break;
      case "rquote": addText("’"); break;
      case "ldblquote": addText("“"); break;
      case "rdblquote": addText("”"); break;
      case "u": {
        const cp = param < 0 ? param + 65536 : param;
        text(String.fromCharCode(cp), true);
        skip = st.uc;
        break;
      }
      default: break;
    }
  }

  function flushBytes() {
    if (!pending.length) return;
    const s = decode(pending, fontCp());
    pending = [];
    text(s, true);
  }

  function text(s, decoded) {
    if (!decoded) {
      if (skip > 0) { const k = Math.min(skip, s.length); s = s.slice(k); skip -= k; if (!s) return; }
      // octets bruts > 127 (RTF 8 bits) : passent par la page de codes
      if (/[\x80-\xff]/.test(s)) s = decode(Array.from(s, (c) => c.charCodeAt(0)), fontCp());
    }
    switch (st.dest) {
      case "normal": addText(s); break;
      case "pict": if (pict) pict.hex.push(s); break;
      case "fonttbl":
        for (const part of s.split(/(;)/)) {
          if (part === ";") { fonts[fontDef.idx] = { name: fontDef.name.trim(), family: fontDef.family, charset: fontDef.charset }; fontDef = { idx: fontDef.idx, family: "nil", charset: null, name: "" }; }
          else fontDef.name += part;
        }
        break;
      case "colortbl":
        for (const ch of s) if (ch === ";") {
          colors.push(colorDef.r == null && colorDef.g == null && colorDef.b == null ? null : `rgb(${colorDef.r || 0},${colorDef.g || 0},${colorDef.b || 0})`);
          colorDef = { r: null, g: null, b: null };
        }
        break;
      case "fldinst": if (st.field) st.field.inst += s; break;
      default: break;
    }
  }

  // ---------- boucle de lecture ----------
  const isLetter = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
  const isDigit = (c) => c >= 48 && c <= 57;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 123) { flushBytes(); skip = 0; stack.push(st); st = { ...st, pictOwner: false, star: false }; i++; continue; }
    if (c === 125) {
      flushBytes(); skip = 0;
      const closed = st;
      st = stack.pop() || st;
      if (closed.pictOwner && pict) { finishPict(pict, st.dest); pict = null; }
      i++; continue;
    }
    if (c === 92) {
      const c2 = src.charCodeAt(i + 1);
      if (isLetter(c2)) {
        let j = i + 1;
        while (j < n && isLetter(src.charCodeAt(j))) j++;
        const word = src.slice(i + 1, j);
        let param = null;
        if (src.charCodeAt(j) === 45 || isDigit(src.charCodeAt(j))) {
          let k = j + 1;
          while (k < n && isDigit(src.charCodeAt(k))) k++;
          param = parseInt(src.slice(j, k), 10);
          j = k;
        }
        if (src.charCodeAt(j) === 32) j++;
        i = j;
        flushBytes();
        if (word === "bin" && param > 0) { if (st.dest === "pict" && pict) pict.bin = src.substr(i, param); i += param; continue; }
        control(word, param);
        continue;
      }
      i += 2;
      if (c2 === 39) { // \'hh
        const v = parseInt(src.substr(i, 2), 16); i += 2;
        if (skip > 0) { skip--; continue; }
        if (!Number.isNaN(v) && (st.dest === "normal" || st.dest === "fonttbl" || st.dest === "fldinst")) pending.push(v);
        continue;
      }
      flushBytes();
      if (c2 === 42) { st.star = true; continue; }                      // \*
      if (c2 === 92 || c2 === 123 || c2 === 125) { text(src[i - 1]); continue; } // \\ \{ \}
      if (c2 === 126) { text(" ", true); continue; }               // \~
      if (c2 === 45) { text("­", true); continue; }                // \-
      if (c2 === 95) { text("‑", true); continue; }                // \_
      if (c2 === 10 || c2 === 13) { if (st.dest === "normal") endPara(true); continue; } // \<retour> = \par
      continue;
    }
    if (c === 13 || c === 10) { i++; continue; }
    let j = i;
    while (j < n) { const d = src.charCodeAt(j); if (d === 123 || d === 125 || d === 92 || d === 13 || d === 10) break; j++; }
    flushBytes();
    text(src.slice(i, j));
    i = j;
  }
  flushBytes();
  if (para.runs.length) endPara(true);
  if (rowCells.length || cellBlocks.length) endRow();
  closeTable();

  const out = documentHtml({
    title,
    body: body.join(""),
    css: `p { white-space: pre-wrap; tab-size: 48px; line-height: normal; }
.rtf-break { break-before: page; }
.rtf-table { border-collapse: collapse; table-layout: fixed; }
.rtf-table td { padding: 0 3pt; overflow-wrap: break-word; }
a { color: inherit; }`,
    page: { w: tw(page.w), h: tw(page.h), margins: { t: tw(page.t), r: tw(page.r), b: tw(page.b), l: tw(page.l) } },
  });
  out.warnings = [...warnings];
  return out;
}
