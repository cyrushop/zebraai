# OPCG 咭庫 (One Piece Card Game collection + deck seller)

記錄自己開箱得到嘅咭，對照比賽 Deck list 睇邊副夠咭砌，砌好預留咭，賣出後自動扣數。

## 快速開始

需要 Python 3.9+ (唔使裝其他套件)。

```bash
python3 opcg/serve.py
```

打開 http://localhost:8765 → 「設定」→ 撳 **更新咭表 + 下載圖片** 同 **更新 Deck list**。

或者直接喺 terminal 行 BOT：

```bash
python3 opcg/bot/scrape_cards.py --images
```

```bash
python3 opcg/bot/scrape_decks.py
```

冇開 `serve.py` 都可以直接開 `opcg/app/index.html`，不過資料就只存喺瀏覽器 (記得喺設定匯出備份)。

## 功能

| 分頁 | 做咩 |
|---|---|
| 咭庫 | 全部咭 (有圖)，按系列 / 顏色 / 類別 / 稀有度 / 有冇 篩選，+/− 改數量。撳圖睇效果同平行版本。 |
| 開箱 | 揀預設系列 (例如 OP08)，打 `45` 再 Enter 就 +1 張 OP08-045；`45p1` = 平行版。可撤銷。亦可以一次過貼 `OP08-001 x2`。 |
| Meta Decks | onepiecetopdecks 嘅比賽 Deck，按「我最夠咭」排序，顯示差幾多張、差邊啲。一撳加入我的 Deck。 |
| 我的 Decks | 計劃中 → 砌好 (預留咭，其他 Deck 唔會再計呢啲咭) → 賣出 (從咭庫扣數，記錄售價同收入)。可以編輯、檢查規則 (1 領航、50 張、每款最多 4 張、顏色)，有合併補咭清單。 |
| 設定 | 行 BOT、平行版計唔計入 Deck、匯出 / 匯入 JSON 備份、匯出 CSV。 |

## BOT

| BOT | 來源 | 輸出 |
|---|---|---|
| `bot/scrape_cards.py` | https://asia-tc.onepiece-cardgame.com/cardlist/ (每個系列一頁) | `data/cards.json`, `data/cards.js`, `data/images/` |
| `bot/scrape_decks.py` | https://onepiecetopdecks.com/deck-list/ 同佢連去嘅 deck-list 頁 | `data/decks.json`, `data/decks.js` |

常用選項：

* `scrape_cards.py --list-series`：列出網站有咩系列
* `scrape_cards.py --series OP08,OP09,EB02`：只更新某啲系列 (會同之前嘅結果合併)
* `scrape_decks.py --max-pages 10` / `--url <頁面>`
* 兩隻 BOT 都有 `--save-html`，網站改版搵唔到嘢時，將 `data/raw/` 入面嘅 HTML 用嚟修 parser。

BOT 每個 request 之間等 1 秒。

## 資料

`opcg/data/` (咭表、圖片、你嘅咭庫 `collection.json`、每日備份) 已 git-ignore，**唔會**上傳到 GitHub。咭圖同咭文版權屬 Bandai，請自己留用。

## 測試

```bash
node opcg/tests/engine.test.js
```

```bash
python3 -I opcg/tests/test_bots.py
```

測試只用自製嘅 HTML / 數據。
