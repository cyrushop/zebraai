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

## PC justification

`app/pc-justification.html` writes the justification text for a New PC or a Repeat PC. Fill the blanks and press **Copy**.

- **New PC:** customer contact, customer demand (WMS, Asset Management, Staff Card), Zebra product and competitor.
- **Repeat PC:** previous repeat PC number and customer contact.

For the competitor, pick a brand (Honeywell, TSC, Chainway, Urovo, Evolis). The page suggests a model for each Zebra product you typed, by product class (for example TC53 → rugged touch mobile computer → Honeywell CT47). TSC's mobile computers are Bluebird models. Evolis covers card printers only (ZC series → Primacy 2 / Zenius / Badgy200, ZXP Series 9 → Avansia / Agilia). When every product typed is a card printer, the page picks Evolis by itself and puts the previous brand back if you change the products. The suggestions come from public product pages, checked 22 Oct 2026. Where no model was confirmed for a class, the page leaves it blank, so type it in. You can always edit the competitor model.

To get one file you can download and open without this repo:

```sh
python3 -I tools/build_pc_justification.py PC-Justification.html
```

Margins default to 5% / 12% (new) and 5% / 15% (repeat). The other Yes/No items keep the defaults under **Other items**.

## Tests

```sh
node tests/engine.test.js
node tests/pc-justification.test.js
```

The tests use synthetic fixtures only.
