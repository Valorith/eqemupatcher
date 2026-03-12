const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fileListBuilder", {
  initialize: () => ipcRenderer.invoke("filelistbuilder:initialize"),
  getVersion: () => ipcRenderer.invoke("filelistbuilder:getVersion"),
  refreshState: () => ipcRenderer.invoke("filelistbuilder:refreshState"),
  chooseWorkingDirectory: () => ipcRenderer.invoke("filelistbuilder:chooseWorkingDirectory"),
  updateDraft: (patch) => ipcRenderer.invoke("filelistbuilder:updateDraft", patch),
  saveDraftFiles: () => ipcRenderer.invoke("filelistbuilder:saveDraftFiles"),
  generate: () => ipcRenderer.invoke("filelistbuilder:generate"),
  minimizeWindow: () => ipcRenderer.invoke("filelistbuilder:minimizeWindow"),
  closeWindow: () => ipcRenderer.invoke("filelistbuilder:closeWindow"),
  openExternal: (url) => ipcRenderer.invoke("filelistbuilder:openExternal", url),
  openPath: (key) => ipcRenderer.invoke("filelistbuilder:openPath", key),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("filelistbuilder:event", listener);
    return () => ipcRenderer.removeListener("filelistbuilder:event", listener);
  }
});
