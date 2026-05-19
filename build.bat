@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  YOLOv8s Detector -- Full Build Script
echo ============================================================
echo.

set PYTHON=C:\Users\axtre\AppData\Local\Programs\Python\Python311\python.exe
set PROJECT=%~dp0

:: ── Step 1: Install PyInstaller if missing ───────────────────────────────────
echo [1/4] Checking PyInstaller...
"%PYTHON%" -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo      Installing PyInstaller...
    "%PYTHON%" -m pip install pyinstaller
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
if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo      OK

:: ── Step 4: Build Electron installer ─────────────────────────────────────────
echo.
echo [4/4] Building Electron installer...
call npm run dist
if errorlevel 1 (
    echo ERROR: electron-builder failed.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  BUILD COMPLETE
echo  Installer is in: dist\
echo ============================================================
echo.
pause
