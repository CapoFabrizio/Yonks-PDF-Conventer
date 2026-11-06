"""Génère le logo et toutes les images de marque de Yonk's PDF Converter.

Usage : python3 branding/make_branding.py      (nécessite rsvg-convert, Pillow et la police Inter Display)
Sorties :
  branding/          icon.png, icon-64.png (favicon), logo-full.png, logo-full-light.png (+ .svg)
  build/             icon.png, icon.ico            -> application PC (Electron, Windows, Linux)
  android/.../res/   icônes classiques, rondes, adaptatives et écrans de démarrage -> application Android
"""
import io, subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
B = ROOT / "branding"; E = ROOT / "build"; RES = ROOT / "android" / "app" / "src" / "main" / "res"
for d in (B, E): d.mkdir(exist_ok=True)

SLOGAN = "Sognare e realizzarlo con noi !"
SITE = "vistoapplicazione.com"

AMBER, AMBER_D, TEAL, INK, PAPER = "#E3A23C", "#B9781F", "#4FD1C5", "#0F1719", "#F4F1E8"

def mark(scale=1.0, tx=0, ty=0):
    """Le symbole (1024×1024 à l'échelle 1) : feuille PDF -> document éditable avec image."""
    return f'''<g transform="translate({tx} {ty}) scale({scale})">
  <!-- feuille PDF (arrière) -->
  <g transform="rotate(-9 380 470)">
    <path d="M222 238 H468 L548 318 V700 H222 Z" fill="{AMBER}"/>
    <path d="M468 238 V318 H548 Z" fill="{AMBER_D}"/>
    <rect x="268" y="372" width="190" height="26" rx="13" fill="{INK}" opacity=".55"/>
    <rect x="268" y="424" width="236" height="26" rx="13" fill="{INK}" opacity=".35"/>
    <rect x="268" y="476" width="150" height="26" rx="13" fill="{INK}" opacity=".35"/>
  </g>
  <!-- document éditable (avant) -->
  <g transform="rotate(5 640 590)">
    <rect x="468" y="330" width="352" height="452" rx="30" fill="{PAPER}"/>
    <rect x="512" y="382" width="210" height="30" rx="15" fill="{INK}"/>
    <rect x="512" y="436" width="264" height="18" rx="9" fill="#9DB0AF"/>
    <rect x="512" y="470" width="232" height="18" rx="9" fill="#9DB0AF"/>
    <!-- image conservée -->
    <rect x="512" y="516" width="264" height="168" rx="18" fill="{TEAL}"/>
    <circle cx="718" cy="566" r="24" fill="{AMBER}"/>
    <path d="M512 664 L590 586 L650 640 L690 606 L776 676 V684 H512 Z" fill="{INK}" opacity=".85"/>
    <rect x="512" y="712" width="200" height="18" rx="9" fill="#9DB0AF"/>
  </g>
  <!-- flèche de transformation -->
  <path d="M300 214 C 420 112, 640 128, 724 262" fill="none" stroke="{TEAL}" stroke-width="44" stroke-linecap="round"/>
  <path d="M770 220 L748 330 L652 276 Z" fill="{TEAL}" stroke="{TEAL}" stroke-width="14" stroke-linejoin="round"/>
</g>'''

BG = f'''<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1B2E32"/><stop offset="1" stop-color="#0A1113"/></linearGradient></defs>'''

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'

def render(svg_text, out, w=None):
    src = out.with_suffix(".svg")
    src.write_text(svg_text, encoding="utf-8")
    cmd = ["rsvg-convert", str(src), "-o", str(out)]
    if w: cmd[1:1] = ["-w", str(w)]
    subprocess.run(cmd, check=True)

