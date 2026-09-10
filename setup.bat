@echo off
REM ---------------------------------------------------------------------------
REM CAIN Keeper - Windows setup + launch
REM   1. creates a virtual environment in .venv (first run only)
REM   2. installs requirements.txt
REM   3. starts the server and opens your default browser at http://127.0.0.1:8000
REM Re-run this script any time; it only reinstalls what changed.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

REM Prefer the "py" launcher, fall back to python on PATH.
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if "%PY%"=="" (
  python --version >nul 2>&1 && set PY=python
)
if "%PY%"=="" (
  echo Python 3 is required. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment ^(.venv^)...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo Failed to create the virtual environment.
    pause
    exit /b 1
  )
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo Dependency install failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo Starting CAIN Keeper... ^(Ctrl+C to stop^)
python main.py --open %*
pause
