@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Please install Node.js and try again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\desktop-shortcut.ps1"
echo SAKUSURA: http://127.0.0.1:4173/home
echo The browser will open when the server is ready.
echo Keep this window open while using the studio. Press Ctrl+C to stop.
node tools/launch.mjs
if errorlevel 1 pause
