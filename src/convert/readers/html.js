// Pages web : fichier .html (avec, éventuellement, son dossier de ressources « _files »)
// et archive .mhtml (« Enregistrer la page, un seul fichier » de Chrome / Edge).
import { decodeText } from "../detect.js";

/**
 * Nettoie le HTML pour un affichage sûr et statique :
 * scripts, cadres, objets, redirections et gestionnaires d'événements retirés ;
 * images « paresseuses » chargées tout de suite ; adresses réécrites vers les ressources fournies.
 */
export function sanitizeHtml(html, { resolve, baseUrl } = {}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, noscript, iframe, frame, frameset, object, embed, applet, base, template, portal, meta[http-equiv]").forEach((e) => e.remove());
  doc.querySelectorAll('link:not([rel~="stylesheet"])').forEach((e) => e.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "srcdoc" || n === "nonce" || n === "integrity") el.removeAttribute(a.name);
      else if (/^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  }
  for (const img of doc.querySelectorAll("img")) {
    const lazy = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
    const src = img.getAttribute("src") || "";
    if (lazy && (!src || /^data:image\/(gif|svg)/i.test(src) || /placeholder|blank|spacer|lazy/i.test(src))) img.setAttribute("src", lazy);
    const lazySet = img.getAttribute("data-srcset");
    if (lazySet && !img.getAttribute("srcset")) img.setAttribute("srcset", lazySet);
    img.removeAttribute("loading");
  }
  doc.querySelectorAll("source[data-srcset]").forEach((s) => { if (!s.getAttribute("srcset")) s.setAttribute("srcset", s.getAttribute("data-srcset")); });

  if (resolve) {
    const fix = (u) => (u ? resolve(u.trim(), baseUrl) || u : u);
    for (const el of doc.querySelectorAll("[src], [href], [poster], [data]")) {
      for (const attr of ["src", "href", "poster"]) {
        if (el.hasAttribute(attr) && !(attr === "href" && el.tagName === "A")) el.setAttribute(attr, fix(el.getAttribute(attr)));
      }
    }
    for (const el of doc.querySelectorAll("[srcset]")) {
      el.setAttribute("srcset", el.getAttribute("srcset").split(",").map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return [fix(u), ...rest].join(" ");
      }).join(", "));
    }
    for (const el of doc.querySelectorAll("[style]")) el.setAttribute("style", rewriteCssUrls(el.getAttribute("style"), (u) => fix(u)));
    for (const st of doc.querySelectorAll("style")) st.textContent = rewriteCssUrls(st.textContent, (u) => fix(u));
  }
  // liens : ouverture dans le navigateur, adresses absolues
  if (baseUrl) {
    for (const a of doc.querySelectorAll("a[href]")) {
      try { a.setAttribute("href", new URL(a.getAttribute("href"), baseUrl).href); } catch (e) { /* adresse invalide */ }
    }
  }
  const dt = doc.doctype ? "<!doctype html>\n" : "<!doctype html>\n";
  return { html: dt + doc.documentElement.outerHTML, title: (doc.title || "").trim() };
}

export function rewriteCssUrls(css, fn) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url("${fn(u) || u}")`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import "${fn(u) || u}"`);
}

const basename = (u) => {
  try { u = decodeURIComponent(u); } catch (e) { /* tel quel */ }
  return u.split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();
};

