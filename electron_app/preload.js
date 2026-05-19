const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Send a command to Python
  sendToPython: (msg) => ipcRenderer.send("py-send", msg),

  // Listen for messages from Python
  onPyMessage: (callback) => {
    ipcRenderer.on("py-message", (_event, msg) => callback(msg));
  },

  // Open native file dialog
  openFileDialog: (opts) => ipcRenderer.invoke("open-file-dialog", opts),

  // Window controls
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close:    () => ipcRenderer.send("window-close"),
});