def full_logo(w, h, cx, top, s, dark=True):
    fg = "#ECEBE4" if dark else INK
    sub = "#9DB0AF" if dark else "#41585C"
    return (f'<g transform="translate({cx - 512 * s * 0.86} {top})">{mark(s * 0.86)}</g>'
            f'<text x="{cx}" y="{top + 1000 * s}" text-anchor="middle" font-family="Inter Display" font-weight="800" font-size="{150 * s}" fill="{fg}">Yonk’s <tspan fill="{AMBER}">PDF</tspan> Converter</text>'
            f'<text x="{cx}" y="{top + 1150 * s}" text-anchor="middle" font-family="Inter Display" font-style="italic" font-weight="500" font-size="{84 * s}" fill="{TEAL}">{SLOGAN}</text>'
            f'<text x="{cx}" y="{top + 1270 * s}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="{64 * s}" fill="{sub}" letter-spacing="{2 * s}">{SITE}</text>')

def png(svg_text, w, h=None):
    h = h or w
    out = subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h), "-f", "png"], input=svg_text.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(out)).convert("RGBA")

def save_svg_png(svg_text, name, w, h=None):
    (B / f"{name}.svg").write_text(svg_text, encoding="utf-8")
    png(svg_text, w, h).save(B / f"{name}.png", optimize=True)

def logo_page(w, h, dark=True):
    """Logo complet (symbole, nom, slogan, site) centré dans une page w×h."""
    s = min(w * 0.82 / 1530, h * 0.80 / 1290)
    top = (h - 1290 * s) / 2
    bg = BG + f'<rect width="{w}" height="{h}" fill="url(#bg)"/>' if dark else f'<rect width="{w}" height="{h}" fill="#F7F5EF"/>'
    return svg(w, h, bg + full_logo(w, h, w / 2, top, s, dark))

# 1) Icône d'application (PC, favicon, Android classique) : carré arrondi + symbole
icon = svg(1024, 1024, BG + '<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>' + mark(0.86, 72, 96))
icon_round = svg(1024, 1024, BG + '<circle cx="512" cy="512" r="512" fill="url(#bg)"/>' + mark(0.74, 133, 150))
save_svg_png(icon, "icon", 1024)
png(icon, 64).save(B / "icon-64.png", optimize=True)

# 2) Logo complet
save_svg_png(logo_page(1600, 1100), "logo-full", 1600, 1100)
save_svg_png(logo_page(1600, 1100, dark=False), "logo-full-light", 1600, 1100)

# 3) Application PC
png(icon, 1024).save(E / "icon.png", optimize=True)
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [png(icon, n) for n in sizes]
frames[-1].save(E / "icon.ico", format="ICO", sizes=[(n, n) for n in sizes], append_images=frames[:-1])

# 4) Application Android
if RES.exists():
    # avant-plan adaptatif : calque de 108 dp, symbole dans le cercle sûr central de 66 dp
    foreground = svg(1024, 1024, mark(0.6, 205, 222))
    background = svg(1024, 1024, BG + '<rect width="1024" height="1024" fill="url(#bg)"/>')
    for dpi, k in {"ldpi": 0.75, "mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        d = RES / f"mipmap-{dpi}"; d.mkdir(exist_ok=True)
        png(icon, round(48 * k)).save(d / "ic_launcher.png", optimize=True)
        png(icon_round, round(48 * k)).save(d / "ic_launcher_round.png", optimize=True)
        png(foreground, round(108 * k)).save(d / "ic_launcher_foreground.png", optimize=True)
        png(background, round(108 * k)).save(d / "ic_launcher_background.png", optimize=True)
    adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n')
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (RES / "mipmap-anydpi-v26" / name).write_text(adaptive, encoding="utf-8")
    (RES / "values" / "ic_launcher_background.xml").write_text(
        f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{INK}</color>\n</resources>\n', encoding="utf-8")
    # écrans de démarrage (avant Android 12) : chaque splash.png est régénéré à ses dimensions
    for f in RES.glob("drawable*/splash.png"):
        w, h = Image.open(f).size
        png(logo_page(w, h), w, h).convert("RGB").save(f, optimize=True)
print("branding OK")
