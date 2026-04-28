@echo off
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
start "" "http://localhost:4173"
"%NODE%" server.js
pause
