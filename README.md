# YOLOv8s Object Detector — Desktop App

A desktop application built with **Electron + Tailwind CSS** that uses **YOLOv8s** to detect objects in images, videos, and live webcam feeds.

---

## Features

- **Image tab** — drag & drop or browse an image, run detection, click label tags to hide/show specific object classes
- **Video tab** — drag & drop a video file, play/pause/continue, seek to any position, real-time annotated frames
- **Webcam tab** — live detection from any connected camera
- **Box mode** — classic bounding boxes with confidence scores
- **Draw mode** — segmentation masks (filled polygons, 50% transparent) using `yolov8s-seg.pt`
- **Live controls** — confidence slider and Box/Draw toggle update in real-time without restarting
- **Label filter** — click label tags to hide/show specific classes on the output

---

## Requirements

| Requirement | Version |
|---|---|
| Python | **3.11** (recommended) |
| Node.js | **18+** |
| npm | **9+** |

> Python 3.14 is **not** supported — `ultralytics` requires Python ≤ 3.12.

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/Model_YOLOv8s.git
cd Model_YOLOv8s
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

This installs `ultralytics`, `opencv-python`, `numpy`, and `pillow`.

### 3. Model weights (auto-downloaded)

**You don't need to download anything manually.**

When the app runs for the first time, `ultralytics` will automatically download the model weights:

| File | Size | When |
|---|---|---|
| `yolov8s.pt` | ~22 MB | On first launch |
| `yolov8s-seg.pt` | ~25 MB | First time you use **Draw mode** |

The files are saved to the project root. After the first run they are cached and no download happens again.

> If you're on a slow connection or offline, you can manually download them from the [Ultralytics releases page](https://github.com/ultralytics/assets/releases) and place them in the project root.

### 4. Install Electron dependencies

```bash
cd electron_app
npm install
cd ..
```

### 5. Update the Python path in `electron_app/main.js`

Open `electron_app/main.js` and find this line:

```js
const pythonExe = "C:\\Users\\[your username]\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";
```

Replace it with the path to **your** Python 3.11 executable.

To find it, run in your terminal:
```bash
# Windows
where python

# macOS / Linux
which python3
```

---

## Running the App

### Option A — Double-click (Windows)

Double-click **`launch.bat`** in the project root.

### Option B — Terminal

```bash
cd electron_app
npm start
```

The app window will open. The first launch takes a few extra seconds to load the model weights.

---

## Project Structure

```
Model_YOLOv8s/
├── electron_app/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Secure IPC bridge
│   ├── package.json
│   └── renderer/
│       ├── index.html   # UI layout (3 tabs)
│       ├── style.css    # Tailwind + custom styles
│       └── app.js       # All UI logic
├── png/                 # Sample test images
├── ui_backend.py        # Python detection backend (JSON over stdin/stdout)
├── yolov8s_image_detect.py   # Standalone image detection script
├── yolov8s_video_detect.py   # Standalone video detection script
├── yolov8s_webcam_detect.py  # Standalone webcam detection script
├── requirements.txt
├── launch.bat           # One-click launcher (Windows)
└── README.md
```

---

## Standalone Scripts

The three original detection scripts still work independently without the UI:

```bash
# Image
python yolov8s_image_detect.py --image png/duong_pho_tphcm.jpg --conf 0.4 --save

# Video
python yolov8s_video_detect.py

# Webcam
python yolov8s_webcam_detect.py
```

---

## Building a Standalone Installer (Windows)

This produces a single `.exe` installer that users can run with **no Python, no Node.js, nothing else required**. The installer bundles everything — Electron, Chromium, and the full Python runtime with all dependencies.

> **Expected output size: ~2–3 GB** (PyTorch is large)

### Prerequisites

Make sure you have already completed the Setup steps above (Python deps + npm install).

### Run the build

Double-click **`build.bat`** or run from terminal:

```bash
build.bat
```

It runs 4 steps automatically:

| Step | What it does |
|---|---|
| 1 | Checks / installs PyInstaller |
| 2 | Bundles `ui_backend.py` + Python + all deps → `pyinstaller_dist/ui_backend/` |
| 3 | Installs Electron npm dependencies |
| 4 | Packages Electron + bundles Python backend → `dist/` |

### Output

```
dist/
└── YOLOv8s Detector Setup 1.0.0.exe   ← send this to anyone
```

The installer includes:
- The full Electron app (UI)
- The bundled Python backend with ultralytics, OpenCV, PyTorch
- Both model weight files (`yolov8s.pt` and `yolov8s-seg.pt`) if they exist locally when you build

### Notes

- Build must be run on **Windows x64** to produce a Windows installer
- The model `.pt` files must be present in the project root **before** running `build.bat` so PyInstaller can bundle them. If they aren't there yet, run the app in dev mode once first so they auto-download, then build
- Build time is ~5–10 minutes depending on your machine

---

## How It Works

```
Electron renderer (HTML/JS)
        │  JSON over stdin/stdout
        ▼
  ui_backend.py  (Python)
        │
        ├── Box mode  →  yolov8s.pt     (detection)
        └── Draw mode →  yolov8s-seg.pt (segmentation)
```

Electron spawns `ui_backend.py` as a child process. The renderer sends JSON commands (`detect_image`, `start_video`, `start_webcam`, `set_params`, etc.) and the backend streams annotated frames back as base64 JPEG.

---

## Troubleshooting

**App opens but "Connecting…" never changes to "Model ready"**  
→ Check that the Python path in `main.js` is correct and points to a Python with `ultralytics` installed.

**`ModuleNotFoundError: No module named 'ultralytics'`**  
→ Run `pip install ultralytics` using the same Python executable set in `main.js`.

**Draw mode is slow on first use**  
→ It downloads `yolov8s-seg.pt` (~25 MB) on first run. Subsequent uses are fast.

**Webcam not opening**  
→ Try camera index `1` or `2` if `0` doesn't work. Make sure no other app is using the camera.
