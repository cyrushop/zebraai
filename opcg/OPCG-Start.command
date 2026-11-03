#!/bin/bash
# OPCG 咭庫 — Mac 啟動檔。喺 Finder 雙擊就得。
# 開本機伺服器，然後用瀏覽器打開 http://localhost:8765
# 想停：關咗呢個 Terminal 視窗，或者撳 Control + C。

cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT"

say_line() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pause_exit() { printf '\n撳 Enter 關閉…'; read -r _; exit "${1:-1}"; }

# 1. Python 3.9 或以上
PY=""
for p in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$p"; break
  fi
done
if [ -z "$PY" ]; then
  say_line "搵唔到 Python 3（需要 3.9 或以上）。"
  echo "Mac 會彈出視窗問你裝「Command Line Developer Tools」，撳「安裝」，裝完再雙擊呢個檔。"
  echo "（或者喺 https://www.python.org/downloads/macos/ 下載安裝。）"
  xcode-select --install >/dev/null 2>&1
  pause_exit 1
fi
echo "用緊 $("$PY" --version 2>&1)：$PY"

# 2. 已經開緊？直接打開瀏覽器
if curl -s -o /dev/null --max-time 2 "$URL/app/"; then
  say_line "OPCG 咭庫已經開緊，幫你打開瀏覽器。"
  open "$URL"
  exit 0
fi

# 3. 第一次用：抓晒所有系列嘅咭表（咭圖直接由官方網站顯示）
if [ ! -f data/cards.json ]; then
  say_line "第一次用：未有咭表。"
  printf '而家抓晒所有系列嘅咭表（大約 1–2 分鐘）？ [Y/n] '
  read -r ans
  if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
    "$PY" -u bot/scrape_cards.py --save-html
    if [ $? -ne 0 ]; then
      say_line "咭表 BOT 出錯。請將上面嘅訊息，同埋 opcg/data/raw/ 入面嘅檔案，畀 Claude 睇。"
      printf '照樣開 App？ [Y/n] '; read -r ans2
      if [ "$ans2" = "n" ] || [ "$ans2" = "N" ]; then pause_exit 1; fi
    else
      echo "咭圖會直接由官方網站顯示。想將咭圖存落部機（冇網都睇到，約 30–60 分鐘）：開 App →「設定」→「更新咭表 + 下載圖片」。"
    fi
  fi
fi

# 4. 開伺服器 + 瀏覽器
say_line "開緊 OPCG 咭庫：$URL"
"$PY" -u serve.py --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM HUP EXIT
for _ in $(seq 1 30); do
  curl -s -o /dev/null --max-time 1 "$URL/app/" && break
  sleep 0.3
done
open "$URL"
echo
echo "瀏覽器冇自動開？自己打開：$URL"
echo "想停：關咗呢個視窗，或者撳 Control + C。"
wait $SERVER
