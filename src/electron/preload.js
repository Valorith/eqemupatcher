const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  initialize: () => ipcRenderer.invoke("launcher:initialize"),
  getVersion: () => ipcRenderer.invoke("launcher:getVersion"),
  refreshState: () => ipcRenderer.invoke("launcher:refreshState"),
  refreshServerStatus: () => ipcRenderer.invoke("launcher:refreshServerStatus"),
  setActiveLoginServer: (options) => ipcRenderer.invoke("launcher:setActiveLoginServer", options),
  getPatchNotes: (options) => ipcRenderer.invoke("launcher:getPatchNotes", options),
  checkForLauncherUpdate: (options) => ipcRenderer.invoke("launcher:checkForLauncherUpdate", options),
  startLauncherUpdateDownload: () => ipcRenderer.invoke("launcher:startLauncherUpdateDownload"),
  applyLauncherUpdate: () => ipcRenderer.invoke("launcher:applyLauncherUpdate"),
  getUiManagerOverview: () => ipcRenderer.invoke("launcher:getUiManagerOverview"),
  openUiManagerImportDialog: () => ipcRenderer.invoke("launcher:openUiManagerImportDialog"),
  importUiPackageFolder: (sourcePath) => ipcRenderer.invoke("launcher:importUiPackageFolder", sourcePath),
  prepareUiPackage: (packageName) => ipcRenderer.invoke("launcher:prepareUiPackage", packageName),
  validateUiPackageOptionComments: (packageName) => ipcRenderer.invoke("launcher:validateUiPackageOptionComments", packageName),
  checkUiPackageMetadata: (packageName) => ipcRenderer.invoke("launcher:checkUiPackageMetadata", packageName),
  getUiPackageDetails: (packageName) => ipcRenderer.invoke("launcher:getUiPackageDetails", packageName),
  activateUiOption: (options) => ipcRenderer.invoke("launcher:activateUiOption", options),
  setUiSkinTargets: (options) => ipcRenderer.invoke("launcher:setUiSkinTargets", options),
  resetUiPackage: (packageName) => ipcRenderer.invoke("launcher:resetUiPackage", packageName),
  listUiManagerBackups: (packageName) => ipcRenderer.invoke("launcher:listUiManagerBackups", packageName),
  restoreUiManagerBackup: (options) => ipcRenderer.invoke("launcher:restoreUiManagerBackup", options),
  startPatch: () => ipcRenderer.invoke("launcher:startPatch"),
  cancelPatch: () => ipcRenderer.invoke("launcher:cancelPatch"),
  launchGame: () => ipcRenderer.invoke("launcher:launchGame"),
  installMissingPrerequisites: () => ipcRenderer.invoke("launcher:installMissingPrerequisites"),
  updateSettings: (patch) => ipcRenderer.invoke("launcher:updateSettings", patch),
  minimizeWindow: () => ipcRenderer.invoke("launcher:minimizeWindow"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("launcher:toggleMaximizeWindow"),
  closeWindow: () => ipcRenderer.invoke("launcher:closeWindow"),
  moveWindowForDrag: (dragState) => ipcRenderer.invoke("launcher:moveWindowForDrag", dragState),
  endWindowDrag: () => ipcRenderer.invoke("launcher:endWindowDrag"),
  openExternal: (url) => ipcRenderer.invoke("launcher:openExternal", url),
  openConfigFile: () => ipcRenderer.invoke("launcher:openConfigFile"),
  openGameDirectory: () => ipcRenderer.invoke("launcher:openGameDirectory"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:event", listener);
    return () => ipcRenderer.removeListener("launcher:event", listener);
  }
});
