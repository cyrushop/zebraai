# HK Pipeline Order Check

A browser app that checks whether Hong Kong SFDC pipeline lines have been ordered with Zebra, can be filled from VAD stock, or qualify for a backend claim.

It reads four exports:

| File | Source | Used for |
|---|---|---|
| Pipeline report (`pipeline-*.xls`, HTML table) | SFDC | The lines to check |
| DSR (`HKTW_DSR_*.xlsx`) | Zebra | Orders booked, shipped and open (Zebra backlog). Only Hong Kong rows are used. |
| VAD inventory (`*_INV_*.xlsx`) | VSTECS, Chinetek, … | Free on-hand stock |
| VAD backlog (`*_BACKLOG_*.xlsx`) | VSTECS | Reseller orders waiting at the VAD |

Only Secure, Validate and Closed-Won lines are checked; Identify, Qualify, Closed-Lost and Closed-Other are ignored. Opportunities whose name ends in `-F` or `-R` (also `-F2`, `-R3` …: forecast and run-rate opps) are ignored too. By default the views show Secure with first ship in the current quarter. Validate, Won and other quarters can be switched on in the filters. Won lines are always matched, so orders and stock that Won deals already used are not offered to open ones.

The file type is detected from the column headers, so you can drop all files in at once. A new pipeline or DSR replaces the previous one. Inventory and backlog files replace the earlier file for the same VAD.

## Matching order

Each Secure, Validate or Closed-Won pipeline line is matched in this order. Every DSR quantity and every unit of stock is used once.

1. **Opp / PC.** A DSR line has the same Opportunity Number (or PC number) and part. The status is *Shipped* or *In Zebra backlog*.
2. **End user.** A DSR line has the same end user and part, and is not tied to another opp in the pipeline. If it has no PC, it is a backend claim.
3. **Stock order without PC.** A no-PC PO at the same VAD contains the opp's parts. Confidence is *high* at ≥60% basket coverage and *medium* at ≥40%. This is a backend claim.
4. **VAD stock.** Free on-hand stock is on hand − committed − VST backlog already shipped by Zebra. This is a backend claim.
5. **Preload.** A Zebra open order without PC that is not tied to a VST reseller order. This is a backend claim.

The indicative claim is (standard unit − deal unit) × qty. The standard unit comes from the DSR line value or the VAD inventory price. The deal unit is the SFDC schedule amount ÷ qty.

## Run it

Open `app/index.html` in a browser, or serve the folder:

```sh
cd app && python3 -m http.server 8000   # http://localhost:8000
```

Uploaded data and manual decisions stay in the browser (IndexedDB and localStorage). Nothing is sent to a server. The page loads SheetJS from cdnjs to read `.xlsx` files.

### Optional seed data

To open the app with a data set already loaded, generate `app/initial-data.js` locally:

```sh
python3 -I tools/build_initial_data.py app/initial-data.js path/to/pipeline.xls path/to/DSR.xlsx path/to/*_INV_*.xlsx path/to/*_BACKLOG_*.xlsx
```

`app/initial-data.js` contains customer data and is git-ignored. **Do not commit it.** This repository is public.

## Tests

```sh
node tests/engine.test.js
```

The tests use synthetic fixtures only.

---

# HK POS Sell-out Analysis

A second browser app, in `pos/`, that compares Zebra Hong Kong sell-out (POS) across fiscal years: sales by year and quarter, AIT vs EVM, product mix, distributors, resellers, end users and verticals, for full years or Q4 only.

Open `pos/index.html` in a browser (or `cd pos && python3 -m http.server 8001`) and add the yearly POS exports. Data stays in the browser (IndexedDB) until you press **Clear data**. **Download combined CSV** gives the harmonised lines for checking in Excel.

It recognises four export layouts from their headers:

| Layout | Typical file | Sales column |
|---|---|---|
| BI extract | `BI-FY2021.xlsx`, `POS_Cyrus_-_2022.xlsx` | `NetAmount_After_Rebate` |
| POS detail 2022 | `Zebra_HK_POS_2022.xlsx` | `SIP After rebate` |
| POS detail 2023–2024 | `Zebra_HK_POS_2023.xlsx`, `Zebra_HK_POS_2024.xlsx` | `SIP After rebate` |
| POS detail FY25 | `FY25_HKPOS.xlsx` | `SIP After rabe Amount` |

Rules:

- In a workbook, only the largest data sheet is read. Smaller sheets with the same columns are pivot drill-downs and would double count.
- When two files cover the same year, the one with more quarters wins, then the one with more lines. The page lists what it used and skipped.
- Lines with no distributor, or `PathToM = Tier 1`, are DSR sell-in = sell-out and show as Direct.
- Product lines are grouped into seven categories that stay comparable across years.
- Credits and returns are kept, so totals are net.

The page loads SheetJS and d3 from cdnjs. Tests: `node tests/pos-engine.test.js` (synthetic fixtures only). Never commit the Excel exports: this repository is public.
