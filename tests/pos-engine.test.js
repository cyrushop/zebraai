// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/pos-engine.test.js
'use strict';
const assert = require('assert');
const P = require('../pos/pos-engine.js');

const BI_H = ['StandardEndUserName', 'NetAmount_After_Rebate', 'Quantity', 'Fiscal Year', 'Fiscal Quarter', 'DistributorName',
  'StandardResellerName', 'ProductLine', 'ProductFamily', 'Source', 'Enduservertical', 'PathToM'];
const Z_H = ['Fiscal Quarter (Invoice)', 'Distributor Name', 'Reseller Name (Translated)', 'Client Name - Raw', 'Eud User NVL',
  'Product Line', 'Product Family', 'Business Division', 'Vertical', 'POS Quantity', 'SIP After rebate'];
const F_H = ['Invoice Fiscal Year', 'Invoice Fiscal Quarter', 'Submitting Account Name', 'Client Name - Raw Capitalized_cc',
  'NVL End User', 'Product Line', 'Product Family', 'Business Division_cc', 'POS Quantity - Submitted', 'SIP After rabe Amount'];

const grid = (head, rows) => [head].concat(rows.map((o) => head.map((h) => (h in o ? o[h] : null))));
const bi = (y, q, eu, amt, extra) => Object.assign({
  StandardEndUserName: eu, NetAmount_After_Rebate: amt, Quantity: 1, 'Fiscal Year': y, 'Fiscal Quarter': q,
  DistributorName: 'Disti A', StandardResellerName: 'Reseller A', ProductLine: 'Desktop', ProductFamily: 'ZD421',
  Source: 'AIT', Enduservertical: 'Retail', PathToM: 'POS'
}, extra);
const z = (yq, eu, amt, extra) => Object.assign({
  'Fiscal Quarter (Invoice)': yq, 'Distributor Name': 'Disti A', 'Reseller Name (Translated)': 'Reseller A',
  'Eud User NVL': eu, 'Product Line': 'Mobile Computing', 'Product Family': 'TC22', 'Business Division': 'EVM',
  Vertical: 'Retail', 'POS Quantity': 2, 'SIP After rebate': amt
}, extra);
const f = (q, eu, amt, extra) => Object.assign({
  'Invoice Fiscal Year': '2025', 'Invoice Fiscal Quarter': '2025 ' + q, 'Submitting Account Name': null,
  'Client Name - Raw Capitalized_cc': 'Reseller B', 'NVL End User': eu, 'Product Line': 'RFID Devices',
  'Product Family': 'RFD40', 'Business Division_cc': 'EVM', 'POS Quantity - Submitted': 1, 'SIP After rabe Amount': amt
}, extra);

const sheets = [
  // Full-year BI extract for 2024, with one Tier 1 (direct) line.
  { file: 'bi-2024.xlsx', sheet: 'Sheet1', grid: grid(BI_H, [
    bi(2024, 'Q1', 'Alpha', 100), bi(2024, 'Q2', 'Alpha', 200), bi(2024, 'Q3', 'Beta', 300),
    bi(2024, 'Q4', 'Beta', 400, { PathToM: 'Tier 1', DistributorName: 'Partner T1' })]) },
  // Pivot drill-down of the same workbook: must be ignored.
  { file: 'bi-2024.xlsx', sheet: 'Detail', grid: [['title'], [], grid(BI_H, [bi(2024, 'Q4', 'Beta', 400)])[0], grid(BI_H, [bi(2024, 'Q4', 'Beta', 400)])[1]] },
  // A Q4-only file for 2024 in another layout: loses to the full year.
  { file: 'q4-2024.xlsx', sheet: '工作表1', grid: grid(Z_H, [z('2024 Q 4', 'Alpha', 999)]) },
  // A Zyme layout file for 2023, header below a title row.
  { file: 'pos-2023.xlsx', sheet: '工作表1', grid: [['Report'], ...grid(Z_H, [z('2023 Q 1', 'Alpha', 50), z('2023 Q 4', 'Gamma', 150), z('2023 Q 4', 'NULL', -20)])] },
  // FY25 layout, blank distributor = direct.
  { file: 'fy25.xlsx', sheet: '工作表1', grid: grid(F_H, [f('Q1', 'Alpha', 500), f('Q4', 'Delta', 250)]) },
  // A pivot sheet with no recognised header.
  { file: 'fy25.xlsx', sheet: 'Pivot', grid: [['列標籤', '加總'], ['AIT', 1]] }
];

const r = P.combine(sheets);
const used = Object.fromEntries(r.used.map((u) => [u.year, u]));
assert.deepStrictEqual(r.used.map((u) => u.year), [2023, 2024, 2025]);
assert.strictEqual(used[2024].file, 'bi-2024.xlsx');
assert.strictEqual(used[2024].sheet, 'Sheet1');
assert.strictEqual(used[2024].sales, 1000);
assert.strictEqual(used[2023].sales, 180, 'credits are kept, so totals are net');
assert.ok(r.skipped.some((s) => s.file === 'q4-2024.xlsx'), 'Q4-only file for a covered year is skipped');
assert.ok(r.skipped.some((s) => s.sheet === 'Detail'), 'smaller sheet in the same workbook is skipped');

const l24 = r.lines.filter((l) => l.year === 2024);
assert.strictEqual(l24.find((l) => l.quarter === 'Q4').distributor, P.DIRECT, 'Tier 1 is direct');
assert.strictEqual(l24[0].category, 'Barcode printers');
assert.strictEqual(r.lines.find((l) => l.year === 2025).distributor, P.DIRECT, 'blank distributor is direct');
assert.strictEqual(r.lines.find((l) => l.year === 2025).category, 'RFID');
assert.strictEqual(r.lines.find((l) => l.end_user === 'Unspecified').sales, -20, 'NULL names become Unspecified');

const s = P.summarize(r.lines);
assert.deepStrictEqual(s.years, [2023, 2024, 2025]);
assert.strictEqual(s.kpi.sales.value, 750);
assert.strictEqual(s.kpi.sales.prior, 1000);
assert.strictEqual(s.kpi.sales.change, -0.25);
assert.strictEqual(s.kpi.q4.value, 250);
assert.strictEqual(s.kpi.q4.change, -0.375);
assert.strictEqual(s.kpi.vsFirst.prior, 180);

const q4_2024 = s.quarterly.find((q) => q.period === '2024 Q4');
assert.strictEqual(q4_2024.yoy, (400 - 130) / 130);

const c25 = s.customers.find((c) => c.scope === 'all' && c.year === 2025);
assert.deepStrictEqual([c25.new_accounts, c25.retained, c25.lost], [1, 1, 1]); // Delta new, Alpha kept, Beta lost
assert.strictEqual(c25.lost_prior_sales, 700);

const alpha = s.topEndUsers.find((e) => e.scope === 'all' && e.end_user === 'ALPHA');
assert.strictEqual(alpha.total, 850);
assert.strictEqual(alpha.change, 500 - 300);

const share = s.category.filter((c) => c.scope === 'all' && c.year === 2024);
assert.strictEqual(share.reduce((a, c) => a + c.share, 0), 1);

assert.ok(P.toCsv(r.lines).split('\n')[0].startsWith('year,quarter,period'));
console.log('pos-engine: all tests passed');
