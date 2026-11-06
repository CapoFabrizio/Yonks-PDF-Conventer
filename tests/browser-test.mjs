// Test de bout en bout dans un vrai Chrome (headless) :
//  1. ouvre dist/index.html (le build réel, en file://),
//  2. passe par l'interface (dépôt de fichier, clic sur Convertir, lien de téléchargement),
//  3. convertit chaque PDF de tests/fixtures dans tous les formats et les deux modes,
//  4. écrit les résultats dans tests/output/ pour validation par tests/validate.py.
//
// Usage : npm run build && npm test     (CHROME_PATH=/chemin/vers/chrome si besoin)
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import puppeteer from "puppeteer-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(root, "tests", "fixtures");
const out = path.join(root, "tests", "output");
fs.mkdirSync(out, { recursive: true });

const chrome = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
if (!chrome) { console.error("Chrome introuvable : définissez CHROME_PATH"); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", async (m) => {
  if (m.type() !== "error") return;
  const parts = await Promise.all(m.args().map((a) => a.evaluate((v) => (v && v.message) || String(v)).catch(() => m.text())));
  errors.push(parts.join(" "));
});
await page.goto(pathToFileURL(path.join(root, "dist", "index.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__yonks, { polling: 200 });

let failures = 0;
const pdfs = fs.readdirSync(fixtures).filter((f) => f.endsWith(".pdf")).sort();

// --- 1. Parcours utilisateur réel via l'interface ---
{
  const input = await page.$("#fileInput");
  await input.uploadFile(...pdfs.map((f) => path.join(fixtures, f)));
  await page.waitForFunction((n) => document.querySelectorAll("#fileList .file").length === n, { polling: 200 }, pdfs.length);
  await page.click("#convertBtn");
  // le PDF protégé ouvre la fenêtre de mot de passe intégrée : on y saisit « yonks »
  for (let t = 0; t < 600; t++) {
    const state = await page.evaluate(() => ({
      dialog: !!document.querySelector("#pwdDialog[open]"),
      done: [...document.querySelectorAll("#fileList .status")].every((s) => /Terminé|Échec/.test(s.textContent)),
    }));
    if (state.done) break;
    if (state.dialog) { await page.type("#pwdDialog input", "yonks"); await page.click("#pwdDialog button[type=submit]"); }
    await new Promise((r) => setTimeout(r, 500));
  }
  const statuses = await page.$$eval("#fileList .file", (els) => els.map((e) => ({ name: e.querySelector(".name").textContent, status: e.querySelector(".status").textContent, href: e.querySelector(".dl").href, dl: e.querySelector(".dl").download })));
  for (const s of statuses) {
    const ok = /Terminé/.test(s.status);
    if (!ok) failures++;
    console.log(`${ok ? "OK  " : "ÉCHEC"} [interface] ${s.name} -> ${s.dl} : ${s.status}`);
    if (ok) {
      const b64 = await page.evaluate(async (href) => { const b = await (await fetch(href)).arrayBuffer(); let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }, s.href);
      fs.writeFileSync(path.join(out, "ui_" + s.dl), Buffer.from(b64, "base64"));
    }
  }
  const zipVisible = await page.waitForFunction(() => !document.querySelector("#zipBtn").hidden, { polling: 200, timeout: 10000 }).then(() => true, () => false);
  console.log(`${zipVisible ? "OK  " : "ÉCHEC"} [interface] bouton « Tout télécharger (.zip) » visible`);
  if (!zipVisible) failures++;
}

// --- 2. Tous formats × modes via le moteur embarqué dans la page ---
for (const f of pdfs) {
  const b64 = fs.readFileSync(path.join(fixtures, f)).toString("base64");
  for (const mode of ["editable", "exact"]) {
    for (const fmt of ["docx", "odt", "rtf", "doc", "txt"]) {
      if (mode === "exact" && fmt === "txt") continue;
      const t0 = Date.now();
      try {
        const pwd = f.startsWith("protege") ? "yonks" : undefined;
        const r = await page.evaluate((b, fm, md, pw) => window.__yonks.convert(b, fm, md, pw), b64, fmt, mode, pwd);
        const name = `${f.replace(/\.pdf$/, "")}.${mode}.${fmt}`;
        fs.writeFileSync(path.join(out, name), Buffer.from(r.b64, "base64"));
        console.log(`OK   ${name.padEnd(42)} ${String(Date.now() - t0).padStart(5)} ms  ${JSON.stringify(r.stats)}${r.warnings.length ? " " + r.warnings.join(";") : ""}`);
      } catch (e) {
        failures++;
        console.log(`ÉCHEC ${f} ${mode} ${fmt}: ${e.message}`);
      }
    }
  }
}

await browser.close();
const realErrors = errors.filter((e) => !/standard font|fetchStandardFontData|Failed to load resource/i.test(e));
if (realErrors.length) { console.log("Erreurs JavaScript :\n" + realErrors.join("\n")); failures += realErrors.length; }
console.log(failures ? `\n${failures} échec(s)` : "\nTous les tests navigateur sont passés.");
process.exit(failures ? 1 : 0);
