const path = require("path");
const { BrowserWindow, app, dialog, ipcMain, shell } = require("electron");
const { FileListBuilderBackend } = require("./backend/filelistbuilder-backend");

let mainWindow = null;
let backend = null;
const windowsIconPath = path.join(__dirname, "..", "electron", "assets", "icons", "icon-app.ico");
const defaultIconPath = path.join(__dirname, "..", "electron", "assets", "icons", "icon-app.png");

function resolveLaunchDirectory() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  return app.isPackaged ? path.dirname(app.getPath("exe")) : process.cwd();
}

function emitToRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("filelistbuilder:event", event);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1280,
    minHeight: 840,
    backgroundColor: "#071019",
    title: "EQEmu File List Builder",
    icon: process.platform === "win32" ? windowsIconPath : defaultIconPath,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.eqemu.filelistbuilder");
  }

  backend = new FileListBuilderBackend({
    appUserDataPath: app.getPath("userData"),
    launchDirectory: resolveLaunchDirectory(),
    eventSink: emitToRenderer
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle("filelistbuilder:initialize", async () => backend.initialize());
ipcMain.handle("filelistbuilder:getVersion", async () => app.getVersion());
ipcMain.handle("filelistbuilder:refreshState", async () => backend.refreshState());
ipcMain.handle("filelistbuilder:updateDraft", async (_event, patch) => backend.updateDraft(patch));
ipcMain.handle("filelistbuilder:saveDraftFiles", async () => backend.saveDraftFiles());
ipcMain.handle("filelistbuilder:generate", async () => backend.generate());
ipcMain.handle("filelistbuilder:minimizeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  mainWindow.minimize();
  return true;
});
ipcMain.handle("filelistbuilder:closeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  mainWindow.close();
  return true;
});
ipcMain.handle("filelistbuilder:chooseWorkingDirectory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: backend?.state?.workingDirectory || resolveLaunchDirectory()
  });

  if (result.canceled || !result.filePaths[0]) {
    return backend.getState();
  }

  return backend.setWorkingDirectory(result.filePaths[0]);
});
ipcMain.handle("filelistbuilder:openExternal", async (_event, url) => {
  if (!url) {
    return false;
  }

  await shell.openExternal(url);
  return true;
});
ipcMain.handle("filelistbuilder:openPath", async (_event, key) => {
  const openablePaths = backend.getOpenablePaths();
  const targetPath = openablePaths[key] || "";
  if (!targetPath) {
    return {
      ok: false,
      path: "",
      error: "Nothing is available to open for that action."
    };
  }

  const result = await shell.openPath(targetPath);
  return {
    ok: result === "",
    path: targetPath,
    error: result || ""
  };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
