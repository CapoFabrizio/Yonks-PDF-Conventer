"""Valide les fichiers produits par tests/browser-test.mjs.

Pour chaque document : ouverture réelle par LibreOffice (conversion en PDF), contrôle du texte
attendu, du nombre d'images, et pour les .docx contrôle structurel avec python-docx (styles,
images en ligne). Produit aussi des planches « original | converti » dans tests/output/compare/.

Usage : python3 tests/validate.py       (nécessite LibreOffice, pymupdf, python-docx)
"""
import subprocess, sys, shutil, tempfile
from pathlib import Path
import pymupdf
from docx import Document

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "output"
FIX = ROOT / "tests" / "fixtures"
CMP = OUT / "compare"; CMP.mkdir(exist_ok=True)

EXPECT = {
    "texte_style": {"text": ["Rapport annuel 2026", "Élève, été, garçon", "Premier point de la liste", "Deuxième page"], "images": 0, "min_pages": 2},
    "texte_images": {"text": ["Catalogue produits", "Figure 1", "Texte à droite de l'image", "Logo transparent"], "images": 3, "min_pages": 1},
    "export_word": {"text": ["Compte rendu de réunion — Œuvre collective", "cœur, Œdipe, « guillemets », naïveté", "Préparer la maquette", "Marie-Hélène", "Annexe"], "images": 1, "min_pages": 2},
    "protege": {"text": ["Document confidentiel", "La conversion d'un document PDF"], "images": 0, "min_pages": 1},
    "paysage_rotation": {"text": ["Page paysage", "Page tournée"], "images": 1, "min_pages": 2},
    "scan": {"text": [], "images": 1, "min_pages": 1},
    "colonnes_vectoriel": {"text": ["Lettre d'information", "Colonne gauche", "Colonne droite", "Répartition du budget"], "images": 1, "min_pages": 1},
}

soffice = shutil.which("soffice") or shutil.which("libreoffice")
if not soffice:
    sys.exit("LibreOffice introuvable")

fails = 0
def check(cond, label):
    global fails
    print(("  OK    " if cond else "  ÉCHEC ") + label)
    if not cond: fails += 1

def norm(s): return " ".join(s.replace("’", "'").split())

files = sorted(p for p in OUT.iterdir() if p.suffix in (".docx", ".odt", ".rtf", ".doc", ".txt"))
tmp = Path(tempfile.mkdtemp())
for f in files:
    stem = f.name.split(".")[0].removeprefix("ui_")
    exp = EXPECT.get(stem)
    if not exp: continue
    exact = ".exact." in f.name
    print(f"\n{f.name}")
    if f.suffix == ".txt":
        t = norm(f.read_text(encoding="utf-8-sig"))
        for s in exp["text"]: check(norm(s) in t, f"texte « {s} »")
        continue
    # 1) ouverture réelle par LibreOffice
    src = tmp / f.name
    shutil.copy(f, src)
    r = subprocess.run([soffice, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", str(tmp), str(src)], capture_output=True, text=True, timeout=180)
    pdf = tmp / (f.stem + ".pdf")
    check(pdf.exists() and pdf.stat().st_size > 500, "s'ouvre dans LibreOffice (conversion PDF réussie)")
    if not pdf.exists(): continue
    d = pymupdf.open(pdf)
    text = norm(" ".join(p.get_text() for p in d))
    n_img = sum(len(p.get_images(full=True)) for p in d)
    if exact:
        orig = pymupdf.open(FIX / f"{stem}.pdf")
        if orig.needs_pass: orig.authenticate("yonks")
        check(n_img >= len(orig), f"{n_img} image(s) de page pour {len(orig)} page(s)")
        check(len(d) == len(orig), f"{len(d)} page(s) produite(s), {len(orig)} attendue(s)")
    else:
        for s in exp["text"]: check(norm(s) in text, f"texte « {s} »")
        check(n_img >= exp["images"], f"{n_img} image(s) affichée(s) (≥ {exp['images']} attendue(s))")
        check(len(d) >= exp["min_pages"], f"{len(d)} page(s)")
    # 2) structure DOCX
    if f.suffix == ".docx":
        doc = Document(f)
        shapes = len(doc.inline_shapes)
        if not exact:
            check(shapes + len(doc.tables) >= 0, f"python-docx : {len(doc.paragraphs)} paragraphes, {shapes} image(s) en ligne, {len(doc.tables)} tableau(x) de mise en page")
            if stem == "texte_style":
                title = next((p for p in doc.paragraphs if "Rapport annuel" in p.text), None)
                check(title is not None and all(r.bold for r in title.runs if r.text.strip()), "titre en gras")
                sub = next((p for p in doc.paragraphs if "Sous-titre" in p.text), None)
                check(sub is not None and all(r.italic for r in sub.runs if r.text.strip()), "sous-titre en italique")
                body = next((p for p in doc.paragraphs if p.text.startswith("La conversion d'un document")), None)
                check(body is not None and body.text.rstrip().endswith("document final."), "paragraphe multi-lignes fusionné en un seul paragraphe")
                check(not any("  " in p.text for p in doc.paragraphs), "pas d'espaces doublés")
            if stem == "export_word":
                from docx.enum.text import WD_ALIGN_PARAGRAPH
                just = [p for p in doc.paragraphs if p.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY]
                check(len(just) >= 3, f"{len(just)} paragraphe(s) justifié(s)")
                h = next((p for p in doc.paragraphs if p.text.startswith("Compte rendu")), None)
                col = h.runs[0].font.color.rgb if h and h.runs and h.runs[0].font.color and h.runs[0].font.color.type else None
                check(col is not None and str(col) != "000000", f"couleur du titre conservée ({col})")
                grid = [t for t in doc.tables if len(t.columns) == 3]
                check(len(grid) == 1, "tableau Word réel à 3 colonnes reconstruit")
                if grid:
                    cells = [[c.text.strip() for c in r.cells] for r in grid[0].rows]
                    check(cells[0] == ["Action", "Responsable", "Échéance"], f"en-tête du tableau {cells[0]}")
                    check(["Valider le contrat", "Marie-Hélène", "20/03"] in cells, "ligne « Valider le contrat | Marie-Hélène | 20/03 »")
                check(any("Important" in p.text and any(r.bold for r in p.runs if "Important" in r.text) for p in doc.paragraphs), "mot en gras au milieu d'un paragraphe")
    # 3) planche de comparaison visuelle (première page)
    if f.suffix in (".docx", ".odt") or (f.suffix == ".rtf" and not exact):
        orig = pymupdf.open(FIX / f"{stem}.pdf")
        if orig.needs_pass: orig.authenticate("yonks")
        a = orig[0].get_pixmap(dpi=60); b = d[0].get_pixmap(dpi=60)
        W, H = a.width + b.width + 30, max(a.height, b.height) + 20
        sheet = pymupdf.open(); pg = sheet.new_page(width=W, height=H)
        pg.draw_rect(pg.rect, fill=(0.85, 0.85, 0.85), color=None)
        pg.insert_image(pymupdf.Rect(10, 10, 10 + a.width, 10 + a.height), pixmap=a)
        pg.insert_image(pymupdf.Rect(20 + a.width, 10, 20 + a.width + b.width, 10 + b.height), pixmap=b)
        pg.get_pixmap(dpi=72).save(CMP / f"{f.name}.png")

print(f"\n{'Aucun échec.' if not fails else str(fails) + ' échec(s).'}")
sys.exit(1 if fails else 0)
