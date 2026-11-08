# Citygate RFID Inventory

A browser app for store inventory from fixed RFID readers, without a location engine.
Hardware: Zebra FXR90 readers with external AN520, AN510 and AN670 antennas.

There is no X/Y position and no path. Each antenna belongs to one zone, so an item's location
is the zone whose antennas read it best. Zone changes and doorway crossings add up to the
store's flow.

## Views

| View | What it shows |
|---|---|
| Dashboard | On hand (floor / stockroom), sizes on floor, sales, store flow, stockroom → floor, alerts. Store map with zones, antenna positions and stock or flow per zone. Hourly flow, zone table, top replenishment. |
| Inventory | Every SKU and size: floor, fixture level, stockroom, fitting rooms, cash wrap, sold, missing. Expand a row for its EPCs. Copy or download CSV. |
| Flow | Moves into each zone, zone-to-zone matrix, one zone by hour, stockroom door and entrance counts, fitting room items, visits and conversion. |
| Replenishment | Sizes below fixture level (or below today's sales rate × 4 h) that the stockroom can cover. |
| Zones & antennas | Map with readers, cables and rough read areas. Move antennas on the map, change reader / port / model / zone, port-clash checks, reads per antenna and health. |
| Reads & import | Latest reads, zone moves, doorway crossings. Load real reads (CSV or FXR90 IoT Connector JSON) and POS sales. |

## Default layout (2 × FXR90-8, 16 antennas)

| Zone | Antennas | Why |
|---|---|---|
| Stockroom | A1 AN520 | Area count of back stock |
| Stockroom door | A2 inner + A3 outer, AN510 | Direction: stockroom → floor, floor → stockroom |
| Polo Wall, Men's, Clearance, Children, Women's | AN520 (1–3 per zone) | Area count, mounted below the false ceiling |
| Fitting rooms | A7, A8 AN520 | Zone level only, no per-room |
| Accessories table | B4 AN670 | Near field, reads only what is on the table |
| Cash wrap | B6 AN670 | Near field under the counter |
| Entrance | B7 inner + B8 outer, AN510 | Exits; an exit with no POS sale is a P1 alert |

Top shelf overstock, queue and window display have no antenna and are hatched on the map.

Each doorway antenna has a fixed reference tag beside it (EPC prefix `FFFF`). Its reads prove the
antenna is alive between crossings. They count for antenna health and never as stock.

## How the engine decides

- Reads are grouped into 10 s windows. Per zone: peak RSSI + 2 × log2(read count).
- An item moves to a new zone when that zone wins two windows in a row, wins by 6 dB, or, when
  the current zone did not read it at all, reads it at −60 dBm or stronger. One stray read does not move it.
- Doorways: a read on the inner antenna, then on the outer within 8 s, is "out"; the reverse is "in".
  Portal reads weaker than −65 dBm are ignored, with a 30 s cooldown per tag.
- Received: a tag first seen in the stockroom after opening.
- Missing: not read for 4 h. Left in fitting room: there over 15 min. Misplaced: on a floor zone
  that is not its home zone for over 15 min. Antenna silent: no reads for 10 min while open.

All thresholds are in `config.js` (`PARAMS`).

## Import format

CSV, one read per row: `timestamp, epc, antenna, rssi`. Instead of `antenna`, give `reader, port`
(matched to the Zones & antennas page). Optional `sku, size`. Timestamps can be `HH:MM:SS`, ISO,
or epoch seconds / ms.

JSON: tag events from the FXR90 IoT Connector, one per line or as an array, with
`data.idHex`, `data.antenna` (port), `data.peakRssi` and `timestamp`. Choose the reader the file came from.

POS sales CSV: `timestamp, epc` plus optional `sku, size, price`.

## Run it

```sh
cd rfid && python3 -m http.server 8000   # http://localhost:8000
```

It opens on a simulated day (illustrative products, about 650 tags, 2 FXR90). Antenna edits stay in
the browser (localStorage). Nothing is sent to a server.

To build a single-file copy for an artifact:

```sh
python3 -I tools/build_rfid_artifact.py /path/to/citygate-rfid.html
```

## Tests

```sh
node tests/rfid-engine.test.js
```

The tests use synthetic reads only. The last test runs a full simulated day and checks the
engine's zones against the simulator's ground truth.

## Files

- `config.js` – store outline, zones, readers, antennas, doorway pairs, thresholds, sample catalogue
- `engine.js` – zone engine: reads + sales → zones, moves, flow, inventory, replenishment, alerts
- `sim.js` – simulated store day that produces raw FXR90 reads and POS sales
- `app.js`, `index.html` – the web app
