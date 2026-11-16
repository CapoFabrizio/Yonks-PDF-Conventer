// Lecteur ODT (OpenDocument Text — LibreOffice/OpenOffice, et les .odt produits par ce
// convertisseur). Dézippe l'archive et transforme content.xml + styles.xml en HTML affichable :
// styles de paragraphe/caractère en cascade, listes, tableaux, images, en-têtes/pieds, page.
import JSZip from "jszip";
import { documentHtml, escapeHtml } from "./common.js";

const NS = {
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
  draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  svg: "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
  xlink: "http://www.w3.org/1999/xlink",
};
const q = (tag, ns) => `*|${tag}`; // on matche par nom local pour rester simple et robuste

function localName(el) { return el.localName || el.tagName.split(":").pop(); }
function children(el, name) { return [...el.children].filter((c) => localName(c) === name); }
function child(el, name) { return children(el, name)[0] || null; }
function attrNS(el, ns, name) { return el.getAttributeNS(ns, name) || el.getAttribute(`${Object.keys(NS).find((k) => NS[k] === ns)}:${name}`); }

export async function readOdt(bytes, title) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch (e) { throw new Error("Fichier .odt illisible (archive ZIP invalide)."); }
  const contentEntry = zip.file("content.xml");
  if (!contentEntry) throw new Error("Fichier .odt illisible (content.xml absent).");
  const manifestEntry = zip.file("META-INF/manifest.xml");
  if (manifestEntry) {
    const manifest = await manifestEntry.async("string");
    if (/encryption-data/i.test(manifest)) throw new Error("Ce document ODT est protégé par un mot de passe : ouvrez-le dans LibreOffice, retirez la protection, puis réessayez.");
  }
  const parser = new DOMParser();
  const contentDoc = parser.parseFromString(await contentEntry.async("string"), "application/xml");
  const stylesEntry = zip.file("styles.xml");
  const stylesDoc = stylesEntry ? parser.parseFromString(await stylesEntry.async("string"), "application/xml") : null;
  // dossier -> données binaires, pour les images intégrées
  const files = {};
  await Promise.all(Object.keys(zip.files).map(async (path) => {
    const f = zip.files[path];
    if (!f.dir && /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(path)) files[path] = await f.async("uint8array");
  }));

  // ---------- styles ----------
  const autoStyles = new Map(), namedStyles = new Map(), listStyles = new Map(), pageLayouts = new Map();
  function collectStyles(doc, into) {
    if (!doc) return;
    for (const el of doc.getElementsByTagNameNS(NS.style, "style")) {
      const name = attrNS(el, NS.style, "name");
      if (name) into.set(name, parseStyleEl(el));
    }
  }
  function parseStyleEl(el) {
    const family = attrNS(el, NS.style, "family");
    const parent = attrNS(el, NS.style, "parent-style-name");
    const s = { family, parent, p: {}, t: {}, list: attrNS(el, NS.style, "list-style-name") };
    const pp = child(el, "paragraph-properties");
    if (pp) {
      const g = (ns, n) => attrNS(pp, ns, n);
      if (g(NS.fo, "text-align")) s.p.align = { start: "left", end: "right", left: "left", right: "right", center: "center", justify: "justify" }[g(NS.fo, "text-align")] || "left";
      if (g(NS.fo, "margin-left")) s.p.li = g(NS.fo, "margin-left");
      if (g(NS.fo, "margin-right")) s.p.ri = g(NS.fo, "margin-right");
      if (g(NS.fo, "text-indent")) s.p.fi = g(NS.fo, "text-indent");
      if (g(NS.fo, "margin-top")) s.p.sb = g(NS.fo, "margin-top");
      if (g(NS.fo, "margin-bottom")) s.p.sa = g(NS.fo, "margin-bottom");
      if (g(NS.fo, "line-height")) s.p.lh = g(NS.fo, "line-height");
      if (g(NS.fo, "background-color") && g(NS.fo, "background-color") !== "transparent") s.p.bg = g(NS.fo, "background-color");
      if (g(NS.fo, "break-before") === "page") s.p.breakBefore = true;
      const borders = ["top", "bottom", "left", "right"];
      for (const side of borders) { const b = g(NS.fo, `border-${side}`) || g(NS.fo, "border"); if (b && b !== "none") (s.p.borders ||= {})[side] = b; }
    }
    const tp = child(el, "text-properties");
    if (tp) {
      const g = (ns, n) => attrNS(tp, ns, n);
      if (g(NS.fo, "font-weight")) s.t.bold = g(NS.fo, "font-weight") === "bold";
      if (g(NS.fo, "font-style")) s.t.italic = g(NS.fo, "font-style") === "italic";
      const u = attrNS(tp, NS.style, "text-underline-style");
      if (u) s.t.underline = u !== "none";
      const strike = attrNS(tp, NS.style, "text-line-through-style");
      if (strike) s.t.strike = strike !== "none";
      if (g(NS.fo, "color")) s.t.color = g(NS.fo, "color");
      const hl = attrNS(tp, NS.style, "text-background-color") || g(NS.fo, "background-color");
      if (hl && hl !== "transparent") s.t.bg = hl;
      if (g(NS.fo, "font-size")) s.t.size = g(NS.fo, "font-size");
      if (g(NS.style, "font-name") || g(NS.fo, "font-family")) s.t.font = attrNS(tp, NS.style, "font-name") || g(NS.fo, "font-family");
      const pos = attrNS(tp, NS.style, "text-position");
      if (pos) { if (/^-?\d+%?\s*super/.test(pos) || pos.startsWith("super")) s.t.sup = true; else if (pos.startsWith("sub")) s.t.sub = true; else if (parseFloat(pos) > 0) s.t.sup = true; else if (parseFloat(pos) < 0) s.t.sub = true; }
      if (attrNS(tp, NS.fo, "text-transform") === "uppercase") s.t.caps = true;
    }
    return s;
  }
  collectStyles(stylesDoc, namedStyles);
  collectStyles(contentDoc, autoStyles);
  const getStyle = (name) => autoStyles.get(name) || namedStyles.get(name);
  function resolveParaCss(name, usedList) {
    const css = { align: "left" };
    const chain = [];
    let cur = name;
    const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const s = getStyle(cur); if (!s) break; chain.unshift(s); cur = s.parent; }
    for (const s of chain) {
      Object.assign(css, s.p);
      if (s.list) usedList.name = s.list;
    }
    return css;
  }
  function resolveCharCss(name) {
    const css = {};
    let cur = name; const seen = new Set();
    const chain = [];
    while (cur && !seen.has(cur)) { seen.add(cur); const s = getStyle(cur); if (!s) break; chain.unshift(s); cur = s.parent; }
    for (const s of chain) Object.assign(css, s.t);
    return css;
  }
  function pxCss(v) { return v && /^-?[\d.]+(cm|mm|in|pt|pc|px)$/.test(v) ? convertUnit(v) : v; }
  function convertUnit(v) {
    const m = v.match(/^(-?[\d.]+)(cm|mm|in|pt|pc|px)$/);
    if (!m) return v;
    const n = parseFloat(m[1]);
    const factor = { cm: 28.3465, mm: 2.83465, in: 72, pt: 1, pc: 12, px: 0.75 }[m[2]];
    return `${(n * factor).toFixed(2)}pt`;
  }
  function paraStyleCss(css) {
    const out = [];
    if (css.align) out.push(`text-align:${css.align}`);
    if (css.li) out.push(`margin-left:${convertUnit(css.li)}`);
    if (css.ri) out.push(`margin-right:${convertUnit(css.ri)}`);
    if (css.fi) out.push(`text-indent:${convertUnit(css.fi)}`);
    if (css.sb) out.push(`margin-top:${convertUnit(css.sb)}`);
    if (css.sa) out.push(`margin-bottom:${convertUnit(css.sa)}`);
    if (css.lh) out.push(`line-height:${/%$/.test(css.lh) ? parseFloat(css.lh) / 100 : convertUnit(css.lh)}`);
    if (css.bg) out.push(`background-color:${css.bg}`);
    if (css.borders) for (const side of Object.keys(css.borders)) out.push(`border-${side}:${css.borders[side].replace(/([\d.]+(cm|mm|in|pt|pc|px))/, (m2) => convertUnit(m2))}`);
    return out.join(";");
  }
  function charStyleCss(css) {
    const out = [];
    if (css.bold) out.push("font-weight:bold");
    if (css.italic) out.push("font-style:italic");
    const deco = [css.underline ? "underline" : "", css.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) out.push(`text-decoration:${deco}`);
    if (css.color) out.push(`color:${css.color}`);
    if (css.bg) out.push(`background-color:${css.bg}`);
    if (css.size) out.push(`font-size:${convertUnit(css.size)}`);
    if (css.font) out.push(`font-family:${JSON.stringify(css.font).replace(/"/g, "'")},sans-serif`);
    if (css.sup) out.push("vertical-align:super;font-size:smaller");
    if (css.sub) out.push("vertical-align:sub;font-size:smaller");
    if (css.caps) out.push("text-transform:uppercase");
    return out.join(";");
  }

  // ---------- listes ----------
  function collectListStyles(doc) {
    if (!doc) return;
    for (const el of doc.getElementsByTagNameNS(NS.text, "list-style")) {
      const name = attrNS(el, NS.style, "name");
      const levels = [];
      for (const lvl of [...el.children]) {
        const n = localName(lvl);
        if (n === "list-level-style-number" || n === "list-level-style-bullet") {
          levels.push({ ordered: n === "list-level-style-number", bullet: attrNS(lvl, NS.text, "bullet-char") || "•" });
        }
      }
      listStyles.set(name, levels);
    }
  }
  collectListStyles(stylesDoc);
  collectListStyles(contentDoc);

  // ---------- images ----------
  const mediaCache = new Map();
  function imageDataUri(href) {
    if (mediaCache.has(href)) return mediaCache.get(href);
    const path = href.replace(/^\.?\//, "");
    const data = files[path];
    if (!data) return null;
    const ext = (path.split(".").pop() || "").toLowerCase();
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp", webp: "image/webp" }[ext] || "application/octet-stream";
    let bin = "";
    for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
    const uri = `data:${mime};base64,${btoa(bin)}`;
    mediaCache.set(href, uri);
    return uri;
  }

  // ---------- rendu du corps ----------
  const warnings = new Set();
  function renderSpan(el) {
    let html = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { html += escapeHtml(node.nodeValue); continue; }
      if (node.nodeType !== 1) continue;
      const n = localName(node);
      switch (n) {
        case "span": {
          const css = charStyleCss(resolveCharCss(attrNS(node, NS.text, "style-name")));
          html += `<span style="${css}">${renderSpan(node)}</span>`;
          break;
        }
        case "a": html += `<a href="${escapeHtml(attrNS(node, NS.xlink, "href") || "#")}">${renderSpan(node)}</a>`; break;
        case "s": { const c = parseInt(node.getAttribute("text:c") || "1", 10) || 1; html += "&nbsp;".repeat(c); break; }
        case "tab": html += "&#9;"; break;
        case "line-break": html += "<br>"; break;
        case "soft-page-break": html += '<span class="odt-page-break-inline"></span>'; break;
        case "bookmark": case "bookmark-start": case "bookmark-end": break;
        case "note": { const body = child(node, "note-body"); html += body ? renderSpan(body) : ""; break; }
        case "frame": case "shape": html += renderFrame(node); break;
        default: html += renderSpan(node);
      }
    }
    return html;
  }
  function renderFrame(frame) {
    const img = child(frame, "image");
    const w = frame.getAttribute("svg:width"), h = frame.getAttribute("svg:height");
    const style = [w ? `width:${convertUnit(w)}` : "", h ? `height:${convertUnit(h)}` : ""].filter(Boolean).join(";");
    if (img) {
      const href = attrNS(img, NS.xlink, "href");
      const uri = href ? imageDataUri(href) : null;
      if (uri) return `<img src="${uri}" style="${style}" alt="">`;
      warnings.add("Certaines images intégrées n'ont pas pu être lues.");
      return "";
    }
    const textBox = child(frame, "text-box");
    if (textBox) return `<div style="${style};border:1px solid #ccc;padding:4px">${renderBlocks(textBox)}</div>`;
    return "";
  }
  function listItemPrefix(listEl, depth) {
    const name = listEl.getAttribute("text:style-name");
    const levels = name && listStyles.get(name);
    const lvl = levels && levels[Math.min(depth, levels.length - 1)];
    if (lvl && !lvl.ordered) return `<span class="odt-bullet">${escapeHtml(lvl.bullet)}</span> `;
    if (lvl && lvl.ordered) return null; // numéroté : <ol> suffit
    return `<span class="odt-bullet">•</span> `;
  }
  function renderList(el, depth) {
    const items = children(el, "list-item");
    const name = el.getAttribute("text:style-name");
    const levels = name && listStyles.get(name);
    const lvl = levels && levels[Math.min(depth, levels.length - 1)];
    const ordered = lvl ? lvl.ordered : false;
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag} class="odt-list">`;
    for (const item of items) {
      html += `<li>${renderBlocks(item, depth + 1)}</li>`;
    }
    return html + `</${tag}>`;
  }
  function renderTable(el) {
    const cols = children(el, "table-column");
    const colgroup = cols.length ? `<colgroup>${cols.map((c) => {
      const rep = parseInt(c.getAttribute("table:number-columns-repeated") || "1", 10);
      const w = c.getAttribute("style:column-width") || (getStyle(c.getAttribute("table:style-name"))?.columnWidth);
      return `<col${w ? ` style="width:${convertUnit(w)}"` : ""}>`.repeat(rep);
    }).join("")}</colgroup>` : "";
    let html = `<table class="odt-table">${colgroup}`;
    for (const row of children(el, "table-row")) {
      html += "<tr>";
      for (const cell of children(row, "table-cell")) {
        const span = parseInt(cell.getAttribute("table:number-columns-spanned") || "1", 10);
        const styleName = cell.getAttribute("table:style-name");
        const st = styleName && getStyle(styleName);
        const css = [];
        if (st && st.p && st.p.bg) css.push(`background-color:${st.p.bg}`);
        if (st && st.p && st.p.borders) for (const side of Object.keys(st.p.borders)) css.push(`border-${side}:${convertUnit(st.p.borders[side].match(/[\d.]+(cm|mm|in|pt|pc|px)/)?.[0] || "0.5pt")} solid #000`);
        html += `<td${span > 1 ? ` colspan="${span}"` : ""} style="${css.join(";")}">${renderBlocks(cell) || "<p>&nbsp;</p>"}</td>`;
      }
      html += "</tr>";
    }
    return html + "</table>";
  }
  function renderBlocks(container, listDepth = 0) {
    let html = "";
    for (const node of [...container.children]) {
      const n = localName(node);
      switch (n) {
        case "p": {
          const usedList = {};
          const css = paraStyleCss(resolveParaCss(node.getAttribute("text:style-name"), usedList));
          const brk = resolveParaCss(node.getAttribute("text:style-name"), {}).breakBefore ? ' class="page-break"' : "";
          let inner = renderSpan(node);
          if (!inner.trim()) inner = "&nbsp;";
          html += brk ? `<div${brk}></div><p style="${css}">${inner}</p>` : `<p style="${css}">${inner}</p>`;
          break;
        }
        case "h": {
          const level = Math.min(6, parseInt(node.getAttribute("text:outline-level") || "1", 10));
          const resolved = resolveParaCss(node.getAttribute("text:style-name"), {});
          const css = paraStyleCss(resolved);
          const brk = resolved.breakBefore ? '<div class="page-break"></div>' : "";
          html += `${brk}<h${level} style="font-weight:bold;${css}">${renderSpan(node) || "&nbsp;"}</h${level}>`;
          break;
        }
        case "list": html += renderList(node, listDepth); break;
        case "table": html += renderTable(node); break;
        case "frame": case "shape": html += `<p>${renderFrame(node)}</p>`; break;
        case "sequence-decls": case "tracked-changes": break;
        case "section": html += renderBlocks(node, listDepth); break;
        default: break;
      }
    }
    return html;
  }

  const office = contentDoc.documentElement;
  const bodyEl = office.getElementsByTagNameNS(NS.office, "body")[0];
  const textEl = bodyEl && (office.getElementsByTagNameNS(NS.office, "text")[0]);
  if (!textEl) throw new Error("Fichier .odt illisible (contenu texte absent).");
  const body = renderBlocks(textEl);

  // ---------- mise en page ----------
  let page = null;
  if (stylesDoc) {
    const masterPage = stylesDoc.getElementsByTagNameNS(NS.style, "master-page")[0];
    const layoutName = masterPage && masterPage.getAttribute("style:page-layout-name");
    const layout = layoutName && [...stylesDoc.getElementsByTagNameNS(NS.style, "page-layout")].find((p) => p.getAttribute("style:name") === layoutName);
    const pp = layout && child(layout, "page-layout-properties");
    if (pp) {
      const g = (ns, n) => attrNS(pp, ns, n);
      const w = g(NS.fo, "page-width"), h = g(NS.fo, "page-height");
      if (w && h) page = {
        w: parseFloat(convertUnit(w)), h: parseFloat(convertUnit(h)),
        margins: {
          t: parseFloat(convertUnit(g(NS.fo, "margin-top") || "1in")),
          r: parseFloat(convertUnit(g(NS.fo, "margin-right") || "1in")),
          b: parseFloat(convertUnit(g(NS.fo, "margin-bottom") || "1in")),
          l: parseFloat(convertUnit(g(NS.fo, "margin-left") || "1in")),
        },
      };
    }
  }

  const out = documentHtml({
    title,
    body,
    page,
    css: `.odt-list { margin: 0; padding-left: 1.5em; } .odt-bullet { display: none; }
.odt-table { border-collapse: collapse; width: 100%; } .odt-table td { padding: 2px 6px; vertical-align: top; }
h1,h2,h3,h4,h5,h6 { margin: 0.6em 0 0.3em; }`,
  });
  out.warnings = [...warnings];
  return out;
}
