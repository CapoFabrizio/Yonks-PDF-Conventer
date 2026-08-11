from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from converters.office_bridge import LibreOfficeUnavailable, convert_via_libreoffice, is_available as libreoffice_available
from converters.pdf_to_docx import convert_pdf_to_docx, count_pages
from converters.pdf_to_text import convert_pdf_to_txt
from jobs import store, TTL_SECONDS

APP_DIR = Path(__file__).parent
WORK_DIR = Path(os.environ.get("CONVERTER_WORK_DIR", tempfile.gettempdir())) / "pdf-converter-jobs"
WORK_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "50"))

NATIVE_FORMATS = {"docx", "txt"}          # gérés en pur Python, toujours dispo
BRIDGED_FORMATS = {"odt", "rtf", "doc"}   # nécessitent LibreOffice
ALL_FORMATS = NATIVE_FORMATS | BRIDGED_FORMATS

app = FastAPI(title="PDF Converter", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "libreoffice_available": libreoffice_available(),
        "native_formats": sorted(NATIVE_FORMATS),
        "bridged_formats": sorted(BRIDGED_FORMATS),
    }


def _run_conversion(job_id: str, pdf_path: str, target_format: str):
    job_dir = Path(pdf_path).parent
    store.update(job_id, status="processing", progress=5, message="Analyse du PDF…")
    try:
        pages = count_pages(pdf_path)
        store.update(job_id, progress=15, message=f"{pages} page(s) détectée(s)")

        if target_format == "txt":
            out_path = str(job_dir / "output.txt")
            store.update(job_id, progress=30, message="Extraction du texte…")
            convert_pdf_to_txt(pdf_path, out_path)
        else:
            # DOCX est toujours l'étape intermédiaire : pdf2docx est le seul
            # des deux moteurs capable de lire correctement un PDF. Pour les
            # formats "pontés", LibreOffice part ensuite de ce DOCX plutôt
            # que du PDF brut (voir converters/office_bridge.py).
            docx_path = str(job_dir / "intermediate.docx")
            store.update(job_id, progress=30, message="Conversion en DOCX (moteur pdf2docx)…")
            convert_pdf_to_docx(pdf_path, docx_path)

            if target_format == "docx":
                out_path = str(job_dir / "output.docx")
                shutil.move(docx_path, out_path)
            elif target_format in BRIDGED_FORMATS:
                store.update(job_id, progress=65, message=f"Conversion en {target_format.upper()} via LibreOffice…")
                produced = convert_via_libreoffice(docx_path, str(job_dir), target_format)
                out_path = str(job_dir / f"output.{target_format}")
                shutil.move(produced, out_path)
            else:
                raise ValueError(f"Format cible non supporté: {target_format}")

        store.update(job_id, status="done", progress=100, message="Terminé", output_path=out_path)
    except LibreOfficeUnavailable as e:
        store.update(job_id, status="error", error=str(e), message="LibreOffice indisponible")
    except Exception as e:  # noqa: BLE001
        store.update(job_id, status="error", error=str(e), message="Échec de la conversion")


@app.post("/api/convert")
async def convert(background_tasks: BackgroundTasks, target_format: str, file: UploadFile = File(...)):
    target_format = target_format.lower().lstrip(".")
    if target_format not in ALL_FORMATS:
        raise HTTPException(400, f"Format cible non supporté: {target_format}")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Seuls les fichiers .pdf sont acceptés en entrée.")

    contents = await file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(413, f"Fichier trop volumineux ({size_mb:.1f} Mo). Limite: {MAX_UPLOAD_MB} Mo.")

    job = store.create(source_filename=file.filename, target_format=target_format)
    job_dir = WORK_DIR / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = job_dir / "input.pdf"
    pdf_path.write_bytes(contents)

    store.sweep_expired(WORK_DIR)
    background_tasks.add_task(_run_conversion, job.id, str(pdf_path), target_format)

    return {"job_id": job.id, "status": job.status}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job introuvable ou expiré.")
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "target_format": job.target_format,
        "source_filename": job.source_filename,
        "error": job.error,
    }


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job introuvable ou expiré.")
    if job.status != "done" or not job.output_path:
        raise HTTPException(409, "La conversion n'est pas terminée.")
    out_path = Path(job.output_path)
    if not out_path.exists():
        raise HTTPException(410, "Le fichier a expiré. Relancez la conversion.")

    base_name = Path(job.source_filename).stem
    download_name = f"{base_name}.{job.target_format}"
    return FileResponse(out_path, filename=download_name)


# Sert le frontend statique (build simple, sans étape de compilation)
FRONTEND_DIR = APP_DIR.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
