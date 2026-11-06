import JSZip from "jszip";
import { pdfjs, env, docOptions } from "./env/browser.js";
import { convertPdf, FORMATS } from "./core/index.js";
import { isNative, platform, saveFile, shareFile, askPassword } from "./platform.js";

document.documentElement.dataset.platform = platform;

const $ = (s) => document.querySelector(s);
const dropzone = $("#dropzone"), fileInput = $("#fileInput"), list = $("#fileList");
const convertBtn = $("#convertBtn"), zipBtn = $("#zipBtn"), clearBtn = $("#clearBtn");

let format = "docx", mode = "editable", busy = false;
const jobs = []; // { id, file, bytes, el, password, result, url, settingsKey }

// ---------- options ----------
function radioGroup(container, attr, onChange) {
  container.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    container.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    onChange(b.dataset[attr]);
  }));
}
radioGroup($("#formatChips"), "format", (v) => { format = v; refresh(); });
radioGroup($("#modeSeg"), "mode", (v) => { mode = v; refresh(); });

// ---------- ajout de fichiers ----------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
["dragenter", "dragover"].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.remove("over"); }));
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { if (!dropzone.contains(e.target)) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

async function addFiles(fileList) {
  // copie immédiate : la FileList de l'input est vidée juste après l'appel
  const files = [...fileList];
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") continue;
    const el = $("#fileTpl").content.firstElementChild.cloneNode(true);
    const job = { id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()), file, el, bytes: null, password: undefined, result: null, url: null };
    el.querySelector(".name").textContent = file.name;
    el.querySelector(".info").textContent = humanSize(file.size);
    setStatus(job, "Prêt à convertir");
    el.querySelector(".rm").addEventListener("click", () => removeJob(job));
    el.querySelector(".dl").addEventListener("click", (e) => { if (isNative) { e.preventDefault(); saveJob(job); } });
    el.querySelector(".share").addEventListener("click", () => shareJob(job));
    list.appendChild(el);
    jobs.push(job);
    job.bytes = new Uint8Array(await file.arrayBuffer());
    preview(job);
  }
  refresh();
}

async function preview(job) {
  try {
    const doc = await openDoc(job, true);
    if (!doc) return;
    job.el.querySelector(".info").textContent = `${humanSize(job.file.size)} · ${doc.numPages} page${doc.numPages > 1 ? "s" : ""}`;
    const page = await doc.getPage(1);
    const canvas = job.el.querySelector(".thumb");
    const vp0 = page.getViewport({ scale: 1 });
    const scale = 144 / Math.max(vp0.width, vp0.height);
    const vp = page.getViewport({ scale });
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    job.previewed = true;
    await doc.destroy();
  } catch (e) { /* l'aperçu n'est pas bloquant */ }
}

/** Ouvre le PDF en demandant le mot de passe si nécessaire. */
async function openDoc(job, quiet = false) {
  for (;;) {
    try {
      return await pdfjs.getDocument({ data: job.bytes.slice(), password: job.password, verbosity: 0, ...docOptions }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") {
        if (quiet && job.password === undefined) { setStatus(job, "PDF protégé : le mot de passe sera demandé à la conversion"); return null; }
        const pwd = await askPassword(job.file.name, job.password !== undefined);
        if (pwd === null) { job.password = undefined; throw new Error("Mot de passe requis pour ce PDF."); }
        job.password = pwd;
        continue;
      }
      throw e;
    }
  }
}

function removeJob(job) {
  if (busy) return;
  if (job.url) URL.revokeObjectURL(job.url);
  job.el.remove();
  jobs.splice(jobs.indexOf(job), 1);
  refresh();
}
clearBtn.addEventListener("click", () => { [...jobs].forEach(removeJob); });

// ---------- conversion ----------
convertBtn.addEventListener("click", async () => {
  if (busy) return;
  busy = true; refresh();
  for (const job of jobs) {
    if (job.result && job.settingsKey === settingsKey()) continue;
    await runJob(job);
  }
  busy = false; refresh();
});

const settingsKey = () => `${format}|${mode}`;

async function runJob(job) {
  const dl = job.el.querySelector(".dl");
  dl.hidden = true;
  job.el.querySelector(".share").hidden = true;
  setProgress(job, 2);
  setStatus(job, "Lecture du PDF…");
  try {
    if (!job.bytes) job.bytes = new Uint8Array(await job.file.arrayBuffer());
    if (job.password === undefined) { const d = await openDoc(job); if (d) await d.destroy(); }
    if (!job.previewed) preview(job); // PDF protégé : l'aperçu devient possible après le mot de passe
    const res = await convertPdf(job.bytes.slice(), format, {
      pdfjs, env, mode, title: job.file.name.replace(/\.pdf$/i, ""),
      docOptions: { ...docOptions, password: job.password },
      onProgress: (done, total, label) => { setProgress(job, 5 + Math.round((done / Math.max(1, total)) * 90)); setStatus(job, label); },
    });
    if (job.url) URL.revokeObjectURL(job.url);
    const blob = new Blob([res.bytes], { type: res.mime });
    job.result = { ...res, blob, name: outName(job.file.name, res.ext) };
    job.settingsKey = settingsKey();
    job.url = URL.createObjectURL(blob);
    dl.href = job.url; dl.download = job.result.name; dl.hidden = false;
    dl.textContent = isNative ? `Enregistrer .${res.ext}` : `Télécharger .${res.ext}`;
    job.saved = null;
    job.el.querySelector(".share").hidden = !isNative;
    setProgress(job, 100);
    setStatus(job, summary(res), "ok");
  } catch (e) {
    console.error(e);
    job.result = null;
    setProgress(job, 0);
    setStatus(job, "Échec : " + friendlyError(e), "err");
  }
}

