"""Génère les fichiers d'entrée non-PDF des tests (tests/fixtures-in/).

  rapport.docx       Word riche (titres, couleurs, gras/italique/souligné, listes, tableau ombré,
                     image, saut de page, en-tête et pied de page, grec/cyrillique, symboles)
  rapport.odt/.rtf/.doc   mêmes contenus convertis par LibreOffice (vrais formats de ces logiciels)
  rapport.ref.pdf    rendu de référence LibreOffice (comparaison visuelle)
  page-web.html + page-web_files/   page web « enregistrée complète » : CSS et image externes,
                     texte caché (display:none, visibility:hidden, script, noscript) à ne PAS extraire
  notes.txt (UTF-8), notes-ansi.txt (Windows-1252)

Usage : python3 tests/make_input_fixtures.py    (python-docx, Pillow, LibreOffice)
"""
import io, shutil, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm

OUT = Path(__file__).resolve().parent / "fixtures-in"
OUT.mkdir(exist_ok=True)

LOREM = ("La conversion doit conserver le texte, les styles et les images à leur place. "
         "Ce paragraphe est assez long pour s'étendre sur plusieurs lignes et vérifier "
         "la justification, les retours à la ligne et la pagination du document final.")


def picture(w=480, h=240):
    im = Image.new("RGB", (w, h), (31, 78, 121))
    d = ImageDraw.Draw(im)
    for i in range(0, w, 24):
        d.rectangle([i, h - (i * 7 % h), i + 18, h], fill=(227, 162, 60))
    d.ellipse([w - 150, 20, w - 30, 140], fill=(79, 209, 197))
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hexcolor)
    tcPr.append(shd)


def make_docx(path):
    doc = Document()
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21)
    sec.left_margin = sec.right_margin = Cm(2.2)
    sec.header.paragraphs[0].text = "Yonk's PDF Converter — en-tête de test"
    sec.footer.paragraphs[0].text = "Pied de page du rapport"
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(11)

    doc.add_heading("Rapport de test — Œuvre collective", level=1)
    p = doc.add_paragraph()
    r = p.add_run("Sous-titre en italique et en couleur"); r.italic = True; r.font.color.rgb = RGBColor(0xC0, 0x50, 0x4D)
    p = doc.add_paragraph(LOREM + " " + LOREM); p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p = doc.add_paragraph()
    p.add_run("Mots en "); p.add_run("gras").bold = True; p.add_run(", en "); p.add_run("italique").italic = True
    p.add_run(", "); u = p.add_run("soulignés"); u.underline = True; p.add_run(" et "); c = p.add_run("en vert"); c.font.color.rgb = RGBColor(0x2E, 0x8B, 0x57)
    p.add_run(". Accents : élève, été, garçon, cœur, naïveté, « guillemets », 25 € — grec : αβγ Ωμέγα — cyrillique : Привет мир.")
    doc.add_heading("Liste des points", level=2)
    for t in ("Premier point de la liste", "Deuxième point de la liste", "Troisième point"):
        doc.add_paragraph(t, style="List Bullet")
    for t in ("Étape numérotée un", "Étape numérotée deux"):
        doc.add_paragraph(t, style="List Number")
    doc.add_heading("Tableau", level=2)
    t = doc.add_table(rows=3, cols=3); t.style = "Table Grid"
    rows = [("Action", "Responsable", "Échéance"), ("Préparer la maquette", "Fabrizio", "12/03"), ("Valider le contrat", "Marie-Hélène", "20/03")]
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            cell = t.cell(i, j); cell.text = v
            if i == 0:
                shade(cell, "DBE5F1"); cell.paragraphs[0].runs[0].bold = True
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(io.BytesIO(picture()), width=Cm(10))
    cap = doc.add_paragraph("Figure 1 : image centrée"); cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.runs[0].italic = True
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.add_heading("Deuxième page", level=1)
    doc.add_paragraph("Texte de la deuxième page. " + LOREM)
    doc.save(path)


HTML = """<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Page web de test</title>
<link rel="stylesheet" href="page-web_files/style.css">
<script>document.write("CODE SOURCE INVISIBLE")</script>
<style>.cache{display:none}</style></head>
<body>
<header class="bandeau"><h1>Actualités du laboratoire</h1><nav><a href="https://example.org/accueil">Accueil</a> · <a href="https://example.org/contact">Contact</a></nav></header>
<main>
<article>
<h2>Une conversion fidèle</h2>
<p class="intro">Ce texte est <strong>visible à l'écran</strong> et doit être extrait, avec ses <em>accents</em> : élève, été, cœur.</p>
<p class="cache">TEXTE MASQUÉ PAR CSS</p>
<p style="visibility:hidden">TEXTE INVISIBLE</p>
<noscript>MESSAGE NOSCRIPT</noscript>
<img src="page-web_files/photo.png" alt="Photo du laboratoire" width="480">
<p>Paragraphe après l'image. LOREM</p>
<ul><li>Premier élément</li><li>Deuxième élément</li></ul>
<table><tr><th>Ville</th><th>Pays</th></tr><tr><td>Ancona</td><td>Italia</td></tr><tr><td>Douala</td><td>Cameroun</td></tr></table>
<p>Symboles : 25 € · αβγ · Привет · émoji 🚀</p>
</article>
</main>
<footer>© 2026 Page de test — <a href="mailto:contact@example.org">écrire</a></footer>
</body></html>
""".replace("LOREM", LOREM + " " + LOREM)

CSS = """
body { font-family: Georgia, serif; margin: 0; color: #222; background: #fafafa; }
.bandeau { background: #1f4e79; color: #fff; padding: 18px 28px; }
.bandeau h1 { margin: 0 0 6px; font-family: Arial, sans-serif; }
.bandeau a { color: #ffd27a; }
main { max-width: 760px; margin: 24px auto; padding: 0 20px; }
.intro { font-size: 18px; border-left: 4px solid #e3a23c; padding-left: 12px; }
table { border-collapse: collapse; } th, td { border: 1px solid #888; padding: 4px 10px; } th { background: #dbe5f1; }
footer { text-align: center; color: #666; padding: 20px; border-top: 1px solid #ccc; }
"""


def main():
    docx = OUT / "rapport.docx"
    make_docx(docx)
    soffice = shutil.which("soffice")
    for fmt, filt in (("odt", "odt"), ("rtf", "rtf"), ("doc", "doc:MS Word 97"), ("pdf", "pdf")):
        subprocess.run([soffice, "--headless", "--norestore", "--convert-to", filt, "--outdir", str(OUT), str(docx)], check=True, capture_output=True, timeout=180)
    (OUT / "rapport.pdf").rename(OUT / "rapport.ref.pdf")
    files = OUT / "page-web_files"; files.mkdir(exist_ok=True)
    (files / "style.css").write_text(CSS, encoding="utf-8")
    (files / "photo.png").write_bytes(picture(640, 320))
    (OUT / "page-web.html").write_text(HTML, encoding="utf-8")
    txt = "Notes de réunion\n\nPremière ligne avec accents : élève, été, cœur, 25 €.\n\tLigne indentée par une tabulation.\n\n" + LOREM + "\n"
    (OUT / "notes.txt").write_text(txt, encoding="utf-8")
    (OUT / "notes-ansi.txt").write_bytes(txt.encode("cp1252"))
    print("fixtures-in :", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    sys.exit(main())
