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

# HK PC Price Check

`app/pc.html` looks up price concession (PC) history before you submit a new PC, and suggests how much to raise the price.

It reads the SFDC **PC list** export (`*_PC_List-*.xls`, HTML table). Upload it or drop it on the page. The rows stay in the browser (IndexedDB).

| Tab | What it does |
|---|---|
| 加價檢查 | Pick a customer, paste the part numbers for the new PC (or leave blank for every part the customer has had). For each part: last approved PC price, the one before it, whether it was already raised, suggested uplift and price. |
| 產品紀錄 | Every PC for a part across customers, with lowest / median / highest approved price. |
| 客戶紀錄 | Every part a customer has had on a PC, first vs latest price and the trend. |
| 加價規則 | Edit the rates and the "already raised" test. Saved in the browser. |

**Already raised.** The baseline is the customer's latest Approved or Expired PC for the part (Pending too, if switched on). It counts as raised when it was created on or after the price-increase date (default 2026-10-05), or when it was created this year (default from 2026-01-01) and its price is at least 0.5% above the customer's previous PC.

**Uplift on the last PC price** (defaults, editable):

| Category | Not raised yet | Already raised (RP) |
|---|---|---|
| EMC mobile computers (Mobile Computing) | 15% | no rule |
| ADC scanners (Adv Data Capture) | 4% | 1% |
| AIT printers, supplies and parts | 3% | 1% |
| RFID Fixed Readers and accessories | 5% | 3% |
| RFID HH Readers (not MC33XXR / TC22R) | 5% | 3% |
| MC33XXR, TC22R | 15% | 3% |
| EMC accessories, services, RFID OH readers, other | no rule | no rule |

Where there is no rule, the suggestion uses the list-price change since the last PC, taken from the newest PC in the file that carries the part. The table says so, and warns when that list price predates the increase date.

```sh
node tests/pc-engine.test.js
```
