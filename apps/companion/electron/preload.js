const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codeon", {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("save-settings", s),
  login: (opts) => ipcRenderer.invoke("login", opts),
  sync: (opts) => ipcRenderer.invoke("sync", opts),
  checkConnection: (opts) => ipcRenderer.invoke("checkConnection", opts),
  validateHandle: (opts) => ipcRenderer.invoke("validate-handle", opts),
  checkLoginStatus: (opts) => ipcRenderer.invoke("check-login-status", opts),
  clearLocalData: () => ipcRenderer.invoke("clear-local-data"),
  onStatus: (cb) => ipcRenderer.on("status", (_, msg) => cb(msg)),
  onAutoSync: (cb) => ipcRenderer.on("auto-sync", () => cb()),
});
