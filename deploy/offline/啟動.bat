@echo off
chcp 65001 >nul
cd /d "%~dp0"
python serve.py
if errorlevel 1 (
  echo.
  echo 找不到 Python，或啟動失敗。請確認已安裝 Python 並在安裝時勾選 Add to PATH。
  pause
)
