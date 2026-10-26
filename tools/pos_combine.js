// Combine POS Excel exports into the JSON that tools/build_pos_offline.py
// embeds, using the same engine as the page.
//
//   node tools/pos_combine.js path/to/xlsx-0.18.5 OUT.json file1.xlsx file2.xlsx ...
//
// The output contains customer data: keep it out of this public repository.
'use strict';
const fs = require('fs');
const path = require('path');
const ZPos = require('../pos/pos-engine.js');

const [xlsxDir, out, ...files] = process.argv.slice(2);
if (!xlsxDir || !out || !files.length) {
  console.error('usage: node tools/pos_combine.js XLSX_PACKAGE_DIR OUT.json FILE.xlsx ...');
  process.exit(1);
}
const XLSX = require(path.resolve(xlsxDir));
const sheets = [];
files.forEach((f) => {
  const wb = XLSX.read(fs.readFileSync(f), { type: 'buffer' });
  wb.SheetNames.forEach((n) => {
    sheets.push({ file: path.basename(f), sheet: n, grid: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) });
  });
});
const r = ZPos.combine(sheets);
fs.writeFileSync(out, JSON.stringify(r));
r.used.forEach((u) => console.log(u.year, u.file, u.sheet, u.quarters.join(' '), u.rows, 'lines', Math.round(u.sales)));
r.skipped.forEach((s) => console.log('skipped', s.file, s.sheet, '-', s.reason));
