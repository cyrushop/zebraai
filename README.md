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

# HK Pipeline Weekly Review

A second browser app in `review/`. Drop in the weekly SFDC pipeline export and it builds the HK weekly review:

| Section | What it shows |
|---|---|
| Week dashboard | Current-quarter POS vs target, POS matched to Closed-Won / Secure / Validate deals by account Match Key, real gap and projection (mirrors the weekly tracker's Dashboard sheet) |
| Top 10 end users / partners | Current and next quarter, stacked by product line / sales stage |
| Product lines | Pipeline by quarter, and Secure vs Validate per product line |
| Disti | Chinetek vs VST share (pie) and by quarter |
| Software | Product Line or Sub Line containing "Software" |
| RFID | Product Line or Sub Line containing "RFID", by quarter, sub line, stage, end user and partner |
| NAL / MPL | Forecast, coverage, RAD distribution, top 5 per RAD, and a no-pipeline alert for next quarter and the quarter after |
| -F | Placeholder (`-F`) pipeline still waiting to turn real, by quarter and stage |

It reads up to three files:

| File | Required | Used for |
|---|---|---|
| SFDC pipeline (`pipeline-*.xls`, HTML table) | Yes | Every section. The current quarter is taken from the date in the file name. |
| POS export, or the weekly tracker `.xlsx` (sheet `POS_Raw`) | No | POS figures on the week dashboard. From the tracker it also reads the Q target and Match Keys. |
| FY27 account list (`.xlsx`) | No | NAL / MPL lists, RAD and FY27 projection (Region `HK` rows only) |

Rules:

- Opportunities whose name ends in `-F` are placeholders. The "Hide -F placeholders" switch leaves them out of the business sections; the -F section totals them.
- NAL / MPL **coverage** (has the account got any pipeline?) counts every live stage, including Qualify, Identify and -F. NAL / MPL **forecast** counts Closed-Won, Secure and Validate only, never -F.
- NAL accounts match on Siebel Account Number, then on account name. MPL accounts match on the channel partner's Siebel number, then on name.

Open `review/index.html` in a browser, or serve it:

```sh
cd review && python3 -m http.server 8001   # http://localhost:8001
```

Uploads, the Q target and Match Key edits stay in the browser (localStorage). Nothing is sent to a server. The page loads SheetJS and Chart.js from jsDelivr.

To open it with data already loaded, build the git-ignored seed file locally. **Do not commit it.**

```sh
python3 -I tools/build_review_data.py review/initial-data.js path/to/pipeline.xls [path/to/tracker.xlsx] [path/to/accounts.xlsx]
```

Tests (synthetic fixtures only):

```sh
node tests/review-engine.test.js
```
