@echo off
cd /d "%~dp0"

start "Crypt Flask Backend" cmd /k ""%~dp0.venv\Scripts\python.exe" "%~dp0app.py""

cd /d "%~dp0frontend"
start "Crypt React Frontend" cmd /k "npm run dev"
