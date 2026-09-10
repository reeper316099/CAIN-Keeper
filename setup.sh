#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CAIN Keeper - macOS / Linux setup + launch
#   1. creates a virtual environment in .venv (first run only)
#   2. installs requirements.txt
#   3. starts the server and opens your default browser at http://127.0.0.1:8000
# Re-run this script any time; it only reinstalls what changed.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

# Pick a Python 3 interpreter.
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Python 3 is required. Install it from https://www.python.org/downloads/ (or 'brew install python')."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment (.venv)..."
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt

echo
echo "Starting CAIN Keeper... (Ctrl+C to stop)"
python main.py --open "$@"