const MIME_BY_EXT = { css: "text/css", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
function toDataUri(bytes, mime) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Fichier .html + ressources éventuelles { nom de fichier -> File/Blob }.
 * Les ressources sont intégrées en data URI (et non en blob:), afin que le HTML produit reste
 * valide une fois enregistré et rouvert dans n'importe quel navigateur, indépendamment de cette page.
 */
export async function readHtml(bytes, resources = new Map()) {
  const raw = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const m = raw.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i);
  const text = decodeText(bytes, m && m[1]);
  const urls = new Map();
  const cssFixed = new Map();
  const uriFor = async (name) => {
    if (urls.has(name)) return urls.get(name);
    const f = resources.get(name);
    if (!f) return null;
    const ext = (name.split(".").pop() || "").toLowerCase();
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    if (ext === "css") {
      const css = rewriteCssUrls(decodeText(new Uint8Array(await f.arrayBuffer())), (u) => (resources.has(basename(u)) ? `__RES__${basename(u)}` : null));
      cssFixed.set(name, css);
      return null;
    }
    const uri = toDataUri(new Uint8Array(await f.arrayBuffer()), mime);
    urls.set(name, uri);
    return uri;
  };
  for (const name of resources.keys()) await uriFor(name);
  for (const [name, css] of cssFixed) {
    const finalCss = css.replace(/__RES__([^"')\s]+)/g, (mm, n) => urls.get(n) || n);
    urls.set(name, `data:text/css;base64,${btoa(unescape(encodeURIComponent(finalCss)))}`);
  }
  const resolve = (u) => {
    if (!u || /^(data|blob|https?|mailto|tel|#)/i.test(u)) return null;
    const b = basename(u);
    return urls.get(b) || null;
  };
  const out = sanitizeHtml(text, { resolve });
  out.revoke = () => {};
  out.resourcesUsed = urls.size;
  return out;
}

// ---------------------------------------------------------------- MHTML
function decodeQP(str) {
  const s = str.replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function parseHeaders(block) {
  const h = {};
  block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  });
  return h;
}

export async function readMhtml(bytes) {
  const all = new TextDecoder("latin1").decode(bytes);
  const sep = all.search(/\r?\n\r?\n/);
  const top = parseHeaders(all.slice(0, sep));
  const bm = (top["content-type"] || "").match(/boundary="?([^";]+)"?/i);
  if (!bm) throw new Error("Archive MHTML illisible (séparateur introuvable).");
  const boundary = "--" + bm[1];
  const base = top["snapshot-content-location"] || top["content-location"] || "";
  const parts = all.split(boundary).slice(1).filter((p) => !p.startsWith("--"));
  const resources = [];
  let main = null;
  for (const p of parts) {
    const body = p.replace(/^\r?\n/, "");
    const i = body.search(/\r?\n\r?\n/);
    if (i < 0) continue;
    const h = parseHeaders(body.slice(0, i));
    let data = body.slice(i).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
    const enc = (h["content-transfer-encoding"] || "").toLowerCase();
    let raw;
    if (enc === "base64") raw = Uint8Array.from(atob(data.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    else if (enc === "quoted-printable") raw = decodeQP(data);
    else raw = Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff);
    const type = (h["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const charset = ((h["content-type"] || "").match(/charset="?([\w-]+)/i) || [])[1];
    const part = { type, charset, raw, location: h["content-location"], cid: (h["content-id"] || "").replace(/[<>]/g, "") };
    if (!main && type === "text/html") main = part; else resources.push(part);
  }
  if (!main) throw new Error("Archive MHTML sans page HTML.");
  const urls = new Map();
  const key = (u, b) => { try { return new URL(u, b || base).href; } catch (e) { return u; } };
  // les CSS d'abord réécrites pour pointer vers les autres ressources (en data URI, pour un fichier autonome)
  for (const r of resources) if (r.type !== "text/css") {
    const u = toDataUri(r.raw, r.type);
    if (r.location) urls.set(key(r.location), u);
    if (r.cid) urls.set("cid:" + r.cid, u);
  }
  for (const r of resources) if (r.type === "text/css") {
    const css = rewriteCssUrls(decodeText(r.raw, r.charset), (u) => urls.get(key(u, r.location)) || urls.get(u) || null);
    const u = `data:text/css;base64,${btoa(unescape(encodeURIComponent(css)))}`;
    if (r.location) urls.set(key(r.location), u);
    if (r.cid) urls.set("cid:" + r.cid, u);
  }
  const html = decodeText(main.raw, main.charset);
  const out = sanitizeHtml(html, { baseUrl: main.location || base, resolve: (u, b) => urls.get(u) || urls.get(key(u, b)) || null });
  out.revoke = () => {};
  out.resourcesUsed = urls.size;
  return out;
}
