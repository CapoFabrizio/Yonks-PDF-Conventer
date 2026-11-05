// Écriture DOCX (Office Open XML) — fichier Word natif.
import JSZip from "jszip";
import { esc, hex, extOf } from "./util.js";

const EMU = 12700;      // EMU par point
const TW = 20;          // twips par point

export async function writeDocx(model) {
  const zip = new JSZip();
  const media = [];
  let docPrId = 1;
  const addMedia = (img) => {
    const n = media.length + 1;
    const name = `image${n}.${extOf(img.mime)}`;
    media.push({ name, data: img.data, rel: `rIdImg${n}` });
    return `rIdImg${n}`;
  };

  const sizes = collectSizes(model);
  const pW = Math.round(model.pageW * TW), pH = Math.round(model.pageH * TW);
  const m = model.margins;
  const contentW = Math.round((model.pageW - m.l - m.r) * TW);

  const graphic = (rel, cx, cy, id) => `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;

  const inlineImage = (img) => {
    const rel = addMedia(img), id = docPrId++;
    const cx = Math.max(1, Math.round(img.wPt * EMU)), cy = Math.max(1, Math.round(img.hPt * EMU));
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Image ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic(rel, cx, cy, id)}</wp:inline></w:drawing></w:r>`;
  };

  const backgroundImage = (bg) => {
    const rel = addMedia(bg), id = docPrId++;
    const x = Math.round(bg.bbox.x * EMU), y = Math.round(bg.bbox.y * EMU);
    const cx = Math.round((bg.bbox.r - bg.bbox.x) * EMU), cy = Math.round((bg.bbox.b - bg.bbox.y) * EMU);
    return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Fond ${id}"/><wp:cNvGraphicFramePr/>${graphic(rel, cx, cy, id)}</wp:anchor></w:drawing></w:r>`;
  };

  const runXml = (r) => {
    const sz = Math.max(2, Math.round(r.size * 2));
    const font = esc(r.font || "Arial");
    const color = hex(r.color || [0, 0, 0]);
    const parts = esc(r.text).split("\t");
    const body = parts.map((t, i) => (i ? "<w:tab/>" : "") + `<w:t xml:space="preserve">${t}</w:t>`).join("");
    return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>${r.bold ? "<w:b/><w:bCs/>" : ""}${r.italic ? "<w:i/><w:iCs/>" : ""}${color !== "000000" ? `<w:color w:val="${color}"/>` : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>${body}</w:r>`;
  };

  // L'ordre des éléments de w:pPr est imposé par le schéma (Word refuse sinon).
  const pPr = (b, pageBreak) => {
    const jc = { left: "left", center: "center", right: "right", justify: "both" }[b.align || "left"];
    const before = Math.round((b.spaceBefore || 0) * TW);
    const line = b.lineRatio ? Math.round(240 * b.lineRatio) : 240;
    const ind = b.indent || 0, fl = b.firstLine || 0;
    let indXml = "";
    if (ind > 0.5 || Math.abs(fl) > 0.5) {
      indXml = fl >= 0
        ? `<w:ind w:left="${Math.round(ind * TW)}" w:firstLine="${Math.round(fl * TW)}"/>`
        : `<w:ind w:left="${Math.round(ind * TW)}" w:hanging="${Math.round(-fl * TW)}"/>`;
    }
    const outline = b.heading ? `<w:outlineLvl w:val="${headingLevel(b.size, sizes)}"/>` : "";
    const shd = b.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(b.shade)}"/>` : "";
    // bordures de la couleur du fond = marge intérieure colorée (bandeaux de titre)
    const pad = b.shade && b.shadePad ? Math.round(b.shadePad) : 0;
    const bdr = pad ? `<w:pBdr>${["top", "left", "bottom", "right"].map((sd) => `<w:${sd} w:val="single" w:sz="4" w:space="${sd === "top" || sd === "bottom" ? pad : 4}" w:color="${hex(b.shade)}"/>`).join("")}</w:pBdr>` : "";
    return `<w:pPr>${b.heading ? "<w:keepNext/>" : ""}${pageBreak ? "<w:pageBreakBefore/>" : ""}${bdr}${shd}<w:spacing w:before="${before}" w:after="0" w:line="${line}" w:lineRule="auto"/>${indXml}<w:jc w:val="${jc}"/>${outline}</w:pPr>`;
  };

  const emptyPara = (pageBreak = false, beforePt = 0, content = "") =>
    `<w:p><w:pPr>${pageBreak ? "<w:pageBreakBefore/>" : ""}<w:spacing w:before="${Math.round(beforePt * TW)}" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${content}</w:p>`;

  function blocksXml(blocks, width, pageBreak = false, firstContent = "") {
    let out = "", lastWasTable = false;
    blocks.forEach((b, idx) => {
      const brk = idx === 0 && pageBreak;
      const content = idx === 0 ? firstContent : "";
      if (b.kind === "p") {
        out += `<w:p>${pPr(b, brk)}${content}${b.runs.map(runXml).join("")}</w:p>`;
        lastWasTable = false;
      } else if (b.kind === "img") {
        const img = { ...b };
        const maxW = width - (b.indent || 0);
        if (img.wPt > maxW) { img.hPt *= maxW / img.wPt; img.wPt = maxW; }
        out += `<w:p>${pPr({ ...b, lineRatio: 1, heading: false }, brk)}${content}${inlineImage(img)}</w:p>`;
        lastWasTable = false;
      } else if (b.kind === "cols" || b.kind === "table") {
        // paragraphe porteur : saut de page, espacement avant, et séparation entre deux tableaux
        if (brk || content || lastWasTable || (b.spaceBefore || 0) > 2) out += emptyPara(brk, b.spaceBefore || 0, content);
        out += b.kind === "cols" ? tableXml(b, width) : gridTableXml(b, width);
        lastWasTable = true;
      }
    });
    if (!blocks.length && (pageBreak || firstContent)) out += emptyPara(pageBreak, 0, firstContent);
    return out;
  }

  function tableXml(b, width) {
    const total = b.cols.reduce((s, c) => s + c.width, 0) || width;
    const k = Math.min(1, width / total);
    const ws = b.cols.map((c) => Math.max(200, Math.round(c.width * k * TW)));
    const sum = ws.reduce((a, v) => a + v, 0);
    const none = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="nil"/>`).join("");
    let x = `<w:tbl><w:tblPr><w:tblW w:w="${sum}" w:type="dxa"/>${b.indent > 0.5 ? `<w:tblInd w:w="${Math.round(b.indent * TW)}" w:type="dxa"/>` : ""}<w:tblBorders>${none}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid><w:tr>`;
    b.cols.forEach((c, i) => {
      let inner = blocksXml(c.blocks, ws[i] / TW - 6);
      if (!inner.endsWith("</w:p>")) inner += emptyPara();
      x += `<w:tc><w:tcPr><w:tcW w:w="${ws[i]}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
    });
    return x + "</w:tr></w:tbl>";
  }

  // Vrai tableau Word (bordures, fusions horizontales, fonds de cellule).
  function gridTableXml(b, width) {
    const total = b.colWidths.reduce((a, v) => a + v, 0) || width;
    const k = Math.min(1, (width - (b.indent || 0)) / total);
    const ws = b.colWidths.map((w) => Math.max(120, Math.round(w * k * TW)));
    const sum = ws.reduce((a, v) => a + v, 0);
    const sz = Math.max(2, Math.min(48, Math.round(b.border.width * 8)));
    const col = hex(b.border.color);
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="${sz}" w:space="0" w:color="${col}"/>`).join("");
    let x = `<w:tbl><w:tblPr><w:tblW w:w="${sum}" w:type="dxa"/>${b.indent > 0.5 ? `<w:tblInd w:w="${Math.round(b.indent * TW)}" w:type="dxa"/>` : ""}<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="50" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="50" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    for (const row of b.rows) {
      x += `<w:tr><w:trPr><w:trHeight w:val="${Math.round(row.height * k * TW)}" w:hRule="atLeast"/></w:trPr>`;
      let ci = 0;
      for (const cell of row.cells) {
        const w = ws.slice(ci, ci + cell.span).reduce((a, v) => a + v, 0);
        ci += cell.span;
        let inner = blocksXml(cell.blocks, w / TW - 8);
        if (!inner.endsWith("</w:p>")) inner += `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
        x += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${cell.span > 1 ? `<w:gridSpan w:val="${cell.span}"/>` : ""}${cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(cell.shade)}"/>` : ""}</w:tcPr>${inner}</w:tc>`;
      }
      x += "</w:tr>";
    }
    return x + "</w:tbl>";
  }

  let body = "";
  model.pages.forEach((page, pi) => {
    const bg = page.background ? backgroundImage(page.background) : "";
    body += blocksXml(page.blocks, contentW / TW, pi > 0, bg);
  });
  body += emptyPara();

  const orient = model.pageW > model.pageH ? ` w:orient="landscape"` : "";
  const sect = `<w:sectPr><w:pgSz w:w="${pW}" w:h="${pH}"${orient}/><w:pgMar w:top="${Math.round(m.t * TW)}" w:right="${Math.round(m.r * TW)}" w:bottom="${Math.round(m.b * TW)}" w:left="${Math.round(m.l * TW)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sect}</w:body></w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

  const rels = media.map((x) => `<Relationship Id="${x.rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${x.name}"/>`).join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${rels}</Relationships>`);
  zip.file("word/document.xml", document);
  zip.file("word/styles.xml", styles);
  zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(model.title || "Document converti")}</dc:title><dc:creator>Yonk's PDF Converter</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Yonk's PDF Converter</Application></Properties>`);
  media.forEach((x) => zip.file(`word/media/${x.name}`, x.data));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function collectSizes(model) {
  const s = new Set();
  const walk = (bs) => bs.forEach((b) => { if (b.kind === "p" && b.heading) s.add(Math.round(b.size)); if (b.kind === "cols") b.cols.forEach((c) => walk(c.blocks)); });
  model.pages.forEach((p) => walk(p.blocks));
  return [...s].sort((a, b) => b - a);
}
function headingLevel(size, sizes) {
  const i = sizes.indexOf(Math.round(size));
  return Math.max(0, Math.min(8, i < 0 ? 2 : i));
}
