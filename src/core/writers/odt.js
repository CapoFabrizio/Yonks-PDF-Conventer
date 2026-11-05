// Écriture ODT (OpenDocument Text) — LibreOffice / OpenOffice, lisible aussi par Word.
import JSZip from "jszip";
import { esc, hex, extOf } from "./util.js";

export async function writeOdt(model) {
  const zip = new JSZip();
  const pics = [];
  const pStyles = new Map(), tStyles = new Map(), tableStyles = [];
  const cm = (pt) => (pt * 2.54 / 72).toFixed(3) + "cm";

  const pStyle = (b, pageBreak) => {
    const align = { left: "start", center: "center", right: "end", justify: "justify" }[b.align || "left"];
    const props = [
      `fo:text-align="${align}"`,
      `fo:margin-top="${cm(b.spaceBefore || 0)}"`, `fo:margin-bottom="0cm"`,
      `fo:margin-left="${cm(b.indent || 0)}"`, `fo:text-indent="${cm(b.firstLine || 0)}"`,
      `fo:line-height="${Math.round((b.lineRatio || 1) * 100)}%"`,
      b.shade ? `fo:background-color="#${hex(b.shade)}"` : "",
      b.shade && b.shadePad ? `fo:padding-top="${cm(b.shadePad)}" fo:padding-bottom="${cm(b.shadePad)}" fo:padding-left="0.14cm" fo:padding-right="0.14cm"` : "",
      pageBreak ? `fo:break-before="page"` : "",
      b.heading ? `fo:keep-with-next="always"` : "",
    ].filter(Boolean).join(" ");
    if (!pStyles.has(props)) pStyles.set(props, `P${pStyles.size + 1}`);
    return pStyles.get(props);
  };
  const tStyle = (r) => {
    const props = [
      `style:font-name="${esc(r.font || "Arial")}"`, `fo:font-family="'${esc(r.font || "Arial")}'"`,
      `fo:font-size="${(Math.round(r.size * 2) / 2).toFixed(1)}pt"`,
      r.bold ? `fo:font-weight="bold"` : "", r.italic ? `fo:font-style="italic"` : "",
      `fo:color="#${hex(r.color || [0, 0, 0])}"`,
    ].filter(Boolean).join(" ");
    if (!tStyles.has(props)) tStyles.set(props, `T${tStyles.size + 1}`);
    return tStyles.get(props);
  };
  const fonts = new Set(["Arial"]);
  const addPic = (img) => {
    const name = `Pictures/image${pics.length + 1}.${extOf(img.mime)}`;
    pics.push({ name, data: img.data, mime: img.mime });
    return name;
  };
  let frameId = 1;
  const cellStyles = new Map();
  const cellStyle = (border, shade) => {
    const key = border + "|" + (shade ? hex(shade) : "");
    if (!cellStyles.has(key)) cellStyles.set(key, { name: `Cell${cellStyles.size + 1}`, border, shade });
    return cellStyles.get(key).name;
  };

  const frame = (img, maxW) => {
    let w = img.wPt, h = img.hPt;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    const href = addPic(img);
    return `<draw:frame draw:style-name="frImg" draw:name="Image${frameId++}" text:anchor-type="as-char" svg:width="${cm(w)}" svg:height="${cm(h)}" draw:z-index="1"><draw:image xlink:href="${href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  };

  function blocksXml(blocks, width, pageBreak = false) {
    let out = "";
    blocks.forEach((b, idx) => {
      const brk = idx === 0 && pageBreak;
      if (b.kind === "p") {
        const runs = b.runs.map((r) => { fonts.add(r.font || "Arial"); return `<text:span text:style-name="${tStyle(r)}">${textXml(r.text)}</text:span>`; }).join("");
        out += `<text:p text:style-name="${pStyle(b, brk)}">${runs}</text:p>`;
      } else if (b.kind === "img") {
        out += `<text:p text:style-name="${pStyle({ ...b, lineRatio: 1 }, brk)}">${frame(b, width - (b.indent || 0))}</text:p>`;
      } else if (b.kind === "cols") {
        const tname = `Tab${tableStyles.length + 1}`;
        const total = b.cols.reduce((s, c) => s + c.width, 0) || width;
        const k = Math.min(1, width / total);
        const ws = b.cols.map((c) => c.width * k);
        tableStyles.push({ tname, width: ws.reduce((a, v) => a + v, 0), cols: ws, brk, before: b.spaceBefore || 0, indent: b.indent || 0 });
        let t = `<table:table table:name="${tname}" table:style-name="${tname}">`;
        ws.forEach((_, i) => { t += `<table:table-column table:style-name="${tname}.C${i + 1}"/>`; });
        t += `<table:table-row>`;
        b.cols.forEach((c, i) => {
          let inner = blocksXml(c.blocks, ws[i] - 6);
          if (!inner) inner = `<text:p/>`;
          t += `<table:table-cell table:style-name="CellNoBorder" office:value-type="string">${inner}</table:table-cell>`;
        });
        out += t + `</table:table-row></table:table>`;
      } else if (b.kind === "table") {
        const tname = `Tab${tableStyles.length + 1}`;
        const total = b.colWidths.reduce((a, v) => a + v, 0) || width;
        const k = Math.min(1, (width - (b.indent || 0)) / total);
        const ws = b.colWidths.map((w) => w * k);
        tableStyles.push({ tname, width: ws.reduce((a, v) => a + v, 0), cols: ws, brk, before: b.spaceBefore || 0, indent: b.indent || 0 });
        const border = `${b.border.width.toFixed(2)}pt solid #${hex(b.border.color)}`;
        let t = `<table:table table:name="${tname}" table:style-name="${tname}">`;
        ws.forEach((_, i) => { t += `<table:table-column table:style-name="${tname}.C${i + 1}"/>`; });
        b.rows.forEach((row) => {
          t += `<table:table-row>`;
          let ci = 0;
          row.cells.forEach((cell) => {
            const w = ws.slice(ci, ci + cell.span).reduce((a, v) => a + v, 0);
            ci += cell.span;
            const cs = cellStyle(border, cell.shade);
            let inner = blocksXml(cell.blocks, w - 8);
            if (!inner) inner = `<text:p/>`;
            t += `<table:table-cell table:style-name="${cs}" office:value-type="string"${cell.span > 1 ? ` table:number-columns-spanned="${cell.span}"` : ""}>${inner}</table:table-cell>`;
            for (let i = 1; i < cell.span; i++) t += `<table:covered-table-cell/>`;
          });
          t += `</table:table-row>`;
        });
        out += t + `</table:table>`;
      }
    });
    if (!blocks.length && pageBreak) out += `<text:p text:style-name="${pStyle({}, true)}"/>`;
    return out;
  }

  const m = model.margins;
  const contentW = model.pageW - m.l - m.r;
  let body = "", backgrounds = "";
  model.pages.forEach((page, pi) => {
    if (page.background) {
      const bg = page.background, href = addPic(bg);
      backgrounds += `<draw:frame draw:style-name="frBg" draw:name="Fond${pi + 1}" text:anchor-type="page" text:anchor-page-number="${pi + 1}" svg:x="${cm(bg.bbox.x)}" svg:y="${cm(bg.bbox.y)}" svg:width="${cm(bg.bbox.r - bg.bbox.x)}" svg:height="${cm(bg.bbox.b - bg.bbox.y)}" draw:z-index="0"><draw:image xlink:href="${href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
    }
    body += blocksXml(page.blocks, contentW, pi > 0);
  });

  const auto = [
    ...[...pStyles].map(([props, name]) => `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties ${props.split(" ").filter((p) => !p.startsWith("fo:font")).join(" ")}/></style:style>`),
    ...[...tStyles].map(([props, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`),
    ...tableStyles.map((t) => `<style:style style:name="${t.tname}" style:family="table"><style:table-properties style:width="${cm(t.width)}" table:align="left" table:border-model="collapsing" fo:margin-left="${cm(t.indent)}" fo:margin-top="${cm(t.before)}" ${t.brk ? 'fo:break-before="page"' : ""}/></style:style>` +
      t.cols.map((w, i) => `<style:style style:name="${t.tname}.C${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${cm(w)}"/></style:style>`).join("")),
    ...[...cellStyles.values()].map((c) => `<style:style style:name="${c.name}" style:family="table-cell"><style:table-cell-properties fo:padding-left="0.09cm" fo:padding-right="0.09cm" fo:padding-top="0.03cm" fo:padding-bottom="0.03cm" fo:border="${c.border}"${c.shade ? ` fo:background-color="#${hex(c.shade)}"` : ""}/></style:style>`),
    `<style:style style:name="CellNoBorder" style:family="table-cell"><style:table-cell-properties fo:padding="0.05cm" fo:border="none"/></style:style>`,
    `<style:style style:name="frImg" style:family="graphic"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:border="none" style:wrap="none"/></style:style>`,
    `<style:style style:name="frBg" style:family="graphic"><style:graphic-properties style:wrap="run-through" style:run-through="background" style:horizontal-pos="from-left" style:horizontal-rel="page" style:vertical-pos="from-top" style:vertical-rel="page" fo:border="none"/></style:style>`,
  ].join("");
  const fontDecls = [...fonts].map((f) => `<style:font-face style:name="${esc(f)}" svg:font-family="'${esc(f)}'"/>`).join("");

  const NS = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2"><office:font-face-decls>${fontDecls}</office:font-face-decls><office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${backgrounds}${body}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.2"><office:font-face-decls><style:font-face style:name="Arial" svg:font-family="Arial"/></office:font-face-decls><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm"/><style:text-properties style:font-name="Arial" fo:font-size="11pt" fo:language="fr" fo:country="FR"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"/></office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${cm(model.pageW)}" fo:page-height="${cm(model.pageH)}" style:print-orientation="${model.pageW > model.pageH ? "landscape" : "portrait"}" fo:margin-top="${cm(m.t)}" fo:margin-bottom="${cm(m.b)}" fo:margin-left="${cm(m.l)}" fo:margin-right="${cm(m.r)}"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`;

  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file("META-INF/manifest.xml", `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pics.map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${p.mime}"/>`).join("")}</manifest:manifest>`);
  zip.file("meta.xml", `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.2"><office:meta><meta:generator>Yonk's PDF Converter</meta:generator><dc:title>${esc(model.title || "Document converti")}</dc:title></office:meta></office:document-meta>`);
  zip.file("styles.xml", styles);
  zip.file("content.xml", content);
  pics.forEach((p) => zip.file(p.name, p.data));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.oasis.opendocument.text" });
}

function textXml(t) {
  // espaces multiples et tabulations doivent être balisés en ODF
  return esc(t).replace(/\t/g, "<text:tab/>").replace(/ {2,}/g, (s) => ` <text:s text:c="${s.length - 1}"/>`);
}
