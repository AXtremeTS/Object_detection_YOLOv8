const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Main app ──────────────────────────────────────────────────────────
  sendToPython:   (msg)  => ipcRenderer.send("py-send", msg),
  onPyMessage:    (cb)   => ipcRenderer.on("py-message", (_e, msg) => cb(msg)),
  openFileDialog: (opts) => ipcRenderer.invoke("open-file-dialog", opts),
  minimize:  () => ipcRenderer.send("window-minimize"),
  maximize:  () => ipcRenderer.send("window-maximize"),
  close:     () => ipcRenderer.send("window-close"),

  // ── Setup window ──────────────────────────────────────────────────────
  detectPythons:  ()     => ipcRenderer.invoke("detect-pythons"),
  browsePython:   ()     => ipcRenderer.invoke("browse-python"),
  saveConfig:     (data) => ipcRenderer.invoke("save-config", data),
  getConfigPath:  ()     => ipcRenderer.invoke("get-config-path"),
  setupComplete:  ()     => ipcRenderer.send("setup-complete"),
});
