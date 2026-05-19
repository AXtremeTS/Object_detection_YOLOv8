const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path  = require("path");
const { spawn } = require("child_process");

let mainWindow;
let pyProcess = null;
let pendingCallbacks = {};   // not used — we broadcast all messages

// ── Spawn Python backend ──────────────────────────────────────────────────────
function startPython() {
  const backendPath = path.join(__dirname, "..", "ui_backend.py");
  // Use Python 3.11 where ultralytics is installed
  const pythonExe = "C:\\Users\\axtre\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";
  pyProcess = spawn(pythonExe, [backendPath], {
    cwd: path.join(__dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });

  pyProcess.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("py-message", msg);
        }
      } catch (e) {
        console.error("[main] JSON parse error:", e.message, "| raw:", line.slice(0, 120));
      }
    }
  });

  pyProcess.stderr.on("data", (d) => {
    console.error("[python]", d.toString().trim());
  });

  pyProcess.on("close", (code) => {
    console.log("[main] Python process exited with code", code);
    pyProcess = null;
  });
}

// ── IPC: renderer → python ────────────────────────────────────────────────────
ipcMain.on("py-send", (_event, msg) => {
  if (!pyProcess) return;
  pyProcess.stdin.write(JSON.stringify(msg) + "\n");
});

// ── IPC: open file dialog ─────────────────────────────────────────────────────
ipcMain.handle("open-file-dialog", async (_event, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result;
});

// ── IPC: window controls ──────────────────────────────────────────────────────
ipcMain.on("window-minimize", () => mainWindow && mainWindow.minimize());
ipcMain.on("window-maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("window-close", () => mainWindow && mainWindow.close());

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0f1117",
    titleBarStyle: "hidden",
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("closed", () => {
    if (pyProcess) pyProcess.kill();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startPython();
  createWindow();
});

app.on("window-all-closed", () => {
  if (pyProcess) pyProcess.kill();
  app.quit();
});
