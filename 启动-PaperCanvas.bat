@echo off
cd /d "%~dp0"
if not exist "out\main\index.js" call npm run build
if not exist "out\main\index.js" exit /b 1
start "PaperCanvas" "node_modules\electron\dist\electron.exe" .
