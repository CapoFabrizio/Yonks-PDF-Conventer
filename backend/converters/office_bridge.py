"""
Conversion via LibreOffice en mode headless (open source, licence MPL/LGPL).
Utilisé uniquement pour les formats que pdf2docx ne couvre pas nativement
(.odt, .rtf, .doc). Nécessite le paquet `libreoffice` installé sur la
machine / dans le conteneur (voir Dockerfile). Si absent, une erreur claire
est renvoyée à l'appelant plutôt qu'un crash silencieux.

IMPORTANT: on convertit toujours depuis un DOCX intermédiaire (déjà produit
par pdf2docx) et jamais depuis le PDF brut. LibreOffice n'a pas de filtre
d'import PDF -> Writer : un PDF y est toujours ouvert comme un document
Draw, ce qui produit un .odt/.rtf corrompu (texte non éditable, mauvais
type de document). Partir du DOCX (Writer -> Writer) est fiable.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

SOFFICE_BIN = shutil.which("soffice") or shutil.which("libreoffice")

SUPPORTED_TARGETS = {
    "odt": "odt:writer8",
    "rtf": "rtf:Rich Text Format",
    "doc": "doc:MS Word 97",
}


class LibreOfficeUnavailable(RuntimeError):
    pass


def is_available() -> bool:
    return SOFFICE_BIN is not None


def convert_via_libreoffice(input_path: str, output_dir: str, target_format: str) -> str:
    """
    Convertit `input_path` (un .docx, jamais un PDF brut — voir note de module)
    vers `target_format` via LibreOffice. Retourne le chemin du fichier produit.
    """
    if not is_available():
        raise LibreOfficeUnavailable(
            "LibreOffice n'est pas installé sur ce serveur. "
            "Utilisez l'image Docker fournie (docker-compose up) qui l'inclut, "
            "ou installez le paquet 'libreoffice' pour activer ce format."
        )
    if target_format not in SUPPORTED_TARGETS:
        raise ValueError(f"Format non supporté par le pont LibreOffice: {target_format}")

    filter_spec = SUPPORTED_TARGETS[target_format]
    cmd = [
        SOFFICE_BIN,
        "--headless",
        "--norestore",
        "--convert-to", filter_spec,
        "--outdir", output_dir,
        input_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(f"Échec de la conversion LibreOffice: {result.stderr.strip()}")

    stem = Path(input_path).stem
    produced = Path(output_dir) / f"{stem}.{target_format}"
    if not produced.exists():
        raise RuntimeError("LibreOffice n'a produit aucun fichier de sortie.")
    return str(produced)
