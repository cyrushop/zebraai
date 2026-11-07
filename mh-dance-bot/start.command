#!/bin/bash
# Double-click to start. First run: installs packages, then calibrates.
cd "$(dirname "$0")" || exit 1
if [ ! -d .venv ]; then
  echo "First run: installing packages (needs internet, about 1 minute)..."
  python3 -m venv .venv && ./.venv/bin/pip install -q -r requirements.txt || { echo "Install failed."; read -r; exit 1; }
fi
if [ ! -f config.json ]; then
  echo "No calibration yet - starting calibration. Open the dance mini-game in iPhone Mirroring first."
  ./.venv/bin/python dance_bot.py calibrate || { read -r; exit 1; }
fi
./.venv/bin/python dance_bot.py run --start-paused "$@"
echo "Press Enter to close."; read -r
