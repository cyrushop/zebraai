"""Build app/initial-data.js from raw SFDC / VAD exports.

The output holds customer and deal data, so it is git-ignored and must never
be committed to this (public) repo.

Usage:
    python3 -I tools/build_initial_data.py OUT.js FILE [FILE ...] [--targets TARGETS.json]

TARGETS.json holds the quarter plan for the VST review page, by fiscal quarter
and distributor key ("vstecs", "chinetek", "all"), in USD:
    {"2026 Q4": {"vstecs": {"sellIn": 100000, "sellOutNet": 90000, "sellOutGross": 95000,
      "stretch": 92700, "startInv": 40000, "startDoi": 35, "endInv": 45000, "endDoi": 40}}}

Each FILE is auto-detected as pipeline / dsr / inventory / backlog by its
headers, using the same rules as app/engine.js, or as a Zyme POS export using
the rules in app/review.js (Hong Kong rows only, biggest POS sheet per file).
"""
import datetime as dt
import json
import re
import sys

import openpyxl

SIGNATURES = {
    "pipeline": ["Opportunity Number", "Product Name", "Sales Stage"],
    "dsr": ["Part Number", "Line Item Status", "Order Number"],
    "backlog": ["Distributor to Reseller Order Number", "Zebra Part Number", "Quantity"],
    "inventory": ["Zebra Part Number", "On-Hand Quantity"],
}

# Only the columns the app reads, to keep the seed file small.
KEEP = {
    "pipeline": [
        "First Ship Fiscal Quarter New", "Forecast Notes", "Fulfillment Type", "PC Number",
        "Opportunity Number", "Opportunity Name", "Sales Stage", "Product Line", "Product Name",
        "Schedule Quantity", "Schedule Amount (converted)", "Schedule Date", "First Ship Date",
        "Order Date", "Created Date", "Primary Distributor", "Primary Channel Partner",
        "Account Name", "Siebel Account Number", "Commit Category", "Last Modified Date",
        "Opportunity Owner",
    ],
    "dsr": [
        "Account Name", "Account Number", "Account Country", "Reseller Translated Name",
        "End User Account Number", "End User Name", "Route To Market", "APAC Order Type",
        "Line Item Status", "Purchase Order Number", "Order Number", "ERP Invoice Number",
        "Line Booked Date", "Oracle Line  Number", "ERP Invoice Date", "Zebra CRD",
        "Scheduled Ship Date", "Part Number", "Product Line", "Price Concession Number",
        "Opportunity Number", "Quantity", "Amount USD SUM", "PTO - Part Number",
        "PTO - Line Amount (Gbl Currency - USD)", "Order Date",
    ],
    "backlog": None,
    "inventory": None,
    # Same list as POS_KEEP in app/review.js.
    "pos": [
        "Fiscal Year", "Fiscal Quarter (Invoice)", "Fiscal Week", "Fiscal Month (Invoice)", "Distributor Name",
        "Distributor Account Number", "Distributor Country", "Reseller Account Number", "Reseller Name (Translated)",
        "End User Name (Translated)", "Eud User NVL", "POS Quantity", "SIP After rebate", "Product Line-6",
        "Product Line-6-1", "BU", "Vertical", "PC Type",
        "Invoice Fiscal Year", "Invoice Fiscal Quarter", "Invoice Fiscal Week", "POS Invoice Date - Submitted",
        "Submitting Account Number", "Submitting Account Name", "Submitting Country", "Client Account Number",
        "Client Translated Name", "POS Client Name - Submitted", "End User Translated Name", "NVL End User",
        "POS Quantity - Submitted", "POS Extended Cost (Net) (USD @ Planned Rate)", "SIP After rabe Amount",
        "POS Extended Cost Gross (Gbl Currency - USD) @ Plan Rate",
        "Custom Product-Line", "Custom Sub Product Line", "Business Division_cc", "PC type", "Route To Market",
        "Zebra Part Number", "Product Family", "Product Line", "Sell out rebate%", "Country",
    ],
}


def detect(headers):
    hs = {str(h).strip() for h in headers if h is not None}
    for t, req in SIGNATURES.items():
        if all(r in hs for r in req):
            return t
    if ("Zebra Part Number" in hs and hs & {"Invoice Fiscal Quarter", "Fiscal Quarter (Invoice)"}
            and hs & {"POS Quantity - Submitted", "POS Quantity"}):
        return "pos"
    return None


def cell(v):
    if isinstance(v, dt.datetime):
        return v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return v


def tables_from_html(path):
    from bs4 import BeautifulSoup

    raw = open(path, "rb").read().decode("cp1252", errors="replace")
    soup = BeautifulSoup(raw, "lxml")
    for table in soup.find_all("table"):
        rows = []
        for tr in table.find_all("tr"):
            rows.append([c.get_text().strip() or None for c in tr.find_all(["th", "td"])])
        yield "html", rows


def tables_from_xlsx(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        yield ws.title, [list(map(cell, r)) for r in ws.iter_rows(values_only=True)]


def main():
    args = sys.argv[1:]
    targets = None
    if "--targets" in args:
        i = args.index("--targets")
        with open(args[i + 1], encoding="utf-8") as fh:
            targets = json.load(fh)
        del args[i:i + 2]
    out, files = args[0], args[1:]
    tables = []
    for f in files:
        head = open(f, "rb").read(64).lstrip()
        src = tables_from_html(f) if head.startswith(b"<") else tables_from_xlsx(f)
        name = re.sub(r"^[0-9a-f]{8}-", "", f.rsplit("/", 1)[-1])
        found = []
        for sheet, rows in src:
            for i, r in enumerate(rows[:15]):
                t = detect(r)
                if not t:
                    continue
                headers = [str(h).strip() if h is not None else "" for h in r]
                keep = KEEP[t]
                idx = [j for j, h in enumerate(headers) if keep is None or h in keep]
                body = [[row[j] if j < len(row) else None for j in idx] for row in rows[i + 1:]]
                body = [b for b in body if any(v not in (None, "") for v in b)]
                cols = [headers[j] for j in idx]
                if t == "dsr":  # Hong Kong only
                    c = cols.index("Account Country")
                    body = [b for b in body if b[c] == "Hong Kong"]
                if t == "pos" and "Country" in cols:  # Hong Kong only
                    c = cols.index("Country")
                    body = [b for b in body if b[c] is None or re.fullmatch(r"hong\s*kong", str(b[c]).strip(), re.I)]
                found.append({"type": t, "name": name, "headers": cols, "rows": body, "sheet": sheet})
                break
            if found and found[-1]["type"] != "pos":
                break  # one table per non-POS file, as in the app
        pos = [t for t in found if t["type"] == "pos"]
        # Biggest POS sheet only: the others are pivot drill-downs of it.
        pick = max(pos, key=lambda t: len(t["rows"])) if pos else (found[0] if found else None)
        if pick:
            sheet = pick.pop("sheet")
            tables.append(pick)
            print(f"{name} [{sheet}] -> {pick['type']}: {len(pick['rows'])} rows", file=sys.stderr)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("// Generated by tools/build_initial_data.py. Contains customer data: do not commit.\n")
        fh.write("window.ZEBRA_INITIAL_DATA = ")
        data = {"builtAt": dt.datetime.now().isoformat(timespec="seconds"), "tables": tables}
        if targets:
            data["targets"] = targets
        json.dump(data, fh,
                  ensure_ascii=False, separators=(",", ":"), default=str)
        fh.write(";\n")


if __name__ == "__main__":
    main()
