// Couche plateforme : navigateur / application PC (Electron) / application Android (Capacitor).
import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const platform = isNative ? Capacitor.getPlatform() : /Electron\//.test(navigator.userAgent) ? "desktop" : "web";
const FOLDER = "Yonks PDF Converter";

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Enregistre un fichier.
 *  - navigateur / PC : téléchargement classique (le PC ouvre la boîte « Enregistrer sous »)
 *  - Android : écrit dans Documents/Yonks PDF Converter (repli : dossier privé de l'app)
 * @returns {Promise<{uri?: string, where: string}>}
 */
export async function saveFile(name, bytes, mime) {
  if (!isNative) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { where: "Téléchargements" };
  }
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const data = toBase64(bytes);
  try {
    const perm = await Filesystem.checkPermissions().catch(() => null);
    if (perm && perm.publicStorage !== "granted") await Filesystem.requestPermissions().catch(() => null);
    const r = await Filesystem.writeFile({ path: `${FOLDER}/${name}`, data, directory: Directory.Documents, recursive: true });
    return { uri: r.uri, where: `Documents/${FOLDER}` };
  } catch (e) {
    const r = await Filesystem.writeFile({ path: `exports/${name}`, data, directory: Directory.Cache, recursive: true });
    return { uri: r.uri, where: "l'application (utilisez Partager pour l'envoyer ou l'ouvrir)" };
  }
}

/** Ouvre la feuille de partage Android (Word, Drive, WhatsApp, e-mail…). */
export async function shareFile(uri, name) {
  const { Share } = await import("@capacitor/share");
  await Share.share({ title: name, files: [uri], dialogTitle: `Ouvrir ou partager ${name}` });
}

/** Demande de mot de passe dans l'interface (window.prompt n'existe pas dans l'application PC). */
export function askPassword(fileName, wrong) {
  const dlg = document.getElementById("pwdDialog");
  const form = dlg.querySelector("form");
  const input = dlg.querySelector("input");
  dlg.querySelector(".pwd-file").textContent = fileName;
  dlg.querySelector(".pwd-error").hidden = !wrong;
  input.value = "";
  return new Promise((resolve) => {
    const done = (value) => { form.removeEventListener("submit", onSubmit); dlg.removeEventListener("cancel", onCancel); cancelBtn.removeEventListener("click", onCancel); dlg.close(); resolve(value); };
    const onSubmit = (e) => { e.preventDefault(); done(input.value); };
    const onCancel = (e) => { e.preventDefault(); done(null); };
    const cancelBtn = dlg.querySelector(".pwd-cancel");
    form.addEventListener("submit", onSubmit);
    dlg.addEventListener("cancel", onCancel);
    cancelBtn.addEventListener("click", onCancel);
    dlg.showModal();
    input.focus();
  });
}
