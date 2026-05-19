@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  YOLOv8s Detector -- Full Build Script
echo ============================================================
echo.

set PROJECT=%~dp0

:: ── Find Python with ultralytics ─────────────────────────────────────────────
echo [0/4] Locating Python with ultralytics...

:: Try py launcher first (most reliable on Windows)
set PYTHON=
for %%V in (3.12 3.11 3.10 3.9) do (
    if not defined PYTHON (
        py -%%V -c "import ultralytics" >nul 2>&1
        if not errorlevel 1 (
            for /f "delims=" %%P in ('py -%%V -c "import sys; print(sys.executable)"') do set PYTHON=%%P
        )
    )
)

:: Fallback: try plain "python"
if not defined PYTHON (
    python -c "import ultralytics" >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%P in ('python -c "import sys; print(sys.executable)"') do set PYTHON=%%P
    )
)

if not defined PYTHON (
    echo.
    echo ERROR: Could not find a Python installation with ultralytics.
    echo Please run:  pip install -r requirements.txt
    echo Then re-run this script.
    pause
    exit /b 1
)

echo      Using Python: %PYTHON%

:: ── Step 1: Install PyInstaller if missing ───────────────────────────────────
echo.
echo [1/4] Checking PyInstaller...
"%PYTHON%" -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo      Installing PyInstaller...
    "%PYTHON%" -m pip install pyinstaller
    if errorlevel 1 ( echo ERROR: pip install pyinstaller failed. & pause & exit /b 1 )
)
echo      OK

:: ── Step 2: Bundle Python backend with PyInstaller ───────────────────────────
echo.
echo [2/4] Bundling Python backend (this takes a few minutes)...
cd /d "%PROJECT%"
"%PYTHON%" -m PyInstaller ui_backend.spec --noconfirm --clean

if errorlevel 1 (
    echo.
    echo ERROR: PyInstaller failed. See output above.
    pause
    exit /b 1
)

:: Move output to expected location
if exist "%PROJECT%pyinstaller_dist" rmdir /s /q "%PROJECT%pyinstaller_dist"
move "%PROJECT%dist" "%PROJECT%pyinstaller_dist"
echo      Python bundle ready at: pyinstaller_dist\ui_backend\

:: ── Step 3: Install Electron dependencies ────────────────────────────────────
echo.
echo [3/4] Installing Electron dependencies...
cd /d "%PROJECT%electron_app"
call npm install
if errorlevel 1 ( echo ERROR: npm install failed. & pause & exit /b 1 )
echo      OK

:: ── Step 4: Build Electron installer ─────────────────────────────────────────
echo.
echo [4/4] Building Electron installer...
call npm run dist
if errorlevel 1 ( echo ERROR: electron-builder failed. & pause & exit /b 1 )

echo.
echo ============================================================
echo  BUILD COMPLETE
echo  Installer is in: dist\
echo ============================================================
echo.
pause
