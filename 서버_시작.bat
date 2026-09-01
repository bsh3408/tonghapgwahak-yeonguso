@echo off
chcp 65001 > nul
cd /d "%~dp0"
start http://localhost:5173/교사용_수행평가관리.html
"C:\Program Files\nodejs\node.exe" serve.js "%~dp0"
pause
