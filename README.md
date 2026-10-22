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

## PPL compliance checker (`ppl/`)

A Traditional Chinese port of the PPL 合規檢查器. It reads the latest SFDC pipeline report and lists the opportunities that break any of seven rules. `ppl/index.html` runs it on its own. `tools/embed_ppl.py` puts the same code into the single-file HK Pipeline Weekly Review and POS Revenue Desk pages. In the Weekly Review it has no upload of its own: it checks the pipeline loaded in the page's first upload slot, so both always show the same file. The POS Revenue Desk has no pipeline upload, so there the checker keeps its own.

Scope: record type *Zebra Opportunity* (every row is checked if the report has no record-type column), stages Identify, Qualify, Validate, Secure and Closed - Won, and First Ship Date on or after 2026-01-01. Lines are merged per Opportunity Number: amounts are summed and every other field takes the first non-empty value. The cutoff is next Wednesday, or today when today is a Wednesday.

| Rule | Flagged when |
|---|---|
| 1 | Commit Category does not match the stage: Identify / Qualify blank, Validate = Upside, Secure = Commit, Closed - Won = Shipped/booked |
| 2 | Identify / Qualify last modified on or after 2026-05-01 and more than 90 days before the cutoff |
| 3 | The stage is not Closed and the POS update deadline has passed: the Wednesday after the ship week (Monday to Sunday), when that week's POS report arrives. If that Wednesday is a Hong Kong public holiday, the deadline moves to the next working day. Ships this week, and last week's before Wednesday, are not flagged |
| 4 | Validate / Secure, opportunity total ≥ US$50,000, Forecast Notes blank |
| 5 | Fulfillment Type blank |
| 6 | Closed - Won with First Ship Date next Monday or later (a later POS week) |
| 7 | First Ship Date on or after 2026-08-01, and CRSD is blank, or in a different quarter from First Ship Date, or not before today while Commit = Shipped/booked |

The Hong Kong public holidays for 2026 and 2027 are built in (`HK_HOLIDAYS` in `ppl/ppl-check.js`, from the government gazette); add the next year's dates when they are published. A rule is skipped, with a notice, when the report lacks its columns. The page also has a quarter × stage pivot and a list of Secure opportunities where *Reseller has ordered via Distribution* = 0.

Clicking an opportunity number copies it to the clipboard and opens SFDC in a new tab. If the report has an *Opportunity ID* column (the 15- or 18-character ID starting with 006), the link opens the record directly (`/lightning/r/Opportunity/{id}/view`). Otherwise it opens Lightning global search for the number. That search URL uses an undocumented Salesforce format, so if SFDC opens without the search, paste the copied number into the search box.

## Tests

```sh
node tests/engine.test.js
node tests/ppl-check.test.js
```

The tests use synthetic fixtures only.
