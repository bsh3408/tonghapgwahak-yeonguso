@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 통합과학연구소 서버를 시작합니다. 이 창을 닫으면 서버도 꺼집니다.
start http://localhost:5173/교사용_수행평가관리.html
"C:\Program Files\nodejs\node.exe" serve.js "%~dp0"
pause
