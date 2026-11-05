# Yonk's PDF Converter

Convertisseur **PDF → Word (.docx), OpenDocument (.odt), RTF, Word 97-2003 (.doc) et texte (.txt)**
qui fonctionne **entièrement dans le navigateur**. Open source, aucune clé API, aucun serveur :
vos fichiers ne quittent jamais votre ordinateur.

Un projet **YONK'S LABS**.

## Ce que fait la conversion

Ce n'est pas une simple extraction de texte : le document Word produit reprend la structure du PDF.

| Élément du PDF | Dans le document produit |
|---|---|
| Texte | Paragraphes réels et modifiables (les retours à la ligne du PDF sont fusionnés, césures recollées) |
| Styles | Police, taille, **gras**, *italique*, couleur, alignement (gauche, centré, droite, justifié), retraits, interlignes |
| Titres | Repérés et navigables dans le volet de navigation de Word |
| Images (photos, logos) | Extraites avec leurs **pixels d'origine** (transparence comprise) et placées à leur emplacement |
| Graphiques vectoriels, aplats de couleur | Restitués en image nette à leur place |
| Équations mathématiques | Restituées en image nette (une formule ne s'écrit pas en texte linéaire) |
| Tableaux à bordures | **Vrais tableaux Word** : bordures, cellules fusionnées, fonds de cellule, texte modifiable |
| Colonnes, image à côté du texte | Reconstruites avec des tableaux invisibles, dans l'ordre de lecture |
| Bandeaux et fonds colorés | Trame de paragraphe, couleur de fond de page |
| Scans | Conservés en image ; si le scan contient une couche OCR, le texte reconnu est récupéré |
| Pages tournées, paysage | Redressées automatiquement |
| PDF protégés | Le mot de passe est demandé |

Deux modes :

- **Éditable** (par défaut) : tout ce qui est décrit ci-dessus.
- **Mise en page exacte** : chaque page devient une image haute définition, identique au PDF
  (non modifiable) — utile pour les maquettes très graphiques.

## Utilisation

**Sans rien installer** : téléchargez [`release/yonks-pdf-converter.html`](release/yonks-pdf-converter.html)
et ouvrez-le en double-cliquant (Chrome, Edge, Firefox, Safari). Déposez vos PDF, choisissez le
format, cliquez sur **Convertir**. Plusieurs fichiers à la fois, téléchargement groupé en .zip.

**En développement** :

```bash
npm install
npm run dev        # serveur local avec rechargement
npm run build      # dist/index.html + release/yonks-pdf-converter.html (fichier unique autonome)
npm test           # tests de bout en bout dans Chrome (après npm run build)
```

## Mise en ligne

Le build est **un seul fichier HTML statique** : il se publie partout.

### Hostinger — hébergement Web / Cloud (mutualisé)

1. `npm run build` (ou prenez directement `release/yonks-pdf-converter.html`).
2. hPanel → **Gestionnaire de fichiers** → dossier `public_html` (ou un sous-dossier, ex. `pdf`).
3. Téléversez le fichier et **renommez-le `index.html`**. C'est tout.

### Hostinger — « Web App » (import Node.js / GitHub)

Le projet est une application **Vite** reconnue par l'importateur Hostinger :
importez ce dépôt GitHub (ou un .zip dont la racine contient `package.json`), avec
- commande de build : `npm run build`
- dossier de sortie : `dist`

> L'ancien message « Framework non pris en charge » venait de la version Python/Docker du projet,
> que cet importateur ne gère pas. Cette version n'a plus de backend.

### VPS (Nginx)

```bash
npm ci && npm run build
sudo cp dist/index.html /var/www/html/index.html
```

### GitHub Pages

Le workflow `.github/workflows/ci.yml` construit, teste et publie le site. Activez-le dans
**Settings → Pages → Source : GitHub Actions**.

## Architecture

```
src/
  core/                 moteur, indépendant du navigateur
    analyze.js          lecture d'une page : texte stylé, couleurs, images d'origine, tracés,
                        tableaux, fonds, équations, détection d'orientation
    layout.js           lignes → paragraphes → zones (découpage XY : colonnes, ordre de lecture),
                        alignements, retraits, trames, construction des tableaux
    convert.js          orchestration, marges, mode « mise en page exacte »
    writers/            docx.js · odt.js · rtf.js (sert aussi pour .doc) · txt.js
  env/browser.js        pdf.js + worker embarqué
  main.js               interface
tests/
  make_fixtures.py      génère les PDF de test (texte stylé, images, scan, colonnes, tableau,
                        export Word, PDF protégé, page tournée)
  browser-test.mjs      test de bout en bout dans Chrome (interface + tous formats × modes)
  validate.py           rouvre chaque fichier produit dans LibreOffice, contrôle texte, images,
                        tableaux, styles, et génère des planches « original | converti »
```

Bibliothèques : [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla, Apache-2.0) et
[JSZip](https://stuk.github.io/jszip/) (MIT). Les fichiers Word sont écrits directement au format
Office Open XML et ont été validés contre les schémas XSD officiels.

Seule requête réseau possible : si un PDF utilise une police PDF standard non incluse, pdf.js peut
télécharger sa définition depuis jsDelivr pour le rendu des graphiques. Aucun contenu de vos
documents n'est transmis.

## Limites connues

- Les PDF scannés **sans** couche OCR restent des images (pas de reconnaissance de caractères intégrée).
- Les tableaux dessinés sans bordures sont reconstruits comme du texte en colonnes, pas comme un tableau Word.
- Le format `.doc` est produit en RTF, que Word et LibreOffice ouvrent comme un document Word normal.
- Les documents mélangeant pages portrait et paysage prennent le format de la première page.

## Licence

MIT — voir [LICENSE](LICENSE).
