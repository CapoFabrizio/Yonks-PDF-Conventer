"""Génère des PDF de test réalistes : texte stylé, images (PNG/JPEG), scan, colonnes, figure vectorielle."""
import pymupdf, io, math, sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures")
OUT.mkdir(parents=True, exist_ok=True)

LOREM = ("La conversion d'un document PDF vers Word doit conserver le texte éditable, "
         "les paragraphes, les titres et surtout les images à leur place. Ce paragraphe "
         "est volontairement long afin de vérifier que les retours à la ligne du PDF "
         "sont fusionnés en un seul paragraphe fluide dans le document final.")

def photo(w, h, seed=0, alpha=False):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), alpha)
    for y in range(h):
        for x in range(w):
            r = int(127 + 127 * math.sin((x + seed * 40) / 23))
            g = int(127 + 127 * math.sin((y + seed * 17) / 31))
            b = int(127 + 127 * math.cos((x + y) / 41))
            if alpha:
                a = 255 if (x - w / 2) ** 2 + (y - h / 2) ** 2 < (min(w, h) / 2) ** 2 else 0
                pix.set_pixel(x, y, (r, g, b, a))
            else:
                pix.set_pixel(x, y, (r, g, b))
    return pix

def png_bytes(pix): return pix.tobytes("png")
def jpg_bytes(pix): return pix.tobytes("jpeg", jpg_quality=85)

# 1) Texte seul, stylé, 2 pages, accents
doc = pymupdf.open()
p = doc.new_page()
p.insert_text((72, 80), "Rapport annuel 2026", fontname="hebo", fontsize=24)
p.insert_text((72, 110), "Sous-titre en italique : résultats et perspectives", fontname="heit", fontsize=13)
p.insert_textbox(pymupdf.Rect(72, 130, 523, 230), LOREM, fontname="helv", fontsize=11)
p.insert_text((72, 260), "1. Introduction", fontname="hebo", fontsize=16)
p.insert_textbox(pymupdf.Rect(72, 275, 523, 380), "Élève, été, garçon, cœur, ça marche : les caractères accentués doivent rester intacts. " + LOREM, fontname="helv", fontsize=11)
p.insert_text((90, 400), "• Premier point de la liste", fontname="helv", fontsize=11)
p.insert_text((90, 416), "• Deuxième point de la liste", fontname="helv", fontsize=11)
p2 = doc.new_page()
p2.insert_text((72, 80), "2. Deuxième page", fontname="hebo", fontsize=16)
p2.insert_textbox(pymupdf.Rect(72, 95, 523, 200), LOREM, fontname="tiro", fontsize=12)
doc.save(OUT / "texte_style.pdf")

# 2) Texte + images (PNG, JPEG, PNG transparent) dont une à côté du texte
doc = pymupdf.open()
p = doc.new_page()
p.insert_text((72, 80), "Catalogue produits", fontname="hebo", fontsize=22)
p.insert_textbox(pymupdf.Rect(72, 95, 523, 150), LOREM, fontname="helv", fontsize=11)
p.insert_image(pymupdf.Rect(72, 160, 372, 340), stream=jpg_bytes(photo(300, 180, 1)))
p.insert_text((72, 356), "Figure 1 : photo principale (JPEG)", fontname="heit", fontsize=9)
# image à gauche, texte à droite
p.insert_image(pymupdf.Rect(72, 380, 222, 530), stream=png_bytes(photo(150, 150, 2)))
p.insert_textbox(pymupdf.Rect(240, 385, 523, 530), "Texte à droite de l'image. " + LOREM, fontname="helv", fontsize=11)
p.insert_image(pymupdf.Rect(400, 600, 520, 720), stream=png_bytes(photo(120, 120, 3, alpha=True)))
p.insert_text((72, 640), "Logo transparent en bas à droite.", fontname="helv", fontsize=11)
doc.save(OUT / "texte_images.pdf")

# 3) Scan : page = une seule image, aucun texte
doc = pymupdf.open()
p = doc.new_page()
scan = photo(595, 842, 4)
p.insert_image(p.rect, stream=jpg_bytes(scan))
doc.save(OUT / "scan.pdf")

