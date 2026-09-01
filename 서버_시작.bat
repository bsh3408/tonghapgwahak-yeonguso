@echo off
cd /d "%~dp0"
start http://localhost:5173/teacher.html
"C:\Program Files\nodejs\node.exe" serve.js "%~dp0"
pause
