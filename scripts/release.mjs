// Copie le build autonome dans release/ : un seul fichier HTML à ouvrir en double-clic.
import fs from "fs";
fs.mkdirSync("release", { recursive: true });
fs.copyFileSync("dist/index.html", "release/yonks-pdf-converter.html");
const kb = Math.round(fs.statSync("release/yonks-pdf-converter.html").size / 1024);
console.log(`release/yonks-pdf-converter.html (${kb} Ko) prêt.`);
