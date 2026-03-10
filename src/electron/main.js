const path = require("path");
const { BrowserWindow, app, dialog, ipcMain, shell } = require("electron");
const { LauncherBackend } = require("./backend/launcher-backend");

let mainWindow = null;
let backend = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#071019",
    title: "EQEmu Launcher",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
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
    eventSink: emitToRenderer
  });
}

app.whenReady().then(async () => {
  await createBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle("launcher:initialize", async () => backend.initialize());
ipcMain.handle("launcher:refreshState", async () => backend.refreshState());
ipcMain.handle("launcher:startPatch", async () => backend.startPatch());
ipcMain.handle("launcher:cancelPatch", async () => backend.cancelPatch());
ipcMain.handle("launcher:launchGame", async () => backend.launchGame());
ipcMain.handle("launcher:updateSettings", async (_event, patch) => backend.updateSettings(patch));
ipcMain.handle("launcher:openExternal", async (_event, url) => {
  if (!url) {
    return false;
  }

  await shell.openExternal(url);
  return true;
});

ipcMain.handle("launcher:chooseGameDirectory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select EverQuest Directory",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return backend.getState();
  }

  return backend.setGameDirectory(result.filePaths[0]);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
