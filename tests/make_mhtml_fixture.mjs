// Régénère tests/fixtures-in/page-web.mhtml : une vraie archive MHTML produite par Chrome,
// comme le ferait un utilisateur avec « Enregistrer sous… > Page web, un seul fichier ».
// Usage : CHROME_PATH=/usr/bin/google-chrome node tests/make_mhtml_fixture.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import puppeteer from "puppeteer-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chrome = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));
if (!chrome) { console.error("Chrome introuvable : définissez CHROME_PATH"); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, "tests/fixtures-in/page-web.html")).href, { waitUntil: "load" });
const cdp = await page.createCDPSession();
const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
const out = path.join(root, "tests/fixtures-in/page-web.mhtml");
fs.writeFileSync(out, data);
console.log(`${out} (${data.length} octets)`);
await browser.close();
