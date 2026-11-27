Zebra Sales Hub — 離線版

開啟
  1. 將成個資料夾解壓到電腦（唔好喺 zip 入面直接開）。
  2. 用 Chrome 或 Microsoft Edge 開 index.html（雙擊，或拖入瀏覽器）。
  3. 唔使上網。所有頁（首頁、Pipeline Review、DSR、POS Desk / Weekly、History、PPL Check）都喺本機運行。

資料
  - 內置數據同建立呢個版本時嘅網上 Sales Hub 一樣。
  - Forecast tracker、sales-in target、每週快照：第一次開會載入網上版當時嘅數，之後喺離線版改嘅只會存喺呢部電腦呢個瀏覽器。
  - 上載新 POS / DSR / Pipeline / VAD 檔案同網上版一樣：拖入或按 Upload。
  - 離線版同網上版唔會自動同步。喺離線版改過 forecast，記得喺網上版再入一次。

注意
  - 資料夾含客戶及銷售資料，只可以放喺公司電腦，唔好上載到公開位置。
  - 請用 Chrome / Edge。Firefox 對本機檔案嘅儲存有限制，部分設定可能存唔到。
  - 清除瀏覽器資料會清走離線版儲存嘅 forecast 同 target。

────────────────────────────────────────
每日自動由 Google Drive 載入最新報表（本機模式）
────────────────────────────────────────
平時直接開 index.html 用的是內置數據。想每日自動用 Google Drive 最新的報表，改用這個方法：

一次過設定
  1. 用記事本開「serve.py」，把 DRIVE_FOLDER 改成你的 Google Drive 同步資料夾，例如：
       DRIVE_FOLDER = r'G:\My Drive\ZebraReports'
     （如果你用 Power Automate 直接把檔案掉入這套資料夾裡的 data 子資料夾，可留空 DRIVE_FOLDER。）
  2. 確認電腦已裝 Python（安裝時勾選 Add Python to PATH）。

每日使用
  • Double-click「啟動.bat」。它會：
     1) 從 Google Drive 資料夾把每種報表最新的一份複製入 data；
     2) 啟動本機伺服器並自動開啟 Hub；
     3) Hub 底部會顯示「本機模式 · 已載入 …」。
  • POS、SFDC pipeline、DSR 會自動載入，各取檔名日期最新的一份；VAD 庫存／VST backlog 每個分銷商各取最新一份
    （例如 Chinetek 同 VSTECS 的庫存都會載入）。
  • Hub 底部會顯示一行「本機模式 · 已載入 N 份報表」，撳一下睇每份檔案的結果；有檔案讀唔到會轉做啡色並列出原因。
  • 關掉那個黑色視窗就會停止伺服器。
  • 伺服器固定用 http://127.0.0.1:8787 。如果話連接埠被佔用，請關閉佔用的程式再試（已開着的 Hub 會直接打開）。

重要：兩種開法的資料不共用
  • 「雙擊 index.html」（file://）同「啟動.bat」（http://127.0.0.1:8787）對瀏覽器來說是兩個不同網站，
    各自保存 forecast、sales-in target、每週快照。揀定一種開法長期用（建議用 啟動.bat），
    否則喺一邊入的 forecast 喺另一邊會睇唔到。

要全自動（開機或每日定時跑）
  • 用 Windows「工作排程器」每日執行：python  <這個資料夾>\serve.py
  • 或由 Power Automate Desktop 流程最後一步執行同一個指令。

注意
  • 本機模式載入的檔案只在這次開啟有效，不會改動內置數據，也不會上網。
  • 檔名要保留日期（例如 POS-HKTW-2026.11.24.xlsx、pipeline-2026-11-24-….xls），自動選最新靠的就是檔名日期。
  • data 資料夾與報表含客戶及銷售數據，只放在公司電腦，不要上載到公開位置。
