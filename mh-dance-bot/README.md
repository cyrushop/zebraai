# MH 跳舞小遊戲 Bot（macOS + iPhone 鏡像輸出）

讀取畫面下方箭咀列（由左至右），按顏色判斷方向，再喺 iPhone Mirroring 視窗度撳對應嘅掣。

| 顏色 | 方向 |
|---|---|
| 藍 | → |
| 綠 | ← |
| 橙 | ↑ |
| 紫 | ↓ |

## 最快方法：雙擊 `start.command`

第一次雙擊會自動安裝套件 → 校準 → 以「暫停」狀態開始（去遊戲撳右 Option 開始）。
macOS 話「Not Opened / Apple could not verify」：撳 **Done**（唔好撳 Move to Bin），然後揀以下其中一個方法：

- **最簡單**：開「終端機 (Terminal)」，打 `bash `（後面有個空格），將 `start.command` 由 Finder 拖入 Terminal 視窗，撳 Enter。
- **或者**：系統設定 → 私隱與安全性 → 拉到最底「保安」 → 撳 `start.command` 旁邊嘅 **仍要打開 (Open Anyway)** → 輸入密碼。之後雙擊就得。
- **或者**一次過解除下載標記：`xattr -dr com.apple.quarantine ~/Downloads/mh-dance-bot`

（macOS 15 Sequoia 起，「右鍵 → 打開」已經唔再可以略過呢個檢查。）
之後重新校準：刪除 `config.json` 再雙擊。

下面係手動步驟。

## 安裝（一次）

```bash
cd mh-dance-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

macOS「系統設定 → 私隱與安全性」，將你用嘅 Terminal（Terminal / iTerm）加入：
- **輔助使用 (Accessibility)**：撳掣用
- **螢幕錄影 (Screen Recording)**：讀畫面用
- **輸入監控 (Input Monitoring)**：熱鍵暫停／繼續用（第一次 run 會彈出要求）

加完要完全關閉再開返 Terminal。

## 校準（一次；改咗視窗大小要再做）

開 iPhone Mirroring，入到跳舞小遊戲，見到箭咀列同 4 個掣：

```bash
python3 dance_bot.py calibrate
```

Terminal 保持 focus，滑鼠逐個指住以下位置再撳 Enter：
1. 箭咀列左上角（第一個箭咀左上方）
2. 箭咀列右下角（最右可能出現箭咀嘅位置，箭咀下面，但喺 +10/+6/+3 時間條**上面**）
3. ↑ 掣中心、↓ 掣中心、← 掣中心、→ 掣中心

位置係按視窗比例儲存，之後拖動視窗都得。完成後睇 `debug/calibration_roi.png`，應該只見到箭咀嗰一行。

### 用截圖校準（唔使等跳舞小遊戲）

跳舞小遊戲有時限，難喺現場指齊 6 點。可以用一張**同一部 iPhone、打橫**影嘅跳舞畫面截圖：

```bash
python3 dance_bot.py calibrate --image ~/Downloads/IMG_0020.PNG
```

1. iPhone Mirroring 要開住（任何遊戲畫面都得）。
2. 會彈出一個視窗顯示截圖，跟頂部提示順序撳 6 點（Z = 撤銷，Esc = 取消），撳完按 Enter。
3. Bot 會自動搵出遊戲畫面喺 iPhone Mirroring 視窗入面嘅位置，再換算座標。
4. 睇 `debug/calibration_preview.png`：紫框應該啱啱包住遊戲畫面。

## 使用

先試只睇唔撳：

```bash
python3 dance_bot.py run --dry-run
```

確認印出嚟嘅箭咀同畫面一樣，再正式玩：

```bash
python3 dance_bot.py run
```

**暫停／繼續**：撳一下**右邊 Option (⌥) 鍵**（暫停有 Funk 聲，繼續有 Tink 聲）。打緊一組都會即刻停手。

**選單列狀態燈**：螢幕頂部選單列會顯示

| 顯示 | 意思 |
|---|---|
| 🟢 MH 運行 | 正在自動撳 |
| ⏸ MH 暫停 | 暫停中 |
| 👀 MH 試行 | `--dry-run`，只睇唔撳 |

撳落去可以睇已打幾多組、上一組係咩，亦可以「暫停／繼續」或者「停止 Bot」。唔想要就加 `--no-menubar`。

**完全停止**：選單列「停止 Bot」、滑鼠推去螢幕最左上角，或者喺 Terminal 撳 Ctrl+C。

想開定 bot 先、轉去遊戲先開始：

```bash
python3 dance_bot.py run --start-paused
```

然後喺遊戲入面撳右 Option 開始。

### 可調參數

| 參數 | 預設 | 用途 |
|---|---|---|
| `--interval` | 0.08 | 每下撳掣之間隔（秒）。漏撳就加大 |
| `--hold` | 0.03 | 每下撳住幾耐 |
| `--cooldown` | 0.6 | 打完一組之後幾耐唔再輸入 |
| `--stable-frames` | 2 | 同一組要連續見到幾多次先撳（防箭咀未出齊） |
| `--repeat-after` | 2.5 | 同一組仍喺畫面多久之後再撳一次 |
| `--debug` | 關 | 每組識別結果存去 `debug/` |
| `--hotkey` | right_option | 暫停鍵：right_option / left_option / right_command / right_shift / right_control / f6–f10 / none |
| `--start-paused` | 關 | 一開始就暫停 |
| `--no-sound` | 關 | 暫停／繼續唔出聲 |
| `--no-menubar` | 關 | 唔顯示選單列狀態燈 |

### 搵唔到 iPhone Mirroring 視窗

先開 iPhone Mirroring，再試：

```bash
python3 dance_bot.py windows
```

會列出所有視窗同 bot 會用邊個。如果 iPhone Mirroring 個名唔同，可以加 `--app-name "個名"`，例如 `python3 dance_bot.py --app-name "iPhone 鏡像輸出" calibrate`。

### 離線測試

```bash
python3 dance_bot.py test screenshot.png --roi 390,1265,1550,1370 --out check.png
```

## 注意

- 自動化輸入可能違反遊戲服務條款，有被封號風險，自行判斷。
- 顏色門檻喺 `config.json` 嘅 `colors` 可以改（OpenCV HSV：H 0–180）。
