// Application PC (Windows, macOS, Linux) : fenêtre Electron qui charge le build autonome dist/index.html.
// Aucune intégration Node dans la page : la conversion reste 100 % locale dans le moteur web.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 880, minWidth: 380, minHeight: 560,
    title: "Yonk's PDF Converter",
    backgroundColor: "#0f1719",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // Liens externes (pied de page) : navigateur par défaut, jamais dans la fenêtre de l'application.
  const external = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) { e.preventDefault(); external(url); } });
  // Téléchargements (Télécharger .docx, .zip) : boîte « Enregistrer sous » du système, dossier
  // Téléchargements proposé par défaut. YONKS_DOWNLOAD_DIR (tests automatisés) enregistre sans boîte.
  win.webContents.session.on("will-download", (_e, item) => {
    const name = item.getFilename();
    if (process.env.YONKS_DOWNLOAD_DIR) {
      item.setSavePath(path.join(process.env.YONKS_DOWNLOAD_DIR, name));
      return;
    }
    item.setSaveDialogOptions({
      title: "Enregistrer le document converti",
      defaultPath: path.join(app.getPath("downloads"), name),
      buttonLabel: "Enregistrer",
    });
  });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
