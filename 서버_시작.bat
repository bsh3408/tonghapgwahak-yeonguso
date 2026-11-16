@echo off
cd /d "%~dp0"
rem wait 2s so the server is up before the browser opens (2026-11-16)
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:5173/teacher.html"
"C:\Program Files\nodejs\node.exe" serve.js "%~dp0."
pause
