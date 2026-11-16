// Page de rendu invisible et isolée : le document à convertir y est affiché par le moteur du
// navigateur, puis lu (positions, styles, texte visible). Les scripts y sont désactivés
// (iframe « sandbox » sans allow-scripts) : un fichier HTML reçu ne peut rien exécuter.

export function createFrame(widthPx, heightPx = 1200) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, {
    position: "fixed", left: "-20000px", top: "0", width: `${widthPx}px`, height: `${heightPx}px`,
    border: "0", visibility: "hidden", pointerEvents: "none",
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  return {
    iframe, win: iframe.contentWindow,
    get doc() { return iframe.contentDocument; },
    write(html) {
      const d = iframe.contentDocument;
      d.open(); d.write(html); d.close();
      return d;
    },
    setWidth(w) { iframe.style.width = `${w}px`; },
    destroy() { iframe.remove(); },
    _initial: doc,
  };
}

/** Attend le chargement des images, feuilles de style et polices (avec un délai maximum). */
export async function settle(doc, timeoutMs = 12000) {
  const deadline = new Promise((r) => setTimeout(r, timeoutMs));
  const waits = [];
  for (const img of doc.images) {
    if (!img.complete) waits.push(new Promise((r) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }));
  }
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"]')) {
    if (!link.sheet) waits.push(new Promise((r) => { link.addEventListener("load", r, { once: true }); link.addEventListener("error", r, { once: true }); }));
  }
  if (doc.readyState !== "complete") waits.push(new Promise((r) => doc.defaultView.addEventListener("load", r, { once: true })));
  await Promise.race([Promise.all(waits), deadline]);
  try { await Promise.race([doc.fonts.ready, deadline]); } catch (e) { /* ignoré */ }
  await new Promise((r) => doc.defaultView.requestAnimationFrame(() => r()));
}
