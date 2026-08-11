"""Extraction de texte brut depuis un PDF, via PyMuPDF (pur Python)."""
from __future__ import annotations

import fitz  # PyMuPDF


def convert_pdf_to_txt(pdf_path: str, txt_path: str) -> int:
    with fitz.open(pdf_path) as doc:
        pages_text = [page.get_text("text") for page in doc]
        total = doc.page_count
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n\f\n".join(pages_text))
    return total
