// Lecteur DOCX : s'appuie sur docx-preview (Apache-2.0) pour obtenir un rendu HTML fidèle
// (styles, tableaux, images, en-têtes/pieds, sections) directement depuis le fichier .docx,
// sans réimplémenter le format OOXML.
import { renderAsync } from "docx-preview";
import { A4, PX, escapeHtml } from "./common.js";

function emuOrPxToPt(val) {
  // docx-preview expose les dimensions de section déjà converties en pouces (string "8.5in") ou en px
  if (val == null) return null;
  if (typeof val === "number") return val * PX; // px -> pt
  const m = String(val).match(/^(-?[\d.]+)(in|cm|mm|pt|px)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const factor = { in: 72, cm: 28.3465, mm: 2.83465, pt: 1, px: PX }[m[2] || "px"];
  return n * factor;
}

export async function readDocx(bytes, title) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  document.body.appendChild(container);
  let result;
  try {
    result = await renderAsync(bytes.buffer ? bytes : bytes.slice ? bytes : bytes, container, null, {
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
      experimental: true,
      trimXmlDeclaration: true,
      renderChanges: false,
      renderComments: false,
    });
  } catch (e) {
    container.remove();
    if (/password|encrypt/i.test(String(e && e.message))) throw new Error("Ce document Word est protégé par un mot de passe : ouvrez-le dans Word, retirez la protection, puis réessayez.");
    throw new Error("Fichier .docx illisible : " + (e && e.message ? e.message : e));
  }

  const warnings = [];
  // docx-preview dépose aussi des <style> dans le même conteneur : on cible le wrapper par classe
  const wrapper = container.querySelector(":scope > .docx-wrapper");
  const sections = wrapper ? [...wrapper.querySelectorAll(":scope > section.docx")] : [];
  if (!sections.length) { container.remove(); throw new Error("Fichier .docx illisible (aucune section trouvée)."); }

  // Dimensions de page lues sur la première section (docx-preview les fixe en style inline, en px au 96 dpi)
  const firstStyle = sections[0].style;
  const pagePx = { w: parseFloat(firstStyle.width) || 816, h: parseFloat(firstStyle.height) || 1056 };
  const padT = parseFloat(firstStyle.paddingTop) || 72, padR = parseFloat(firstStyle.paddingRight) || 72;
  const padB = parseFloat(firstStyle.paddingBottom) || 72, padL = parseFloat(firstStyle.paddingLeft) || 72;
  const page = {
    w: pagePx.w * PX, h: pagePx.h * PX,
    margins: { t: padT * PX, r: padR * PX, b: padB * PX, l: padL * PX },
  };

  // On assemble un document unique : en-tête (de la 1re section) + tout le texte + pied (de la dernière)
  let bodyHtml = "";
  sections.forEach((section, idx) => {
    if (idx > 0) bodyHtml += '<div class="page-break"></div>';
    const header = section.querySelector(":scope > header");
    const footer = section.querySelector(":scope > footer");
    const article = section.querySelector(":scope > article");
    if (header && idx === 0) bodyHtml += `<div class="docx-header">${header.innerHTML}</div>`;
    if (article) bodyHtml += article.innerHTML;
    if (footer && idx === sections.length - 1) bodyHtml += `<div class="docx-footer">${footer.innerHTML}</div>`;
  });

  // styles globaux injectés par docx-preview (polices, classes de style Word) : on les récupère pour les reporter
  const styleEls = [...document.head.querySelectorAll('style[data-docx], style[class*="docx"]')];
  const headCss = [...container.querySelectorAll("style")].map((s) => s.textContent).join("\n");

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
html { background: #fff; }
body { margin: 0; color: #000; }
.docx-wrapper, .docx { background: transparent !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
section.docx { width: auto !important; min-height: 0 !important; height: auto !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
.docx-header, .docx-footer { font-size: 0.9em; opacity: 0.85; }
.page-break { break-before: page; height: 0; }
${headCss}
</style></head><body><div style="width:${(page.w - page.margins.l - page.margins.r) / PX}px">${bodyHtml}</div></body></html>`;

  container.remove();
  return { html, title: title || "", page, warnings };
}
