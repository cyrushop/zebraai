# OPCG 咭庫 (One Piece Card Game collection + deck seller)

記錄自己開箱得到嘅咭，對照比賽 Deck list 睇邊副夠咭砌，砌好預留咭，賣出後自動扣數。

## Mac：一撳就用

1. 下載：https://github.com/cyrushop/zebraai/archive/refs/heads/claude/one-piece-card-tracker-0rpst3.zip ，雙擊解壓。
2. 打開解壓後嘅 `opcg` 資料夾，雙擊 **`OPCG-Start.command`**。
   * 第一次會問「抓晒所有系列嘅咭表？」，撳 Enter 就開始 (約 1–2 分鐘)。所有系列都會顯示，有冇庫存你自己喺 App 入面填。咭圖直接由官方網站顯示；想存落部機就喺「設定」撳「更新咭表 + 下載圖片」。
   * 抓完自動開瀏覽器 http://localhost:8765 。
   * 用完關咗個 Terminal 視窗就停。
3. 想手機一齊用 (同一個 Wi-Fi)：雙擊 **`OPCG-Phone.command`**，第一次設定一個 PIN，然後用手機開佢顯示嘅網址。

第一次雙擊，Mac 可能話「無法打開，因為來自未識別的開發者」：
* macOS 14 或之前：喺 Finder 對住個檔 **右撳 → 打開 → 打開**。
* macOS 15 (Sequoia) 或之後：撳「完成」，然後去 **系統設定 → 私隱與保安**，拉到最底撳「**仍要打開**」，再雙擊一次。

如果「仍要打開」個掣冇出現：打開「終端機」，打 `xattr -dr com.apple.quarantine ` (後面有空格)，將成個解壓咗嘅資料夾拖入視窗，撳 Enter，再雙擊。呢個指令只係話 Mac 知呢個資料夾係你自己下載嘅。

雙擊冇反應或者話冇權限：打開「終端機」，打 `chmod +x ` (後面有空格)，將兩個 `.command` 檔拖入視窗，撳 Enter。

冇 Python 嘅話，啟動檔會叫 Mac 安裝「Command Line Developer Tools」(入面有 Python 3)，裝完再雙擊。如果 BOT 話 `CERTIFICATE_VERIFY_FAILED`：去「應用程式 → Python 3.x」雙擊 `Install Certificates.command`。

## 快速開始

需要 Python 3.9+ (唔使裝其他套件)。

```bash
python3 opcg/serve.py
```

打開 http://localhost:8765 → 「設定」→ 撳 **更新咭表 + 下載圖片**、**更新 Deck list** 同 **更新價錢**。

### 用手機睇 / 搜尋

部電腦同手機要連同一個 Wi-Fi：

```bash
python3 opcg/serve.py --lan --pin 4321
```

Terminal 會印出 `http://192.168.x.x:8765`，用手機打開，輸入 PIN。手機同電腦用同一份資料；如果兩部機差唔多同時改，後改嗰部會收到提示同載入最新版本，唔會互相覆蓋。手機版咭庫可以撳「篩選」打開篩選欄。

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
| 主頁 | 智能搜尋、我嘅咭 / 總值 / 系列收集 / Decks 摘要、我嘅系列進度圈、最近加入、我的 Decks、最貴嘅咭。 |
| 咭庫 | 全部咭 (有圖)，智能搜尋 + 按系列 / 顏色 / 類別 / 稀有度 / 有冇 篩選，+/− 改數量。未有嘅咭會淡色顯示。 |
| 系列 | 按 補充包 / 額外補充包 / 高級補充包 / 預組 / 推廣卡 分組，每個系列一個完成度圈。入去睇每種稀有度有幾多 (例如 SR 4/10)、只睇缺咭、複製缺咭清單、可選連平行版一齊計。 |
| 開箱 | 揀預設系列 (例如 OP08)，打 `45` 再 Enter 就 +1 張 OP08-045；`45p1` = 平行版。可撤銷。亦可以一次過貼 `OP08-001 x2`。 |
| Meta Decks | onepiecetopdecks 嘅比賽 Deck，按「我最夠咭」排序，顯示差幾多張、差邊啲。一撳加入我的 Deck。 |
| 我的 Decks | 計劃中 → 砌好 (預留咭，其他 Deck 唔會再計呢啲咭) → 賣出 (從咭庫扣數，記錄售價同收入)。顯示 Deck 市值、補齊要幾錢、預計賺蝕；賣出時記低當時市值，計總賺蝕。可以編輯、檢查規則 (1 領航、50 張、每款最多 4 張、顏色)，有合併補咭清單。 |
| 貴咭 | 單價 HK$50 (可改) 或以上嘅咭：單價、數量、總值、7 日升跌、悠々亭連結。可以逐張輸入手動價。顯示成個咭庫總值，可匯出 CSV。 |
| 設定 | 行 BOT、匯率同價錢係數、平行版計唔計入 Deck、匯出 / 匯入 JSON 備份、匯出 CSV。 |

