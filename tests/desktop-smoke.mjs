// Test de l'application PC : lance la vraie fenêtre Electron, vérifie l'interface, convertit les PDF
// de test (dont le PDF protégé via la fenêtre de mot de passe) et contrôle les fichiers produits.
//
// Usage : npm run build && npm run test:desktop
//         APP_PATH=chemin/vers/l'exécutable empaqueté pour tester une version packagée.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { _electron as electron } from "playwright-core";
import JSZip from "jszip";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(root, "tests", "fixtures");
const out = path.join(root, "tests", "output-desktop");
fs.mkdirSync(out, { recursive: true });

const downloads = path.join(out, "telechargements");
fs.mkdirSync(downloads, { recursive: true });
const launch = process.env.APP_PATH
  ? { executablePath: process.env.APP_PATH, args: ["--no-sandbox"] }
  : { args: ["--no-sandbox", root] };
const app = await electron.launch({ ...launch, timeout: 60000, env: { ...process.env, NODE_OPTIONS: "", YONKS_DOWNLOAD_DIR: downloads } });
let failures = 0;
const ok = (cond, label) => { process.stderr.write(`${new Date().toISOString().slice(11, 19)} `); console.error(`${cond ? "OK   " : "ÉCHEC"} ${label}`); if (!cond) failures++; };

try {
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(String(e)));
  await win.waitForFunction(() => !!window.__yonks, null, { timeout: 30000 });
  ok((await win.title()).includes("PDF Converter"), `titre de la fenêtre : ${await win.title()}`);
  ok((await win.evaluate(() => window.__yonks.platform)) === "desktop", "plateforme détectée : application PC");
  const isolated = await win.evaluate(() => typeof require === "undefined" && typeof process === "undefined");
  ok(isolated, "page isolée de Node.js (sécurité)");

  // Parcours par l'interface : ajout de deux PDF dont un protégé, mot de passe via la fenêtre intégrée.
  await win.setInputFiles("#fileInput", ["texte_images.pdf", "protege.pdf"].map((f) => path.join(fixtures, f)));
  await win.waitForFunction(() => document.querySelectorAll("#fileList .file").length === 2);
  await win.click("#convertBtn");
  await win.waitForSelector("#pwdDialog[open]", { timeout: 30000 });
  await win.fill("#pwdDialog input", "faux");
  await win.click("#pwdDialog button[type=submit]");
  await win.waitForSelector("#pwdDialog[open] .pwd-error:not([hidden])", { timeout: 15000 });
  ok(true, "mauvais mot de passe signalé dans la fenêtre");
  await win.fill("#pwdDialog input", "yonks");
  await win.click("#pwdDialog button[type=submit]");
  await win.waitForFunction(() => [...document.querySelectorAll("#fileList .status")].every((s) => /Terminé|Échec/.test(s.textContent)), null, { timeout: 120000 });
  const statuses = await win.$$eval("#fileList .status", (els) => els.map((e) => e.textContent));
  statuses.forEach((s, i) => ok(/Terminé/.test(s), `interface, fichier ${i + 1} : ${s}`));

  // Téléchargement : clic réel sur « Télécharger », le fichier doit arriver sur le disque.
  await win.click("#fileList .file .dl");
  const target = path.join(downloads, "texte_images.docx");
  for (let t = 0; t < 40 && !(fs.existsSync(target) && fs.statSync(target).size > 1000); t++) await new Promise((r) => setTimeout(r, 250));
  ok(fs.existsSync(target) && fs.statSync(target).size > 1000, `clic sur « Télécharger » : fichier enregistré (${fs.existsSync(target) ? fs.statSync(target).size + " octets" : "absent"})`);
  if (fs.existsSync(target)) {
    const z = await JSZip.loadAsync(fs.readFileSync(target));
    ok(!!z.file("word/document.xml") && Object.keys(z.files).some((n) => n.startsWith("word/media/")), "fichier téléchargé : document Word valide avec ses images");
  }

  // Moteur : chaque fixture en .docx, contrôle de la structure Word et des images.
  for (const f of fs.readdirSync(fixtures).filter((x) => x.endsWith(".pdf")).sort()) {
    const b64 = fs.readFileSync(path.join(fixtures, f)).toString("base64");
    const r = await win.evaluate(([b, pw]) => window.__yonks.convert(b, "docx", "editable", pw), [b64, f.startsWith("protege") ? "yonks" : undefined]);
    const bytes = Buffer.from(r.b64, "base64");
    fs.writeFileSync(path.join(out, f.replace(".pdf", ".docx")), bytes);
    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file("word/document.xml").async("string");
    const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/")).length;
    ok(docXml.includes("<w:body>") && bytes.length > 2000, `${f} -> .docx ${Math.round(bytes.length / 1024)} Ko, ${media} image(s), ${JSON.stringify(r.stats)}`);
  }

  // Lien externe : ne doit pas remplacer l'application dans la fenêtre.
  await win.evaluate(() => document.querySelector(".footer a").click());
  await new Promise((r) => setTimeout(r, 1500));
  ok(win.url().startsWith("file://"), "lien externe ouvert hors de l'application");

  await win.screenshot({ path: path.join(out, "fenetre-pc.png") });
  ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? " : " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++;
  console.error("ÉCHEC", e.message);
} finally {
  // le lien externe ouvert pendant le test lance un programme système qui peut retenir la fermeture
  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  try { proc.kill("SIGKILL"); } catch (e) { /* déjà fermé */ }
}
console.log(failures ? `\n${failures} échec(s)` : "\nApplication PC : tous les tests sont passés.");
process.exit(failures ? 1 : 0);
