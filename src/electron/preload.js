const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  initialize: () => ipcRenderer.invoke("launcher:initialize"),
  refreshState: () => ipcRenderer.invoke("launcher:refreshState"),
  chooseGameDirectory: () => ipcRenderer.invoke("launcher:chooseGameDirectory"),
  startPatch: () => ipcRenderer.invoke("launcher:startPatch"),
  cancelPatch: () => ipcRenderer.invoke("launcher:cancelPatch"),
  launchGame: () => ipcRenderer.invoke("launcher:launchGame"),
  updateSettings: (patch) => ipcRenderer.invoke("launcher:updateSettings", patch),
  openExternal: (url) => ipcRenderer.invoke("launcher:openExternal", url),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:event", listener);
    return () => ipcRenderer.removeListener("launcher:event", listener);
  }
});
