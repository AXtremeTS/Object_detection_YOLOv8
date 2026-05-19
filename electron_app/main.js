const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path   = require("path");
const fs     = require("fs");
const os     = require("os");
const { spawn, execSync } = require("child_process");

let mainWindow  = null;
let setupWindow = null;
let pyProcess   = null;

// ── Config file location ──────────────────────────────────────────────────────
// Dev:      <project_root>/python_config.json
// Packaged: C:\Users\<user>\AppData\Roaming\YOLOv8sDetector\python_config.json
function getConfigPath() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "python_config.json");
  }
  return path.join(__dirname, "..", "python_config.json");
}

function readConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function writeConfig(data) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

// ── Detect installed Python versions ─────────────────────────────────────────
function detectPythons() {
  const found = [];
  const seen  = new Set();

  function tryExe(exe) {
    if (seen.has(exe)) return;
    seen.add(exe);
    try {
      const ver = execSync(`"${exe}" --version`, { timeout: 3000 }).toString().trim();
      // Check ultralytics is available
      let hasUltralytics = false;
      try {
        execSync(`"${exe}" -c "import ultralytics"`, { timeout: 5000 });
        hasUltralytics = true;
      } catch {}
      found.push({ exe, version: ver, hasUltralytics });
    } catch {}
  }

  // 1. py launcher (Windows) — lists all installed versions
  try {
    const pyList = execSync("py -0p", { timeout: 5000 }).toString();
    pyList.split("\n").forEach(line => {
      const m = line.match(/([A-Z]:[^\s]+python\.exe)/i);
      if (m) tryExe(m[1].trim());
    });
  } catch {}

  // 2. Common install locations on Windows
  const drives = ["C:", "D:"];
  const bases  = [
    "\\Python3{v}\\python.exe",
    "\\Python{v}\\python.exe",
    "\\Users\\" + os.userInfo().username + "\\AppData\\Local\\Programs\\Python\\Python3{v}\\python.exe",
    "\\Users\\" + os.userInfo().username + "\\AppData\\Local\\Programs\\Python\\Python{v}\\python.exe",
  ];
  const minors = ["14","13","12","11","10","9","8"];
  for (const drive of drives) {
    for (const tpl of bases) {
      for (const v of minors) {
        tryExe(drive + tpl.replace(/\{v\}/g, v));
      }
    }
  }

  // 3. PATH — try generic names
  ["python", "python3", "python3.11", "python3.12"].forEach(name => {
    try {
      const resolved = execSync(`where ${name}`, { timeout: 3000 })
        .toString().split("\n")[0].trim();
      if (resolved) tryExe(resolved);
    } catch {}
  });

  // 4. Conda environments
  try {
    const condaInfo = execSync("conda info --envs --json", { timeout: 5000 }).toString();
    const envs = JSON.parse(condaInfo).envs || [];
    envs.forEach(envPath => {
      tryExe(path.join(envPath, "python.exe"));
      tryExe(path.join(envPath, "Scripts", "python.exe"));
    });
  } catch {}

  return found;
}

// ── Setup window ──────────────────────────────────────────────────────────────
function openSetupWindow() {
  setupWindow = new BrowserWindow({
    width:  680,
    height: 560,
    resizable: false,
    backgroundColor: "#0f1117",
    titleBarStyle: "hidden",
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWindow.loadFile(path.join(__dirname, "renderer", "setup.html"));

  setupWindow.on("closed", () => {
    setupWindow = null;
    // If main window never opened, quit
    if (!mainWindow) app.quit();
  });
}

// ── IPC: setup window requests ────────────────────────────────────────────────
ipcMain.handle("detect-pythons", () => detectPythons());

ipcMain.handle("browse-python", async () => {
  const result = await dialog.showOpenDialog(setupWindow, {
    title: "Select Python Executable",
    filters: [{ name: "Python", extensions: ["exe"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const exe = result.filePaths[0];
  // Validate it
  try {
    const ver = execSync(`"${exe}" --version`, { timeout: 3000 }).toString().trim();
    let hasUltralytics = false;
    try { execSync(`"${exe}" -c "import ultralytics"`, { timeout: 5000 }); hasUltralytics = true; } catch {}
    return { exe, version: ver, hasUltralytics };
  } catch {
    return { exe, version: "Unknown", hasUltralytics: false };
  }
});

ipcMain.handle("save-config", (_event, data) => {
  writeConfig(data);
  return getConfigPath();
});

ipcMain.handle("get-config-path", () => getConfigPath());

ipcMain.on("setup-complete", () => {
  if (setupWindow) { setupWindow.close(); setupWindow = null; }
  launchMainApp();
});

// ── Main app ──────────────────────────────────────────────────────────────────
function startPython(pythonExe) {
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..");

  let proc;
  if (app.isPackaged) {
    const backendExe = path.join(process.resourcesPath, "ui_backend", "ui_backend.exe");
    proc = spawn(backendExe, [], { cwd: process.resourcesPath, stdio: ["pipe", "pipe", "pipe"] });
  } else {
    const backendPy = path.join(projectRoot, "ui_backend.py");
    proc = spawn(pythonExe, [backendPy], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
  }

  pyProcess = proc;

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

  pyProcess.stderr.on("data", (d) => console.error("[python]", d.toString().trim()));
  pyProcess.on("close", (code) => { console.log("[main] Python exited:", code); pyProcess = null; });
}

function launchMainApp() {
  const config = readConfig();
  const pythonExe = config?.pythonExe || null;

  startPython(pythonExe);

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

// ── IPC: main app ─────────────────────────────────────────────────────────────
ipcMain.on("py-send", (_event, msg) => {
  if (!pyProcess) return;
  pyProcess.stdin.write(JSON.stringify(msg) + "\n");
});

ipcMain.handle("open-file-dialog", async (_event, opts) => {
  return dialog.showOpenDialog(mainWindow, opts);
});

ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());

// ── Startup ───────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const config = readConfig();
  if (!config || !config.pythonExe) {
    openSetupWindow();
  } else {
    launchMainApp();
  }
});

app.on("window-all-closed", () => {
  if (pyProcess) pyProcess.kill();
  app.quit();
});
