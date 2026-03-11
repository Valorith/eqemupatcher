const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  initialize: () => ipcRenderer.invoke("launcher:initialize"),
  getVersion: () => ipcRenderer.invoke("launcher:getVersion"),
  refreshState: () => ipcRenderer.invoke("launcher:refreshState"),
  startPatch: () => ipcRenderer.invoke("launcher:startPatch"),
  cancelPatch: () => ipcRenderer.invoke("launcher:cancelPatch"),
  launchGame: () => ipcRenderer.invoke("launcher:launchGame"),
  updateSettings: (patch) => ipcRenderer.invoke("launcher:updateSettings", patch),
  minimizeWindow: () => ipcRenderer.invoke("launcher:minimizeWindow"),
  closeWindow: () => ipcRenderer.invoke("launcher:closeWindow"),
  openExternal: (url) => ipcRenderer.invoke("launcher:openExternal", url),
  openConfigFile: () => ipcRenderer.invoke("launcher:openConfigFile"),
  openGameDirectory: () => ipcRenderer.invoke("launcher:openGameDirectory"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:event", listener);
    return () => ipcRenderer.removeListener("launcher:event", listener);
  }
});
