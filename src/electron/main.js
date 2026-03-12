const path = require("path");
const { BrowserWindow, app, ipcMain, shell } = require("electron");
const { LauncherBackend } = require("./backend/launcher-backend");

let mainWindow = null;
let backend = null;
const windowsIconPath = path.join(__dirname, "assets", "icons", "icon-app.ico");
const defaultIconPath = path.join(__dirname, "assets", "icons", "icon-app.png");

function resolveLaunchDirectory() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  return app.isPackaged ? path.dirname(app.getPath("exe")) : process.cwd();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#071019",
    title: "EQEmu Launcher",
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

  if (process.platform === "win32") {
    mainWindow.setIcon(windowsIconPath);
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function emitToRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("launcher:event", event);
}

async function createBackend() {
  backend = new LauncherBackend({
    appUserDataPath: app.getPath("userData"),
    projectRoot: path.resolve(__dirname, "..", ".."),
    launchDirectory: resolveLaunchDirectory(),
    runtimeDirectory: path.dirname(app.getPath("exe")),
    eventSink: emitToRenderer
  });
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.eqemu.launcher");
  }

  await createBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle("launcher:initialize", async () => backend.initialize());
ipcMain.handle("launcher:getVersion", async () => app.getVersion());
ipcMain.handle("launcher:refreshState", async () => backend.refreshState());
ipcMain.handle("launcher:getPatchNotes", async (_event, options) => backend.getPatchNotes(options || {}));
ipcMain.handle("launcher:startPatch", async () => backend.startPatch());
ipcMain.handle("launcher:cancelPatch", async () => backend.cancelPatch());
ipcMain.handle("launcher:launchGame", async () => backend.launchGame());
ipcMain.handle("launcher:updateSettings", async (_event, patch) => backend.updateSettings(patch));
ipcMain.handle("launcher:minimizeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.minimize();
  return true;
});
ipcMain.handle("launcher:closeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.close();
  return true;
});
ipcMain.handle("launcher:openExternal", async (_event, url) => {
  if (!url) {
    return false;
  }

  await shell.openExternal(url);
  return true;
});
ipcMain.handle("launcher:openConfigFile", async () => {
  const configPath = await backend.getResolvedConfigPath();
  const result = await shell.openPath(configPath);
  return {
    ok: result === "",
    path: configPath,
    error: result || ""
  };
});
ipcMain.handle("launcher:openGameDirectory", async () => {
  const gameDirectory = backend?.state?.gameDirectory || "";
  if (!gameDirectory) {
    return {
      ok: false,
      path: "",
      error: "No game directory is currently selected."
    };
  }

  const result = await shell.openPath(gameDirectory);
  return {
    ok: result === "",
    path: gameDirectory,
    error: result || ""
  };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
