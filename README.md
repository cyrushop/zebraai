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

## VST business review (`app/review.html`)

A one-page quarterly review for a distributor (VSTECS by default; switch to All Hong Kong or another VAD at the top). It reads the Zyme POS exports (the 2024 layout and the 2025+ `_cc` layout; Hong Kong rows only, the biggest POS sheet per workbook) as well as the pipeline, VAD inventory and VAD backlog files above.

1. **Pipeline**: current and next quarter by stage (Won, Secure, Validate, Qualify, Identify), by schedule-date quarter, for the selected primary distributor. Forecast / run-rate opps (`-F`, `-R`) can be switched off.
2. **QTD**: POS for the current fiscal quarter against the same fiscal weeks last year and the year before, the full prior-year quarter, and an optional quarter target.
3. **Business comparison**: every loaded fiscal year by quarter, YTD to the same fiscal week, cumulative by week, share of Hong Kong POS.
4. **Product lines**: YTD or full year by product line and sub-line, mix, top product families.
5. **Partner coverage**: resellers by year with status (new, growing, declining, lapsed), end users, product-line breadth, pipeline, and a partner × product line white-space map.
6. **Inventory**: free stock against reseller backlog, 13 / 26-week sell-out, weeks of cover, and a suggestion per part.

POS value is net cost in USD at planned rate. The 2024 export has no net column, so it is SIP after rebate ÷ (1 − sell-out rebate %), which reproduces the 2025 net column exactly. When a fiscal year is loaded twice, the later upload wins. Both pages share the uploaded files.

## Run it

Open `app/index.html` (order check) or `app/review.html` (VST review) in a browser, or serve the folder:

```sh
cd app && python3 -m http.server 8000   # http://localhost:8000/review.html
```

Uploaded data and manual decisions stay in the browser (IndexedDB and localStorage). Nothing is sent to a server. The page loads SheetJS from cdnjs to read `.xlsx` files.

### Optional seed data

To open the app with a data set already loaded, generate `app/initial-data.js` locally:

```sh
python3 -I tools/build_initial_data.py app/initial-data.js path/to/pipeline.xls path/to/DSR.xlsx path/to/*_INV_*.xlsx path/to/*_BACKLOG_*.xlsx path/to/*POS*.xlsx
```

`app/initial-data.js` contains customer data and is git-ignored. **Do not commit it.** This repository is public.

## Tests

```sh
node tests/engine.test.js
node tests/review.test.js
```

The tests use synthetic fixtures only.