### 揀 Deck 嚟砌

1. 喺 https://onepiecetopdecks.com/deck-list/ 揀咗想砌嘅 Deck。
2. 複製佢個 deckgen 連結 (`.../deckgen/?dn=RG%20Luffy&...&dg=1nOP13-001a4nOP13-016...`)，或者「Decklist in text」(`1xOP13-001` …)。
3. 貼落「我的 Decks」頂嘅匯入框 (或者直接貼落主頁搜尋框)。一次可以貼幾條連結，每行一條。
4. Deck 名、名次、比賽、作者、日期自動讀入；即刻顯示你有幾多張、差邊幾張、補齊要幾錢。
5. 撳「顯示中文效果」：每張咭下面顯示官方中文效果 (來自 asia-tc.onepiece-cardgame.com)，【登場時】【啟動主要】【每回合1次】等關鍵字會標色。

Meta Deck 好多時用到 OP01、ST、PRB、EB 等舊系列嘅咭，所以咭表 BOT 預設會讀晒所有系列。

### 智能搜尋

用空格或逗號分隔，可以混合使用：

| 寫法 | 意思 |
|---|---|
| `OP08` / `EB02` / `PRB01` | 系列 |
| `c5`、`c3-5` | 費用 (領航就係生命) |
| `p6000`、`p5000-7000` | 力量 |
| `k1000` | 反擊 |
| `SR` / `SEC` / `L` … | 稀有度 |
| `紅` / `red` … | 顏色 (寫兩個 = 雙色) |
| `領航` / `角色` / `事件` / `場地` | 類別 |
| `有` / `未有` | 我有 / 我未有 |
| `平行` | 只睇平行版 |
| 其他字 | 名、咭號、特徵、效果 |

例如：`路飛 OP08 c5 p6000`、`紅 事件 未有`、`草帽 SR 有`。

### 咭頁

撳任何咭圖：大圖、平行版切換、費用 / 力量 / 反擊 / 顏色 / 屬性、價錢同走勢線、手動價、每個版本嘅數量 +/−、效果文字 (【登場時】等關鍵字會標色)、用喺邊副 Deck。

### 手機

闊度細過 640px 會用底部導航：主頁 · 系列 · ＋開箱 · Decks · 更多 (咭庫、貴咭、Meta Decks、設定)。

## BOT

| BOT | 來源 | 輸出 |
|---|---|---|
| `bot/scrape_cards.py` | https://asia-tc.onepiece-cardgame.com/cardlist/ (每個系列一頁) | `data/cards.json`, `data/cards.js`, `data/images/` |
| `bot/scrape_decks.py` | https://onepiecetopdecks.com/deck-list/ 同佢連去嘅 deck-list 頁 | `data/decks.json`, `data/decks.js` |
| `bot/scrape_prices.py` | https://yuyu-tei.jp/sell/opc/s/op08 等 (悠々亭日版單咭售價) + https://open.er-api.com 匯率 | `data/prices.json`, `data/prices.js` (保留 180 日價錢歷史) |

常用選項：

* `scrape_cards.py --list-series`：列出網站有咩系列
* `scrape_cards.py --series OP08,OP09,EB02`：只更新某啲系列 (會同之前嘅結果合併)
* `scrape_decks.py --max-pages 10` / `--url <頁面>`
* `scrape_prices.py`：預設只讀你有嘅咭同你啲 Deck 用到嘅系列；`--sets all` 讀晒，`--sets OP08,OP09` 指定，`--rate 0.049` 自己定匯率
* 三隻 BOT 都有 `--save-html`，網站改版搵唔到嘢時，將 `data/raw/` 入面嘅 HTML 用嚟修 parser。

BOT 每個 request 之間等 1 秒。

## 價錢點計

* **自動價** = 悠々亭日版售價 (JPY) × 匯率 (JPY→HKD) × 係數。係數預設 1，你可以喺設定改，例如亞洲中文版行情低啲就設 0.8。
* **手動價** (HK$) 永遠優先。喺「貴咭」或者咭嘅詳情入面輸入；清空就用返自動價。
* 平行版：悠々亭同一個咭號有普通版同平行版，BOT 將普通版對應 `OP08-001`，平行版由平到貴對應 `_p1`、`_p2`。**呢個對應係估計**，貴咭請自己核對，唔啱就輸入手動價。
* Deck 市值用普通版價錢計。

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
