(() => {
  const API_BASE = ""; // même origine (servi par FastAPI)

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const dzFile = document.getElementById("dzFile");
  const dzFileName = document.getElementById("dzFileName");
  const dzClear = document.getElementById("dzClear");
  const formatGrid = document.getElementById("formatGrid");
  const formatNote = document.getElementById("formatNote");
  const convertBtn = document.getElementById("convertBtn");
  const jobPanel = document.getElementById("jobPanel");
  const jobFileName = document.getElementById("jobFileName");
  const jobFormatBadge = document.getElementById("jobFormatBadge");
  const progressFill = document.getElementById("progressFill");
  const jobMessage = document.getElementById("jobMessage");
  const jobPercent = document.getElementById("jobPercent");
  const downloadBtn = document.getElementById("downloadBtn");
  const jobError = document.getElementById("jobError");
  const historyEl = document.getElementById("history");
  const historyList = document.getElementById("historyList");
  const chipOut = document.getElementById("chipOut");
  const morphTarget = document.getElementById("morphTarget");

  let selectedFile = null;
  let selectedFormat = "docx";
  let pollTimer = null;

  const MORPH_CYCLE = [".DOCX", ".ODT", ".TXT", ".RTF"];
  let morphIndex = 0;
  setInterval(() => {
    morphIndex = (morphIndex + 1) % MORPH_CYCLE.length;
    morphTarget.textContent = MORPH_CYCLE[morphIndex];
    chipOut.textContent = MORPH_CYCLE[morphIndex].toLowerCase();
  }, 3200);

  // ---------- santé serveur : désactive les formats nécessitant LibreOffice si absent ----------
  fetch(`${API_BASE}/api/health`)
    .then((r) => r.json())
    .then((health) => {
      if (!health.libreoffice_available) {
        formatNote.hidden = false;
        document.querySelectorAll('.format-chip[data-native="0"]').forEach((el) => {
          el.classList.add("disabled");
          el.disabled = true;
        });
      }
    })
    .catch(() => {
      /* silencieux : l'utilisateur découvrira l'erreur à la conversion */
    });

  // ---------- sélection de format ----------
  formatGrid.querySelectorAll(".format-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.disabled) return;
      formatGrid.querySelectorAll(".format-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      selectedFormat = chip.dataset.format;
      updateConvertState();
    });
  });
  formatGrid.querySelector('.format-chip[data-format="docx"]').classList.add("active");

  // ---------- upload : clic / drag&drop ----------
  dropzone.addEventListener("click", (e) => {
    if (e.target === dzClear) return;
    fileInput.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });
  dzClear.addEventListener("click", (e) => {
    e.stopPropagation();
    selectedFile = null;
    fileInput.value = "";
    dzFile.hidden = true;
    updateConvertState();
  });

  function setFile(file) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    selectedFile = file;
    dzFileName.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} Mo`;
    dzFile.hidden = false;
    updateConvertState();
  }

  function updateConvertState() {
    convertBtn.disabled = !selectedFile;
  }

  // ---------- conversion ----------
  convertBtn.addEventListener("click", startConversion);

  async function startConversion() {
    if (!selectedFile) return;
    clearInterval(pollTimer);
    convertBtn.disabled = true;
    jobPanel.hidden = false;
    jobError.hidden = true;
    downloadBtn.hidden = true;
    jobFileName.textContent = selectedFile.name;
    jobFormatBadge.textContent = `.${selectedFormat}`;
    setProgress(0, "Envoi du fichier…");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE}/api/convert?target_format=${selectedFormat}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await safeJson(res);
        throw new Error(err?.detail || `Erreur serveur (${res.status})`);
      }
      const { job_id } = await res.json();
      pollJob(job_id);
    } catch (e) {
      showError(e.message || "Échec de l'envoi du fichier.");
    }
  }

  function pollJob(jobId) {
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        if (!res.ok) throw new Error("Job introuvable.");
        const job = await res.json();
        setProgress(job.progress, job.message);

        if (job.status === "done") {
          clearInterval(pollTimer);
          setProgress(100, "Conversion terminée");
          downloadBtn.hidden = false;
          downloadBtn.href = `${API_BASE}/api/jobs/${jobId}/download`;
          downloadBtn.setAttribute("download", "");
          addHistory(job.source_filename, job.target_format, downloadBtn.href, true);
          convertBtn.disabled = false;
        } else if (job.status === "error") {
          clearInterval(pollTimer);
          showError(job.error || "La conversion a échoué.");
          addHistory(job.source_filename, job.target_format, null, false);
          convertBtn.disabled = false;
        }
      } catch (e) {
        clearInterval(pollTimer);
        showError(e.message);
        convertBtn.disabled = false;
      }
    }, 900);
  }

  function setProgress(pct, message) {
    progressFill.style.width = `${pct}%`;
    jobPercent.textContent = `${pct}%`;
    jobMessage.textContent = message;
  }

  function showError(message) {
    jobError.hidden = false;
    jobError.textContent = message;
    setProgress(0, "Erreur");
  }

  function addHistory(name, format, href, success) {
    historyEl.hidden = false;
    const li = document.createElement("li");
    if (success) {
      li.innerHTML = `<span>${escapeHtml(name)} → .${format}</span><a href="${href}" download>Télécharger</a>`;
    } else {
      li.innerHTML = `<span>${escapeHtml(name)} → .${format}</span><span class="hist-fail">Échec</span>`;
    }
    historyList.prepend(li);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }
})();
