const path = require("path");
const { BrowserWindow, app, dialog, ipcMain, screen, shell } = require("electron");
const { LauncherBackend } = require("./backend/launcher-backend");
const packageMetadata = require("../../package.json");

let mainWindow = null;
let backend = null;
let activeWindowDrag = null;
let autoLoginOverlayWindow = null;
let autoLoginOverlayStateKey = "";
let autoLoginOverlaySuccessHoldTimer = null;
let pendingAutoLoginOverlayState = null;
const windowsIconPath = path.join(__dirname, "assets", "icons", "icon-app.ico");
const defaultIconPath = path.join(__dirname, "assets", "icons", "icon-app.png");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const AUTO_LOGIN_OVERLAY_WIDTH = 560;
const AUTO_LOGIN_OVERLAY_HEIGHT = 76;
const AUTO_LOGIN_OVERLAY_MARGIN = 24;
const AUTO_LOGIN_OVERLAY_TOP_RATIO = 0.17;
const AUTO_LOGIN_OVERLAY_TRACK_PATH = "M 272 3 H 514 A 27 27 0 0 1 514 57 H 30 A 27 27 0 0 1 30 3 H 272";
const AUTO_LOGIN_OVERLAY_SUCCESS_HOLD_MS = 1500;

function resolveAppVersion() {
  const packageVersion = String(packageMetadata?.version || "").trim();
  if (packageVersion) {
    return packageVersion;
  }

  return app.getVersion();
}

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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeOverlayProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(progress)));
}

function normalizeOverlayTone(value) {
  return value === "success" ? "success" : "default";
}

function getAutoLoginOverlayHtml({ message, progress, tone }) {
  const safeProgress = normalizeOverlayProgress(progress);
  const progressOpacity = safeProgress > 0 ? "1" : "0";
  const toneClass = normalizeOverlayTone(tone) === "success" ? " is-success" : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
      font-family: "Segoe UI", Arial, sans-serif;
      user-select: none;
      -webkit-user-select: none;
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .status-shell {
      box-sizing: border-box;
      width: calc(100% - 16px);
      height: 60px;
      position: relative;
    }

    .status-pill {
      box-sizing: border-box;
      position: absolute;
      inset: 2px;
      padding: 0 34px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.91);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
    }

    .status-shell.is-success .status-pill {
      border-color: rgba(109, 226, 137, 0.58);
      background: rgba(7, 48, 28, 0.95);
      color: #f5fff7;
    }

    .status-track {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }

    .status-track path {
      fill: none;
      stroke-width: 4;
      vector-effect: non-scaling-stroke;
    }

    .status-track-base {
      stroke: rgba(255, 255, 255, 0.15);
    }

    .status-track-fill {
      opacity: ${progressOpacity};
      stroke: #6de289;
      stroke-linecap: round;
      stroke-dasharray: ${safeProgress} 100;
      transition: opacity 120ms ease, stroke 160ms ease, stroke-dasharray 180ms ease;
    }

    .status-shell.is-success .status-track-base {
      stroke: rgba(109, 226, 137, 0.24);
    }

    .status-shell.is-success .status-track-fill {
      stroke: #7cf49a;
    }
  </style>
</head>
<body>
  <div class="status-shell${toneClass}">
    <svg class="status-track" viewBox="0 0 544 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="status-track-base" d="${AUTO_LOGIN_OVERLAY_TRACK_PATH}" pathLength="100"></path>
      <path class="status-track-fill" d="${AUTO_LOGIN_OVERLAY_TRACK_PATH}" pathLength="100"></path>
    </svg>
    <div class="status-pill">${escapeHtml(message)}</div>
  </div>
