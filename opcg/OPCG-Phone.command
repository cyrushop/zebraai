#!/bin/bash
# OPCG 咭庫 — 連手機一齊用（同一個 Wi-Fi）。喺 Finder 雙擊就得。
# 第一次會叫你設定一個 PIN，手機開嘅時候要輸入。PIN 存喺 opcg/data/pin.txt。

cd "$(dirname "$0")" || exit 1
PORT=8765

PY=""
for p in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$p"; break
  fi
done
if [ -z "$PY" ]; then
  echo "搵唔到 Python 3（需要 3.9 或以上）。先雙擊 OPCG-Start.command，佢會教你點裝。"
  printf '撳 Enter 關閉…'; read -r _; exit 1
fi

if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "OPCG 咭庫已經喺另一個視窗開緊。請先關咗嗰個視窗，再雙擊呢個檔。"
  printf '撳 Enter 關閉…'; read -r _; exit 1
fi

mkdir -p data
if [ ! -s data/pin.txt ]; then
  printf '設定手機用嘅 PIN（4–8 個數字）：'
  read -r PIN
  while ! [[ "$PIN" =~ ^[0-9]{4,8}$ ]]; do printf 'PIN 要係 4–8 個數字，再輸入：'; read -r PIN; done
  printf '%s' "$PIN" > data/pin.txt
  chmod 600 data/pin.txt
fi
PIN="$(cat data/pin.txt)"

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
printf '\n\033[1m手機（同一個 Wi-Fi）打開：http://%s:%s\033[0m\n' "${IP:-你部 Mac 嘅 IP}" "$PORT"
echo "PIN：$PIN   （想改 PIN：刪除 opcg/data/pin.txt 再雙擊呢個檔）"
echo "Mac 問「是否允許 Python 接受連入連線」嘅話，撳「允許」。"
echo "想停：關咗呢個視窗，或者撳 Control + C。"
echo

"$PY" -u serve.py --port "$PORT" --lan --pin "$PIN" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM HUP EXIT
sleep 1
open "http://localhost:$PORT"
wait $SERVER
