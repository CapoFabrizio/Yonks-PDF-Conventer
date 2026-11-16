"""Prépare les polices embarquées dans les PDF générés (src/pdf/fonts.js).

Polices Liberation (SIL Open Font License 1.1, métriques identiques à Arial, Times New Roman et
Courier New), réduites aux alphabets latin, grec, cyrillique et aux symboles courants.
Usage : python3 scripts/build_fonts.py   (fontTools ; polices Liberation installées)
"""
import base64, io, json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset

SRC = Path("/usr/share/fonts/truetype/liberation")
OUT = Path(__file__).resolve().parent.parent / "src" / "pdf" / "fonts.js"
RANGES = [(0x20, 0x7E), (0xA0, 0x24F), (0x2B0, 0x2FF), (0x300, 0x36F), (0x370, 0x3FF), (0x400, 0x4FF),
          (0x1E00, 0x1EFF), (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2100, 0x214F), (0x2190, 0x2199),
          (0x2212, 0x2212), (0x2260, 0x2265), (0x25A0, 0x25CF), (0xFB00, 0xFB06)]
# Les caractères hors de ces plages (idéogrammes, émojis…) sont dessinés en image par le navigateur.
FAMILIES = {"sans": "LiberationSans", "serif": "LiberationSerif", "mono": "LiberationMono"}
STYLES = {"normal": "Regular", "bold": "Bold", "italic": "Italic", "bolditalic": "BoldItalic"}

unicodes = [c for a, b in RANGES for c in range(a, b + 1)]
out, covered = {}, None
for fam, base in FAMILIES.items():
    for style, suffix in STYLES.items():
        font = TTFont(SRC / f"{base}-{suffix}.ttf")
        opts = subset.Options(); opts.layout_features = ["kern", "liga"]; opts.name_IDs = ["*"]; opts.notdef_outline = True; opts.hinting = False; opts.drop_tables += ["FFTM", "gasp", "hdmx", "LTSH", "VDMX", "kern"]
        opts.drop_tables += ["DSIG", "GSUB", "GPOS"]  # jsPDF n'utilise pas les tables OpenType avancées
        sub = subset.Subsetter(opts); sub.populate(unicodes=unicodes); sub.subset(font)
        # Version modifiée (sous-ensemble) : la licence OFL interdit d'y garder le nom réservé « Liberation ».
        new_family = {"sans": "Yonks Sans", "serif": "Yonks Serif", "mono": "Yonks Mono"}[fam]
        sub_name = {"normal": "Regular", "bold": "Bold", "italic": "Italic", "bolditalic": "Bold Italic"}[style]
        name = font["name"]
        for rec in list(name.names):
            if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22): name.removeNames(nameID=rec.nameID)
        for nid, val in ((1, new_family), (2, sub_name), (3, f"{new_family} {sub_name}; YONK'S LABs"), (4, f"{new_family} {sub_name}"),
                         (6, f"{new_family.replace(' ', '')}-{sub_name.replace(' ', '')}")):
            name.setName(val, nid, 3, 1, 0x409); name.setName(val, nid, 1, 0, 0)
        name.setName("Dérivée de Liberation (Red Hat ; Arimo, Tinos, Cousine : Google), SIL Open Font License 1.1.", 0, 3, 1, 0x409)
        cmap = set(font.getBestCmap().keys())
        covered = cmap if covered is None else covered & cmap
        buf = io.BytesIO(); font.save(buf)
        out[f"{fam}-{style}"] = base64.b64encode(buf.getvalue()).decode()
        print(f"{fam}-{style}: {len(buf.getvalue()) // 1024} Ko, {len(cmap)} caractères")

# caractères couverts par toutes les polices, en plages compactes
pts = sorted(covered); ranges = []
for c in pts:
    if ranges and c == ranges[-1][1] + 1: ranges[-1][1] = c
    else: ranges.append([c, c])
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("// Généré par scripts/build_fonts.py — polices Liberation (SIL OFL 1.1). Ne pas modifier.\n"
               f"export const FONTS = {json.dumps(out)};\nexport const COVERAGE = {json.dumps(ranges)};\n", encoding="utf-8")
print("total", OUT.stat().st_size // 1024, "Ko,", len(ranges), "plages")