function summary(res) {
  const s = res.stats, parts = [];
  if (s.exactPages && s.exactPages === s.pages) parts.push(`${s.pages} page(s) reproduite(s) à l'identique`);
  else {
    parts.push(`${s.paragraphs} paragraphe${s.paragraphs > 1 ? "s" : ""}`);
    if (s.tables) parts.push(`${s.tables} tableau${s.tables > 1 ? "x" : ""}`);
    parts.push(`${s.images} image${s.images > 1 ? "s" : ""}`);
    if (s.figures) parts.push(`${s.figures} graphique${s.figures > 1 ? "s" : ""}`);
    if (s.ocrPages) parts.push(`${s.ocrPages} page(s) scannée(s) avec OCR`);
  }
  const kb = res.bytes.length / 1024;
  return `Terminé — ${parts.join(" · ")} · ${kb > 1024 ? (kb / 1024).toFixed(1) + " Mo" : Math.max(1, Math.round(kb)) + " Ko"}${res.warnings && res.warnings.length ? ` · ${res.warnings.length} page(s) en mode image` : ""}`;
}

function friendlyError(e) {
  const m = (e && e.message) || String(e);
  if (/Invalid PDF|InvalidPDFException/i.test(m)) return "ce fichier n'est pas un PDF valide ou il est endommagé.";
  if (/password/i.test(m)) return "mot de passe incorrect ou manquant.";
  return m;
}

// ---------- Android : enregistrement et partage ----------
async function saveJob(job) {
  try {
    job.saved = await saveFile(job.result.name, job.result.bytes, job.result.mime);
    setStatus(job, `Enregistré dans ${job.saved.where} : ${job.result.name}`, "ok");
  } catch (e) {
    setStatus(job, "Échec de l'enregistrement : " + friendlyError(e), "err");
  }
}
async function shareJob(job) {
  try {
    if (!job.saved || !job.saved.uri) job.saved = await saveFile(job.result.name, job.result.bytes, job.result.mime);
    await shareFile(job.saved.uri, job.result.name);
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) setStatus(job, "Partage impossible : " + friendlyError(e), "err");
  }
}

zipBtn.addEventListener("click", async () => {
  const zip = new JSZip();
  const used = new Set();
  jobs.filter((j) => j.result).forEach((j) => {
    let n = j.result.name, k = 2;
    while (used.has(n)) n = j.result.name.replace(/(\.[^.]+)$/, ` (${k++})$1`);
    used.add(n); zip.file(n, j.result.bytes);
  });
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const saved = await saveFile("documents-convertis.zip", bytes, "application/zip");
  if (isNative && saved.uri) await shareFile(saved.uri, "documents-convertis.zip").catch(() => {});
});

// ---------- UI ----------
function refresh() {
  const key = settingsKey();
  const pending = jobs.some((j) => !j.result || j.settingsKey !== key);
  convertBtn.disabled = busy || jobs.length === 0 || !pending;
  convertBtn.textContent = busy ? "Conversion en cours…" : jobs.length && !pending ? "Conversion terminée ✓" : jobs.length > 1 ? `Convertir ${jobs.length} fichiers en .${FORMATS[format].ext}` : `Convertir en .${FORMATS[format].ext}`;
  const done = jobs.filter((j) => j.result).length;
  zipBtn.hidden = done < 2;
  clearBtn.hidden = jobs.length === 0;
  jobs.forEach((j) => {
    if (j.result && j.settingsKey !== key && !busy) setStatus(j, "Réglages modifiés — cliquez sur Convertir pour régénérer");
  });
}
function setStatus(job, text, cls = "") { const s = job.el.querySelector(".status"); s.textContent = text; s.className = "status " + cls; }
function setProgress(job, pct) { job.el.querySelector(".bar span").style.width = pct + "%"; }
function humanSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko"; }
function outName(name, ext) { return name.replace(/\.pdf$/i, "") + "." + ext; }

// ---------- API de test (utilisée par les tests automatisés dans Chrome) ----------
window.__yonks = {
  async convert(base64, fmt, md, password) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const res = await convertPdf(bytes, fmt, { pdfjs, env, mode: md, docOptions: { ...docOptions, password } });
    let bin = "";
    for (let i = 0; i < res.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, res.bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), stats: res.stats, warnings: res.warnings };
  },
  platform,
  /** Test de l'enregistrement natif (Android) : renvoie l'URI du fichier écrit. */
  async saveTest(name, base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return saveFile(name, bytes, "application/octet-stream");
  },
};
