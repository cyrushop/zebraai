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

The 地區 buttons above the tabs show all regions or one region at a time (Hong Kong, Taiwan, and any other `Owner Sub Region` in the file). The choice applies to the PC history on every tab. The latest list price and standard discount always come from the newest PC in any region, and the uplift rules are the same for Hong Kong and Taiwan. Data loaded before this button existed has no region; upload the PC list again to use it.

| Tab | What it does |
|---|---|
| 加價檢查 | Pick a customer, paste the part numbers for the new PC (or leave blank for every part the customer has had). For each part: last approved PC price, the one before it, whether it was already raised, suggested uplift and price. |
| 產品紀錄 | Every PC for a part across customers, with lowest / median / highest approved price. |
| 客戶紀錄 | Every part a customer has had on a PC, first vs latest price and the trend. |
| 加價規則 | Edit the rates and the "already raised" test. Saved in the browser. |

**How the uplift is worked out.** The baseline is the customer's latest Approved or Expired PC for the part (Pending too, if switched on). Each price-increase event is checked against it:

- Last PC before the event: the increase is not passed on yet, so the event's rate is added.
- Last PC after the event: compare it with the customer's last PC before the event. A rise of at least 0.5% means the increase was passed on. No rise means a PC was made after the increase without raising the price, so the event's rate is still added. No PC before the event means the first PC was already at the new list price.
- Several events not passed on are compounded (15% and 15% = 32.25%). When every event has been passed on, the RP rate applies.
- If the last PC is before an event but was already raised this year against the PC before it (for example ADC +2% ahead of October), that event gets the RP rate instead.

Default events and rates (all editable on the 加價規則 tab):

| Category | 2026-03-19 | 2026-10-05 | Already raised (RP) |
|---|---|---|---|
| EMC mobile computers (Mobile Computing) | 15% | 15% | 15% (less if margin allows; ask the sales manager) |
| MC33XXR, TC22R | | 15% | 3% |
| RFID Fixed Readers and accessories | | 5% | 3% |
| RFID HH Readers (not MC33XXR / TC22R) | | 5% | 3% |
| ADC scanners (Adv Data Capture) | | 4% | 1% |
| AIT printers, supplies and parts | | 3% | 1% |
| EMC accessories, services, RFID OH readers, other | | | |

2026-03-19 is the first PC in the HK PC list that carries the new EMC list prices. That increase covers EMC only, not RFID handhelds. A category with no rate at all uses the list-price change since the last PC, taken from the newest PC in the file that carries the part. The table says so, and warns when that list price predates the latest event.

**Standard net price.** The PC list's `Discount` column is the standard discount: standard net = list × (1 − Discount). It differs by part and fulfillment type, so the app uses the newest PC with the same fulfillment type as the customer's last PC. When the suggested price is at or above the new standard net price, the row says no PC is needed.

```sh
node tests/pc-engine.test.js
```
