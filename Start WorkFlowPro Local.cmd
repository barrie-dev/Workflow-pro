@echo off
cd /d "%~dp0"
set "NODE=C:\Users\ABMS Consultancy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" src\server.js
