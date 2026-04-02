const path = require("path");
const { BrowserWindow, app, dialog, ipcMain, shell } = require("electron");
const { LauncherBackend } = require("./backend/launcher-backend");

let mainWindow = null;
let backend = null;
const windowsIconPath = path.join(__dirname, "assets", "icons", "icon-app.ico");
const defaultIconPath = path.join(__dirname, "assets", "icons", "icon-app.png");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function resolveLaunchDirectory() {
  if (process.env.EQEMU_LAUNCH_DIR) {
    return process.env.EQEMU_LAUNCH_DIR;
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  return app.isPackaged ? path.dirname(app.getPath("exe")) : process.cwd();
}

function resolveLauncherExecutablePath() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return process.env.PORTABLE_EXECUTABLE_FILE;
  }

  return app.getPath("exe");
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
  const runtimeExecutablePath = app.getPath("exe");

  backend = new LauncherBackend({
    appUserDataPath: app.getPath("userData"),
    projectRoot: path.resolve(__dirname, "..", ".."),
    launchDirectory: resolveLaunchDirectory(),
    runtimeDirectory: path.dirname(runtimeExecutablePath),
    eventSink: emitToRenderer,
    appVersion: app.getVersion(),
    executablePath: resolveLauncherExecutablePath(),
    processId: process.pid,
    relaunchArgs: process.argv.slice(1),
    isPackaged: app.isPackaged
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });
}

if (hasSingleInstanceLock) {
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
}

ipcMain.handle("launcher:initialize", async () => backend.initialize());
ipcMain.handle("launcher:getVersion", async () => app.getVersion());
ipcMain.handle("launcher:refreshState", async () => backend.refreshState());
ipcMain.handle("launcher:getPatchNotes", async (_event, options) => backend.getPatchNotes(options || {}));
ipcMain.handle("launcher:checkForLauncherUpdate", async (_event, options) => backend.checkForLauncherUpdate(options || {}));
ipcMain.handle("launcher:startLauncherUpdateDownload", async () => backend.startLauncherUpdateDownload());
ipcMain.handle("launcher:applyLauncherUpdate", async () => {
  const result = await backend.applyLauncherUpdate();
  if (result?.ok && result?.shouldQuit) {
    setImmediate(() => {
      app.quit();
    });
  }
  return result;
});
ipcMain.handle("launcher:getUiManagerOverview", async () => backend.getUiManagerOverview());
ipcMain.handle("launcher:openUiManagerImportDialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import UI Package Folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return {
      canceled: true,
      sourcePath: ""
    };
  }

  return {
    canceled: false,
    sourcePath: result.filePaths[0]
  };
});
ipcMain.handle("launcher:importUiPackageFolder", async (_event, sourcePath) => backend.importUiPackageFolder(sourcePath));
ipcMain.handle("launcher:prepareUiPackage", async (_event, packageName) => backend.prepareUiPackage(packageName));
ipcMain.handle("launcher:validateUiPackageOptionComments", async (_event, packageName) => backend.validateUiPackageOptionComments(packageName));
ipcMain.handle("launcher:checkUiPackageMetadata", async (_event, packageName) => backend.checkUiPackageMetadata(packageName));
ipcMain.handle("launcher:getUiPackageDetails", async (_event, packageName) => backend.getUiPackageDetails(packageName));
ipcMain.handle("launcher:activateUiOption", async (_event, options) => backend.activateUiOption(options || {}));
ipcMain.handle("launcher:setUiSkinTargets", async (_event, options) => backend.setUiSkinTargets(options || {}));
ipcMain.handle("launcher:resetUiPackage", async (_event, packageName) => backend.resetUiPackage(packageName));
ipcMain.handle("launcher:listUiManagerBackups", async (_event, packageName) => backend.listUiManagerBackups(packageName));
ipcMain.handle("launcher:restoreUiManagerBackup", async (_event, options) => backend.restoreUiManagerBackup(options || {}));
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
