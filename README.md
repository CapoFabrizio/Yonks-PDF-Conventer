# PressPDF — conversion PDF locale, sans clé API

Convertit des PDF en `.docx`, `.odt`, `.rtf`, `.doc` ou `.txt`, entièrement
avec des bibliothèques et outils **open source**, exécutés sur votre propre
serveur. Aucune clé API payante, aucun service tiers, aucun envoi de vos
documents vers un cloud externe.

## Architecture

```
pdf-converter/
├── backend/
│   ├── app.py                 # API FastAPI (upload, jobs, téléchargement)
│   ├── jobs.py                # suivi de progression en mémoire
│   ├── converters/
│   │   ├── pdf_to_docx.py     # PDF -> DOCX via pdf2docx (pur Python)
│   │   ├── pdf_to_text.py     # PDF -> TXT via PyMuPDF (pur Python)
│   │   └── office_bridge.py   # DOCX -> ODT/RTF/DOC via LibreOffice headless
│   └── requirements.txt
├── frontend/                  # HTML/CSS/JS statique, sans étape de build
├── Dockerfile
└── docker-compose.yml
```

**Pourquoi deux moteurs ?**
- `pdf2docx` (+ PyMuPDF) est le seul des deux capable de bien *lire* un PDF
  et d'en reconstruire un document structuré (paragraphes, tableaux, images).
- LibreOffice, en revanche, n'a pas de filtre d'import PDF → Writer fiable :
  il ouvre toujours un PDF comme un dessin (module Draw), ce qui donnerait
  un `.odt`/`.rtf` corrompu si on partait du PDF brut.

  → Le pipeline convertit donc **toujours** le PDF en DOCX d'abord (moteur
  pdf2docx), puis, si besoin, ce DOCX vers ODT/RTF/DOC via LibreOffice
  (conversion Writer → Writer, fiable). `.docx` et `.txt` fonctionnent sans
  LibreOffice du tout.

## Démarrage rapide (Docker — recommandé)

```bash
docker compose up --build
```

Ouvrez http://localhost:8000 — l'interface et l'API sont servies ensemble.

## Démarrage sans Docker

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# .docx et .txt fonctionneront out-of-the-box.
# Pour .odt / .rtf / .doc, installez LibreOffice :
#   Debian/Ubuntu : sudo apt install libreoffice-writer
#   macOS         : brew install --cask libreoffice
#   Windows       : https://www.libreoffice.org/download/

uvicorn app:app --reload --port 8000
```

## API

| Méthode | Route                          | Description                                  |
|---------|--------------------------------|-----------------------------------------------|
| GET     | `/api/health`                  | Statut, formats disponibles                   |
| POST    | `/api/convert?target_format=…` | Upload d'un PDF (`multipart/form-data`, champ `file`), retourne `{job_id}` |
| GET     | `/api/jobs/{job_id}`           | Statut / progression du job                   |
| GET     | `/api/jobs/{job_id}/download`  | Télécharge le fichier converti                |

Formats acceptés pour `target_format` : `docx`, `odt`, `rtf`, `doc`, `txt`.

## Configuration

Variables d'environnement :
- `MAX_UPLOAD_MB` (défaut `50`) — taille maximale d'un PDF accepté.
- `CONVERTER_WORK_DIR` (défaut : dossier temporaire système) — où sont
  stockés temporairement les fichiers en cours de traitement.

Les fichiers de chaque conversion sont supprimés automatiquement après
30 minutes (`jobs.py`, `TTL_SECONDS`).

## Limites connues

- Les PDF scannés (images sans texte sélectionnable) ne sont pas passés à
  l'OCR : le texte extrait sera vide ou approximatif. Un moteur OCR open
  source comme `tesseract` pourrait être ajouté en amont si besoin.
- Les mises en page très complexes (PDF multi-colonnes denses, formulaires)
  peuvent nécessiter des ajustements manuels après conversion — c'est une
  limite du format PDF lui-même, pas de l'outil.

## Licences des dépendances

Toutes open source : FastAPI (MIT), pdf2docx (MIT), PyMuPDF (AGPL/commercial
— vérifiez que l'usage prévu est compatible AGPL ou obtenez une licence
commerciale auprès d'Artifex si besoin), python-docx (MIT), LibreOffice
(MPL 2.0 / LGPL).
