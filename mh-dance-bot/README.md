# MH 跳舞小遊戲 Bot（macOS + iPhone 鏡像輸出）

讀取畫面下方箭咀列（由左至右），按顏色判斷方向，再喺 iPhone Mirroring 視窗度撳對應嘅掣。

| 顏色 | 方向 |
|---|---|
| 藍 | → |
| 綠 | ← |
| 橙 | ↑ |
| 紫 | ↓ |

## 安裝（一次）

```bash
cd mh-dance-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

macOS「系統設定 → 私隱與安全性」，將你用嘅 Terminal（Terminal / iTerm）加入：
- **輔助使用 (Accessibility)**：撳掣用
- **螢幕錄影 (Screen Recording)**：讀畫面用

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

## 使用

先試只睇唔撳：

```bash
python3 dance_bot.py run --dry-run
```

確認印出嚟嘅箭咀同畫面一樣，再正式玩：

```bash
python3 dance_bot.py run
```

**停止**：滑鼠推去螢幕最左上角，或者喺 Terminal 撳 Ctrl+C。

### 可調參數

| 參數 | 預設 | 用途 |
|---|---|---|
| `--interval` | 0.08 | 每下撳掣之間隔（秒）。漏撳就加大 |
| `--hold` | 0.03 | 每下撳住幾耐 |
| `--cooldown` | 0.6 | 打完一組之後幾耐唔再輸入 |
| `--stable-frames` | 2 | 同一組要連續見到幾多次先撳（防箭咀未出齊） |
| `--repeat-after` | 2.5 | 同一組仍喺畫面多久之後再撳一次 |
| `--debug` | 關 | 每組識別結果存去 `debug/` |

### 離線測試

```bash
python3 dance_bot.py test screenshot.png --roi 390,1265,1550,1370 --out check.png
```

## 注意

- 自動化輸入可能違反遊戲服務條款，有被封號風險，自行判斷。
- 顏色門檻喺 `config.json` 嘅 `colors` 可以改（OpenCV HSV：H 0–180）。