</body>
</html>`;
}

function getAutoLoginOverlayDisplay() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return screen.getDisplayMatching(mainWindow.getBounds());
  }

  return screen.getPrimaryDisplay();
}

function getAutoLoginOverlayBounds() {
  const display = getAutoLoginOverlayDisplay();
  const area = display?.workArea || display?.bounds || {
    x: 0,
    y: 0,
    width: AUTO_LOGIN_OVERLAY_WIDTH + (AUTO_LOGIN_OVERLAY_MARGIN * 2),
    height: 480
  };
  const width = Math.min(
    AUTO_LOGIN_OVERLAY_WIDTH,
    Math.max(320, area.width - (AUTO_LOGIN_OVERLAY_MARGIN * 2))
  );
  const height = Math.min(
    AUTO_LOGIN_OVERLAY_HEIGHT,
    Math.max(56, area.height - (AUTO_LOGIN_OVERLAY_MARGIN * 2))
  );
  const minY = area.y + AUTO_LOGIN_OVERLAY_MARGIN;
  const maxY = area.y + area.height - height - AUTO_LOGIN_OVERLAY_MARGIN;
  const desiredY = area.y + Math.round((area.height * AUTO_LOGIN_OVERLAY_TOP_RATIO) - (height / 2));

  return {
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: Math.max(minY, Math.min(desiredY, Math.max(minY, maxY)))
  };
}

function clearAutoLoginOverlaySuccessHold() {
  if (autoLoginOverlaySuccessHoldTimer) {
    clearTimeout(autoLoginOverlaySuccessHoldTimer);
    autoLoginOverlaySuccessHoldTimer = null;
  }

  pendingAutoLoginOverlayState = null;
}

function closeAutoLoginOverlayWindow() {
  autoLoginOverlayStateKey = "";

  if (!autoLoginOverlayWindow || autoLoginOverlayWindow.isDestroyed()) {
    autoLoginOverlayWindow = null;
    return;
  }

  const overlayWindow = autoLoginOverlayWindow;
  autoLoginOverlayWindow = null;
  overlayWindow.destroy();
}

function closeAutoLoginOverlay() {
  clearAutoLoginOverlaySuccessHold();
  closeAutoLoginOverlayWindow();
}

function ensureAutoLoginOverlayWindow() {
  if (!app.isReady()) {
    return null;
  }

  if (autoLoginOverlayWindow && !autoLoginOverlayWindow.isDestroyed()) {
    return autoLoginOverlayWindow;
  }

  autoLoginOverlayWindow = new BrowserWindow({
    ...getAutoLoginOverlayBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    autoLoginOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {
    autoLoginOverlayWindow.setAlwaysOnTop(true);
  }

  try {
    autoLoginOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    autoLoginOverlayWindow.setIgnoreMouseEvents(true);
  }

  autoLoginOverlayWindow.setMenuBarVisibility(false);
  autoLoginOverlayWindow.on("closed", () => {
    autoLoginOverlayWindow = null;
  });

  return autoLoginOverlayWindow;
}

function showAutoLoginOverlay({ message, progress = 0, tone = "default" } = {}) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    closeAutoLoginOverlay();
    return;
  }
  const normalizedProgress = normalizeOverlayProgress(progress);
  const normalizedTone = normalizeOverlayTone(tone);
  const nextStateKey = `${normalizedMessage}|${normalizedProgress}|${normalizedTone}`;

  const overlayWindow = ensureAutoLoginOverlayWindow();
  if (!overlayWindow) {
    return;
  }

  overlayWindow.setBounds(getAutoLoginOverlayBounds(), false);
  if (autoLoginOverlayStateKey === nextStateKey && overlayWindow.isVisible()) {
    return;
  }

  autoLoginOverlayStateKey = nextStateKey;
  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getAutoLoginOverlayHtml({
    message: normalizedMessage,
    progress: normalizedProgress,
    tone: normalizedTone
  }))}`).then(() => {
    if (!overlayWindow.isDestroyed() && autoLoginOverlayStateKey === nextStateKey) {
      overlayWindow.setBounds(getAutoLoginOverlayBounds(), false);
      overlayWindow.showInactive();
    }
  }).catch(() => {});
}

function flushPendingAutoLoginOverlayState() {
  const pendingState = pendingAutoLoginOverlayState;
  pendingAutoLoginOverlayState = null;
  autoLoginOverlaySuccessHoldTimer = null;

  if (!pendingState || pendingState.close) {
    closeAutoLoginOverlayWindow();
    return;
  }

  showAutoLoginOverlay(pendingState);
}

function scheduleAutoLoginOverlayState(state) {
  if (!state?.message) {
    if (autoLoginOverlaySuccessHoldTimer) {
      pendingAutoLoginOverlayState = { close: true };
      return;
    }

    closeAutoLoginOverlay();
    return;
  }

  const normalizedState = {
    message: String(state.message || "").trim(),
    progress: normalizeOverlayProgress(state.progress),
    tone: normalizeOverlayTone(state.tone)
  };

  if (normalizedState.tone === "success") {
    if (autoLoginOverlaySuccessHoldTimer) {
      clearTimeout(autoLoginOverlaySuccessHoldTimer);
    }

    pendingAutoLoginOverlayState = null;
    showAutoLoginOverlay(normalizedState);
    autoLoginOverlaySuccessHoldTimer = setTimeout(
      flushPendingAutoLoginOverlayState,
      AUTO_LOGIN_OVERLAY_SUCCESS_HOLD_MS
    );
    return;
  }

  if (autoLoginOverlaySuccessHoldTimer) {
    pendingAutoLoginOverlayState = normalizedState;
    return;
  }

  showAutoLoginOverlay(normalizedState);
}

