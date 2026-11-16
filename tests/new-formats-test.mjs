// Test de bout en bout (vrai Chrome) des nouvelles conversions bidirectionnelles :
// DOCX/ODT/RTF/DOC/TXT/HTML/MHTML -> PDF/TXT/HTML/DOCX/ODT/RTF, et PDF -> HTML/TXT.
// Usage : npm run build && node tests/new-formats-test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import puppeteer from "puppeteer-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fx = path.join(root, "tests", "fixtures-in");
const out = path.join(root, "tests", "output-new");
fs.mkdirSync(out, { recursive: true });

const chrome = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));
if (!chrome) { console.error("Chrome introuvable : définissez CHROME_PATH"); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", async (m) => {
  if (m.type() !== "error") return;
  const parts = await Promise.all(m.args().map((a) => a.evaluate((v) => (v && v.message) || String(v)).catch(() => m.text())));
  pageErrors.push(parts.join(" "));
});
await page.goto(pathToFileURL(path.join(root, "dist", "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => !!(window.__yonks && window.__yonks.convertAny), { polling: 200 });

let failures = 0, passed = 0;
function b64(buf) { return Buffer.from(buf).toString("base64"); }

async function run(name, fmt, { resources } = {}) {
  const filePath = path.join(fx, name);
  const bytes = fs.readFileSync(filePath);
  let resourcesB64;
  if (resources) {
    resourcesB64 = {};
    for (const r of resources) resourcesB64[r] = b64(fs.readFileSync(path.join(fx, "page-web_files", r)));
  }
  const label = `${name} -> .${fmt}`;
  try {
    const res = await page.evaluate(async (bytesB64, name, fmt, resourcesB64) => {
      try {
        const r = await window.__yonks.convertAny(bytesB64, name, fmt, undefined, resourcesB64);
        return { ok: true, len: r.b64 ? atob(r.b64).length : 0, b64: r.b64, warnings: r.warnings, text: r.text };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }, b64(bytes), name, fmt, resourcesB64);
    if (!res.ok || !res.len) { console.log(`ÉCHEC ${label} : ${res.error || "sortie vide"}`); failures++; return null; }
    const outBuf = Buffer.from(res.b64, "base64");
    const outName = name.replace(/\./g, "_") + "__to__" + fmt + "." + fmt;
    fs.writeFileSync(path.join(out, outName), outBuf);
    console.log(`OK    ${label} (${outBuf.length} o)${res.warnings && res.warnings.length ? " · " + res.warnings.length + " avertissement(s)" : ""}`);
    passed++;
    return { buf: outBuf, text: res.text };
  } catch (e) { console.log(`ÉCHEC ${label} : ${e.message}`); failures++; return null; }
}

function expectMagic(buf, magic, label) {
  const head = buf.subarray(0, magic.length).toString("latin1");
  if (head !== magic) { console.log(`ÉCHEC   signature attendue "${magic}" pour ${label}, trouvé "${head}"`); failures++; }
  else { console.log(`  ok    signature ${label}`); }
}

console.log("=== DOCX, ODT, RTF, DOC, TXT -> PDF / TXT / HTML ===");
for (const name of ["rapport.docx", "rapport.odt", "rapport.rtf", "rapport.doc", "notes.txt", "notes-ansi.txt"]) {
  const pdf = await run(name, "pdf");
  if (pdf) expectMagic(pdf.buf, "%PDF", name + " -> pdf");
  const html = await run(name, "html");
  if (html) { const s = html.buf.toString("utf8"); if (!/<html/i.test(s)) { console.log("ÉCHEC   contenu HTML invalide pour " + name); failures++; } }
  const txt = await run(name, "txt");
  if (txt && name.startsWith("rapport")) {
    if (!/Rapport de test/.test(txt.text || "")) { console.log("ÉCHEC   texte attendu absent pour " + name); failures++; }
    else console.log("  ok    texte visible correct pour " + name);
  }
}

console.log("\n=== DOCX -> ODT / RTF (chaîne via PDF) ===");
const docxToOdt = await run("rapport.docx", "odt");
if (docxToOdt) expectMagic(docxToOdt.buf, "PK", "rapport.docx -> odt");
const docxToRtf = await run("rapport.docx", "rtf");
if (docxToRtf) { if (!docxToRtf.buf.toString("latin1").startsWith("{\\rtf")) { console.log("ÉCHEC   signature RTF"); failures++; } else console.log("  ok    signature rapport.docx -> rtf"); }

console.log("\n=== Page web (HTML + ressources) -> TXT (texte visible, jamais le code source) ===");
const htmlTxt = await run("page-web.html", "txt", { resources: ["style.css", "photo.png"] });
if (htmlTxt) {
  const t = htmlTxt.text || "";
  const hiddenStrings = ["CODE SOURCE INVISIBLE", "TEXTE MASQUÉ PAR CSS", "TEXTE INVISIBLE", "MESSAGE NOSCRIPT"];
  const visibleStrings = ["Actualités du laboratoire", "Une conversion fidèle", "visible à l'écran"];
  let ok = true;
  for (const h of hiddenStrings) if (t.includes(h)) { console.log(`ÉCHEC   le texte caché "${h}" a été extrait à tort`); ok = false; failures++; }
  for (const v of visibleStrings) if (!t.includes(v)) { console.log(`ÉCHEC   le texte visible "${v}" est absent`); ok = false; failures++; }
  if (ok) { console.log("  ok    seul le texte visible est extrait (textes cachés absents)"); passed++; }
}
await run("page-web.html", "pdf", { resources: ["style.css", "photo.png"] });
await run("page-web.html", "html", { resources: ["style.css", "photo.png"] });
await run("page-web.mhtml", "txt");
await run("page-web.mhtml", "pdf");

console.log("\n=== PDF -> HTML / TXT ===");
const pdfBytes = fs.readFileSync(path.join(fx, "rapport.ref.pdf"));
{
  const res = await page.evaluate(async (bytesB64) => {
    try { const r = await window.__yonks.convertAny(bytesB64, "rapport.ref.pdf", "html"); return { ok: true, b64: r.b64 }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, b64(pdfBytes));
  if (res.ok) { console.log("OK    rapport.ref.pdf -> .html (" + Buffer.from(res.b64, "base64").length + " o)"); passed++; fs.writeFileSync(path.join(out, "rapport__to__html.html"), Buffer.from(res.b64, "base64")); }
  else { console.log("ÉCHEC rapport.ref.pdf -> .html : " + res.error); failures++; }
}
{
  const res = await page.evaluate(async (bytesB64) => {
    try { const r = await window.__yonks.convertAny(bytesB64, "rapport.ref.pdf", "txt"); return { ok: true, text: r.text }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }, b64(pdfBytes));
  if (res.ok && /Rapport de test/.test(res.text || "")) { console.log("OK    rapport.ref.pdf -> .txt (texte correct)"); passed++; }
  else { console.log("ÉCHEC rapport.ref.pdf -> .txt : " + (res.error || "texte attendu absent")); failures++; }
}

console.log(`\n${passed} test(s) réussi(s), ${failures} échec(s).`);
if (pageErrors.length) { console.log("\nErreurs JS de la page :"); pageErrors.slice(0, 20).forEach((e) => console.log("  " + e)); }
await browser.close();
process.exit(failures > 0 ? 1 : 0);