# 4) Deux colonnes + figure vectorielle (camembert) + fond coloré de titre
doc = pymupdf.open()
p = doc.new_page()
p.draw_rect(pymupdf.Rect(0, 40, 595, 100), color=None, fill=(0.1, 0.3, 0.5))
p.insert_text((72, 80), "Lettre d'information", fontname="hebo", fontsize=22, color=(1, 1, 1))
p.insert_textbox(pymupdf.Rect(72, 120, 290, 420), "Colonne gauche. " + LOREM + " " + LOREM, fontname="helv", fontsize=10)
p.insert_textbox(pymupdf.Rect(310, 120, 523, 420), "Colonne droite. " + LOREM + " " + LOREM, fontname="helv", fontsize=10)
c = pymupdf.Point(200, 560); start = c + (100, 0)
cols = [(0.9, 0.3, 0.2), (0.2, 0.6, 0.9), (0.3, 0.8, 0.4), (0.95, 0.75, 0.2)]
ang = [120, 90, 80, 70]
pt = start
for a, col in zip(ang, cols):
    shape = p.new_shape(); pt = shape.draw_sector(c, pt, a, fullSector=True); shape.finish(color=(1, 1, 1), fill=col); shape.commit()
p.insert_text((330, 540), "Répartition du budget", fontname="hebo", fontsize=13)
p.insert_text((330, 560), "Le graphique vectoriel doit rester visible.", fontname="helv", fontsize=10)
doc.save(OUT / "colonnes_vectoriel.pdf")
print("fixtures OK ->", sorted(x.name for x in OUT.iterdir()))

# 5) Document type « export Word » : polices embarquées (Unicode complet), justifié, titre coloré,
#    tableau à bordures, image, pied de page, 2 pages — généré par le moteur HTML de PyMuPDF.
img = OUT / "_photo.jpg"
img.write_bytes(jpg_bytes(photo(320, 160, 5)))
css = """
* { font-family: sans-serif; }
body { font-size: 11pt; }
h1 { color: #1f4e79; font-size: 20pt; margin: 0 0 6pt 0; }
h2 { color: #c0504d; font-size: 14pt; margin: 12pt 0 4pt 0; }
p { text-align: justify; margin: 0 0 6pt 0; line-height: 1.25; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #444; padding: 3pt 5pt; font-size: 10pt; }
th { background: #dbe5f1; }
"""
html1 = f"""<h1>Compte rendu de réunion — Œuvre collective</h1>
<p>Les participants ont validé le budget. Élève, été, garçon, cœur, Œdipe, « guillemets », naïveté, déjà :
tous ces caractères doivent survivre à la conversion. {LOREM} {LOREM}</p>
<h2>Décisions</h2>
<p><b>Important :</b> la réunion suivante aura lieu en <i>mars</i>. {LOREM}</p>
<table><tr><th>Action</th><th>Responsable</th><th>Échéance</th></tr>
<tr><td>Préparer la maquette</td><td>Fabrizio</td><td>12/03</td></tr>
<tr><td>Valider le contrat</td><td>Marie-Hélène</td><td>20/03</td></tr></table>
<p style="text-align:center"><img src="_photo.jpg" width="240"/></p>
<p>{LOREM}</p>"""
html2 = f"""<h2>Annexe</h2><p>{LOREM} {LOREM} {LOREM}</p>"""
doc = pymupdf.open()
arch = pymupdf.Archive(str(OUT))
for html in (html1, html2):
    p = doc.new_page()
    p.insert_htmlbox(pymupdf.Rect(60, 56, 535, 780), html, css=css, archive=arch)
    p.insert_text((290, 815), f"{doc.page_count}", fontname="helv", fontsize=9)
doc.save(OUT / "export_word.pdf", garbage=3, deflate=True)
img.unlink()
print("export_word.pdf OK")

# 6) PDF protégé par mot de passe (mot de passe : yonks)
doc = pymupdf.open()
p = doc.new_page()
p.insert_text((72, 80), "Document confidentiel", fontname="hebo", fontsize=20)
p.insert_textbox(pymupdf.Rect(72, 100, 523, 200), LOREM, fontname="helv", fontsize=11)
doc.save(OUT / "protege.pdf", encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="yonks", owner_pw="owner-yonks")

# 7) Page paysage + page tournée de 90°
doc = pymupdf.open()
p = doc.new_page(width=842, height=595)
p.insert_text((72, 80), "Page paysage", fontname="hebo", fontsize=20)
p.insert_textbox(pymupdf.Rect(72, 100, 770, 200), LOREM, fontname="helv", fontsize=11)
p.insert_image(pymupdf.Rect(72, 220, 372, 400), stream=jpg_bytes(photo(300, 180, 6)))
p2 = doc.new_page()
p2.insert_text((72, 80), "Page tournée", fontname="hebo", fontsize=20)
p2.insert_textbox(pymupdf.Rect(72, 100, 523, 200), LOREM, fontname="helv", fontsize=11)
p2.set_rotation(90)
doc.save(OUT / "paysage_rotation.pdf")
print("protege.pdf + paysage_rotation.pdf OK")
