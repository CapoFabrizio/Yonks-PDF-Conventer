"""
Conversion PDF -> DOCX basée sur pdf2docx (open source, licence MIT).
Aucun binaire externe requis : tout tourne en pur Python via PyMuPDF.
"""
from __future__ import annotations

import fitz  # PyMuPDF
from pdf2docx import Converter


def count_pages(pdf_path: str) -> int:
    with fitz.open(pdf_path) as doc:
        return doc.page_count


def convert_pdf_to_docx(pdf_path: str, docx_path: str) -> int:
    """
    Convertit un PDF en DOCX en préservant au mieux la mise en page
    (paragraphes, tableaux, images, styles de base).
    Retourne le nombre de pages traitées.
    """
    total = count_pages(pdf_path)
    cv = Converter(pdf_path)
    try:
        cv.convert(docx_path)
    finally:
        cv.close()
    return total