function syncAutoLoginOverlay(event) {
  if (event?.type !== "state") {
    return;
  }

  const payload = event.payload || {};
  const message = payload.isAutoLoginRunning ? payload.autoLoginOverlayText : "";
  if (message) {
    scheduleAutoLoginOverlayState({
      message,
      progress: payload.autoLoginOverlayProgress,
      tone: payload.autoLoginOverlayTone
    });
    return;
  }

  scheduleAutoLoginOverlayState({ close: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1280,
    minHeight: 820,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#071019",
    title: "EQEmu Launcher",
    icon: process.platform === "win32" ? windowsIconPath : defaultIconPath,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
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
    closeAutoLoginOverlay();
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function emitToRenderer(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    syncAutoLoginOverlay(event);
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("launcher:event", event);
}

async function handleGameLaunchWindowAction({ action } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (action === "close") {
    mainWindow.close();
    return true;
  }

  mainWindow.minimize();
  return true;
}

async function createBackend() {
  const runtimeExecutablePath = app.getPath("exe");

  backend = new LauncherBackend({
    appUserDataPath: app.getPath("userData"),
    projectRoot: path.resolve(__dirname, "..", ".."),
    launchDirectory: resolveLaunchDirectory(),
    runtimeDirectory: path.dirname(runtimeExecutablePath),
    eventSink: emitToRenderer,
    appVersion: resolveAppVersion(),
    executablePath: resolveLauncherExecutablePath(),
    processId: process.pid,
    relaunchArgs: process.argv.slice(1),
    isPackaged: app.isPackaged,
    onGameLaunched: handleGameLaunchWindowAction
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
ipcMain.handle("launcher:getVersion", async () => resolveAppVersion());
ipcMain.handle("launcher:refreshState", async () => backend.refreshState());
ipcMain.handle("launcher:refreshServerStatus", async () => backend.refreshServerStatus());
ipcMain.handle("launcher:setActiveLoginServer", async (_event, options) => backend.setActiveLoginServer(options || {}));
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
ipcMain.handle("launcher:getAutoLoginProfiles", async () => backend.getAutoLoginProfiles());
ipcMain.handle("launcher:selectAutoLoginProfile", async (_event, options) => backend.selectAutoLoginProfile(options || {}));
ipcMain.handle("launcher:saveAutoLoginProfile", async (_event, options) => backend.saveAutoLoginProfile(options || {}));
ipcMain.handle("launcher:deleteAutoLoginProfile", async (_event, options) => backend.deleteAutoLoginProfile(options || {}));
ipcMain.handle("launcher:launchAutoLoginProfile", async (_event, options) => backend.launchAutoLoginProfile(options || {}));
ipcMain.handle("launcher:launchAutoLoginProfiles", async (_event, options) => backend.launchAutoLoginProfiles(options || {}));
ipcMain.handle("launcher:installMissingPrerequisites", async () => backend.installMissingPrerequisites());
ipcMain.handle("launcher:updateSettings", async (_event, patch) => backend.updateSettings(patch));
ipcMain.handle("launcher:minimizeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.minimize();
  return true;
});
ipcMain.handle("launcher:toggleMaximizeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return true;
  }

  mainWindow.maximize();
  return true;
});
ipcMain.handle("launcher:closeWindow", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.close();
  return true;
});
ipcMain.handle("launcher:moveWindowForDrag", async (_event, dragState = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    activeWindowDrag = null;
    return false;
  }

  const startScreenX = Number(dragState.startScreenX);
  const startScreenY = Number(dragState.startScreenY);
  const currentScreenX = Number(dragState.currentScreenX);
  const currentScreenY = Number(dragState.currentScreenY);
  if (![startScreenX, startScreenY, currentScreenX, currentScreenY].every(Number.isFinite)) {
    return false;
  }

  if (!activeWindowDrag) {
    const bounds = mainWindow.getBounds();
    activeWindowDrag = {
      startX: bounds.x,
      startY: bounds.y
    };
  }

  const nextX = Math.round(activeWindowDrag.startX + currentScreenX - startScreenX);
  const nextY = Math.round(activeWindowDrag.startY + currentScreenY - startScreenY);
  mainWindow.setPosition(nextX, nextY, false);
  return true;
});
ipcMain.handle("launcher:endWindowDrag", async () => {
  activeWindowDrag = null;
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
