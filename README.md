<p align="center"><img src="branding/logo-full.png" alt="Yonk's PDF Converter" width="560"></p>

# Yonk's PDF Converter

Convertisseur **PDF → Word (.docx), OpenDocument (.odt), RTF, Word 97-2003 (.doc) et texte (.txt)**,
disponible **en page web, en application PC (Windows, Linux) et en application Android**.
Open source, aucune clé API, aucun serveur : vos fichiers ne quittent jamais votre appareil.

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

## Applications PC et Android

Les applications sont compilées automatiquement par **GitHub Actions** (`.github/workflows/apps.yml`)
et publiées dans les [Releases](https://github.com/CapoFabrizio/Yonks-PDF-Conventer/releases) :

| Plateforme | Fichier | Installation |
|---|---|---|
| Windows | `…-windows-setup.exe` | Installateur (raccourcis Bureau et menu Démarrer). Windows peut afficher « Windows a protégé votre ordinateur » car l'application n'est pas signée : *Informations complémentaires → Exécuter quand même*. |
| Windows | `…-windows-portable.exe` | Aucune installation : double-cliquez. |
| Linux | `…-linux-x86_64.AppImage` | `chmod +x` puis lancez-le. |
| Linux | `…-linux-amd64.deb` | `sudo apt install ./fichier.deb` |
| Android | `…-android.apk` | Ouvrez le fichier sur le téléphone et autorisez l'installation depuis cette source. |

- La release **`latest`** est recompilée à chaque push sur `main` ; un tag `vX.Y.Z` crée une release versionnée.
- Sur Android, **Enregistrer** place le document dans `Documents/Yonks PDF Converter`, et
  **Partager / ouvrir** l'envoie vers Word, Google Docs, Drive, WhatsApp, un e-mail…
- Sur PC, **Télécharger** ouvre la boîte « Enregistrer sous » (dossier Téléchargements par défaut).

### Technologies

- **Android** : [Capacitor 8](https://capacitorjs.com) (MIT), plugins officiels Filesystem et Share.
- **PC** : [Electron](https://www.electronjs.org) (MIT) et electron-builder. Capacitor ne cible pas le
  bureau officiellement, et son plugin communautaire Electron est abandonné (incompatible avec Capacitor 8) :
  les deux applications partagent donc le même code web, l'une via Capacitor, l'autre via Electron.

### Signature Android

Sans configuration, l'APK est signé avec la clé de test **publique** `android/keystore/yonks-test.jks` :
il s'installe et se met à jour par-dessus la version précédente, mais cette clé n'est pas secrète.
Pour une diffusion publique ou le **Play Store**, créez votre propre clé et ajoutez-la dans
*Settings → Secrets and variables → Actions* ; le workflow produira alors aussi un `.aab` :

```bash
keytool -genkeypair -keystore release.jks -storetype PKCS12 -alias yonks -keyalg RSA -keysize 2048 -validity 10950
base64 -w0 release.jks   # valeur du secret ANDROID_KEYSTORE_BASE64
```

Secrets : `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Conservez `release.jks` précieusement : sans elle, impossible de publier une mise à jour.

### Compiler en local

```bash
npm run desktop          # lancer l'application PC en développement
npm run desktop:win      # empaqueter pour Windows (après npm run build)
npm run desktop:linux    # empaqueter pour Linux
npm run android:apk      # APK Android (nécessite Android Studio / le SDK Android et Java 21)
npm run branding         # régénérer logo, icônes PC/Android et écrans de démarrage
```

**En développement (web)** :

```bash
npm install
npm run dev        # serveur local avec rechargement
npm run build      # dist/index.html + release/yonks-pdf-converter.html (fichier unique autonome)
npm test           # tests de bout en bout dans Chrome (après npm run build)
npm run test:desktop   # test de l'application PC (fenêtre réelle) ; APP_PATH=… pour l'exécutable empaqueté
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
  platform.js           différences web / PC / Android (enregistrement, partage, mot de passe)
  main.js               interface
electron/main.cjs       fenêtre de l'application PC (isolée de Node.js, liens externes, téléchargements)
android/                projet Android Capacitor (icônes, écrans de démarrage, signature)
branding/               logo et générateur de toutes les icônes (make_branding.py)
.github/workflows/      ci.yml (tests + site GitHub Pages) · apps.yml (PC + Android + Releases)
tests/
  make_fixtures.py      génère les PDF de test (texte stylé, images, scan, colonnes, tableau,
                        export Word, PDF protégé, page tournée)
  browser-test.mjs      test de bout en bout dans Chrome (interface + tous formats × modes)
  desktop-smoke.mjs     test de l'application PC empaquetée (interface, mot de passe, téléchargement)
  validate.py           rouvre chaque fichier produit dans LibreOffice, contrôle texte, images,
                        tableaux, styles, et génère des planches « original | converti »
```

Logo : création originale YONK'S LABS (`branding/`).

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
