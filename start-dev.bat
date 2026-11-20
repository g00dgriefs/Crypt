@echo off
cd /d "%~dp0"

set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

echo Applying database migrations...
"%PYTHON%" -m flask --app app db upgrade
if errorlevel 1 (
    echo Database migration failed. The backend was not started.
    pause
    exit /b 1
)

start "Crypt Flask Backend" cmd /k ""%PYTHON%" "%~dp0app.py""

cd /d "%~dp0frontend"
start "Crypt React Frontend" cmd /k "npm run dev"
