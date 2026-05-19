@echo off
echo Starting YOLOv8s Detector UI...
cd /d "%~dp0electron_app"
if not exist node_modules (
    echo Installing dependencies...
    npm install
)
npm start
