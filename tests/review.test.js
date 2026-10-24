// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/review.test.js
'use strict';
const assert = require('assert');
const R = require('../app/review.js');

const POS24_H = ['Distributor Name', 'Distributor Account Number', 'Fiscal Week', 'Fiscal Quarter (Invoice)', 'Reseller Account Number',
  'Reseller Name (Translated)', 'Eud User NVL', 'Zebra Part Number', 'POS Quantity', 'Product Line', 'Product Line-6', 'Product Line-6-1',
  'Product Family', 'BU', 'PC Type', 'Sell out rebate%', 'SIP After rebate', 'Country', 'Fiscal Year'];
const POS25_H = ['Submitting Account Number', 'Submitting Account Name', 'Invoice Fiscal Year', 'Invoice Fiscal Quarter', 'Invoice Fiscal Week',
  'POS Invoice Date - Submitted', 'Client Account Number', 'Client Translated Name', 'NVL End User', 'POS Quantity - Submitted',
  'Zebra Part Number', 'Product Family', 'Product Line', 'POS Extended Cost (Net) (USD @ Planned Rate)', 'Custom Product-Line',
  'Custom Sub Product Line', 'PC type', 'Country', 'Some Other Column'];
const PIPE_H = ['Opportunity Number', 'Opportunity Name', 'Sales Stage', 'First Ship Fiscal Quarter New', 'Product Name', 'Product Line',
  'Schedule Quantity', 'Schedule Amount (converted)', 'Schedule Date', 'Created Date', 'Primary Distributor', 'Primary Channel Partner', 'Account Name'];
const INV_H = ['Distributor Name', 'Distributor Account Number', 'Inventory As Of Date', 'Zebra Part Number', 'On-Hand Quantity',
  'Committed Quantity', 'Unit Inventory Price'];
const BL_H = ['Distributor Name', 'Distributor Account Number', 'Distributor to Reseller Order Number', 'Distributor to Reseller Order Date',
  'Scheduled Shipping Date', 'Backlog As Of Date', 'PO Number', 'Zebra Part Number', 'Quantity'];

const VAD = 'VSTECS (HK) LIMITED', OTHER = 'Other Disti Ltd';
const grid = (headers, objs, pre) => (pre || []).concat([headers], objs.map(o => headers.map(h => o[h] ?? null)));
const table = (type, headers, objs) => ({ type, name: type, headers, rows: objs.map(o => headers.map(h => o[h] ?? null)) });

const p24 = (dist, wk, q, res, eu, part, qty, sip, pl) => ({
  'Distributor Name': dist, 'Distributor Account Number': '1', 'Fiscal Week': `2024 Week${String(wk).padStart(2, '0')}`,
  'Fiscal Quarter (Invoice)': `2024 Q ${q}`, 'Reseller Account Number': 'R-' + res, 'Reseller Name (Translated)': res,
  'Eud User NVL': eu, 'Zebra Part Number': part, 'POS Quantity': qty, 'Product Line-6': pl, 'Product Line-6-1': pl,
  'Product Family': part.slice(0, 4), 'BU': 'EVM', 'PC Type': 'Non PC', 'Sell out rebate%': 0.2, 'SIP After rebate': sip,
  'Country': 'HongKong', 'Fiscal Year': '2024'
});
const p25 = (year, dist, wk, res, eu, part, qty, net, pl, extra) => Object.assign({
  'Submitting Account Number': dist === VAD ? '61055936' : '2', 'Submitting Account Name': dist, 'Invoice Fiscal Year': String(year),
  'Invoice Fiscal Quarter': `${year} Q${Math.ceil(wk / 13.01)}`, 'Invoice Fiscal Week': `${year} Week ${String(wk).padStart(2, '0')}`,
  'POS Invoice Date - Submitted': `${year}-01-01T00:00:00`, 'Client Account Number': 'R-' + res, 'Client Translated Name': res.toUpperCase(),
  'NVL End User': eu, 'POS Quantity - Submitted': qty, 'Zebra Part Number': part, 'Product Family': part.slice(0, 4),
  'POS Extended Cost (Net) (USD @ Planned Rate)': net, 'Custom Product-Line': pl, 'Custom Sub Product Line': pl, 'PC type': 'NON PC',
  'Country': 'HongKong', 'Some Other Column': 'x'
}, extra);

// --- detection: header on row 2, non-HK rows dropped, unused columns trimmed
const g26 = grid(POS25_H, [
  p25(2026, VAD, 40, 'Alpha Systems', 'BIG RETAIL', 'TC22', 10, 5000, 'Mobile Computing'),
  p25(2026, VAD, 41, 'Beta Tech', 'RUN-RATE', 'ZD421', 4, 1200, 'Printers'),
  p25(2026, VAD, 30, 'Alpha Systems', 'BIG RETAIL', 'TC22', 2, 1000, 'Mobile Computing'),
  p25(2026, VAD, 35, 'Delta New', 'NEW EU', 'WLMT0', 30, 900, 'Mobile Computing', { 'PC type': 'NON PC' }),
  p25(2026, VAD, 33, 'Delta New', 'NEW EU', 'WLMT0', 40, 1200, 'Mobile Computing'),
  p25(2026, OTHER, 40, 'Gamma Ltd', '', 'DS2208', 5, 400, 'Adv Data Capture'),
  p25(2026, VAD, 40, 'Taiwan Reseller', '', 'TC22', 1, 999, 'Mobile Computing', { 'Country': 'Taiwan' })
], [['Details for Sum of POS …'], []]);
const t26 = R.tableFromGrid(g26, 'POS-2026.xlsx');
assert.strictEqual(t26.type, 'pos');
assert.strictEqual(t26.rows.length, 6, 'Taiwan row dropped');
assert.ok(t26.headers.indexOf('Some Other Column') < 0, 'unused columns trimmed');

const t25 = R.tableFromGrid(grid(POS25_H, [
  p25(2025, VAD, 40, 'Alpha Systems', 'BIG RETAIL', 'TC22', 4, 2000, 'Mobile Computing'),
  p25(2025, VAD, 45, 'Alpha Systems', 'BIG RETAIL', 'TC22', 8, 8000, 'Mobile Computing'),
  p25(2025, VAD, 30, 'Alpha Systems', 'BIG RETAIL', 'TC22', 1, 500, 'Mobile Computing'),
  p25(2025, VAD, 20, 'Old Partner', 'GONE', 'MC34', 1, 3000, 'Mobile Computing'),
  p25(2025, VAD, 41, 'Beta Tech', '', 'ZD421', 2, 1500, 'Printers')
]), 'FY25.xlsx');
const t24 = R.tableFromGrid(grid(POS24_H, [
  p24(VAD, 40, 4, 'Alpha Systems', 'BIG RETAIL', 'TC22', 2, 800, 'Mobile Computing'),
  p24(VAD, 10, 1, 'Old Partner', 'GONE', 'MC34', 1, 1600, 'Mobile Computing')
]), 'POS2024.xlsx');
assert.strictEqual(t24.type, 'pos');

// --- 2024 net value is derived from SIP and the sell-out rebate
const n24 = R.normPos(t24);
assert.strictEqual(n24[0].net, 1000);
assert.strictEqual(n24[0].derived, true);
assert.strictEqual(n24[0].q, 4);
assert.strictEqual(n24[0].week, 40);
assert.strictEqual(n24[0].distKey, 'vstecs');

// --- biggest POS sheet per file wins (pivot drill-downs are subsets)
assert.strictEqual(R.pickTable([Object.assign({}, t25, { rows: t25.rows.slice(0, 1) }), t25]).rows.length, 5);

// --- a later upload of the same fiscal year replaces the earlier one
const dup = Object.assign({}, t25, { name: 'FY25-old.xlsx', rows: t25.rows.slice(0, 1) });
assert.strictEqual(R.buildPos([dup, t25]).rows.filter(r => r.year === 2025).length, 5);
assert.strictEqual(R.posSlot(t25), 'pos|2025');

const tables = [
  t24, t25, t26,
  table('pipeline', PIPE_H, [
    { 'Opportunity Number': 'Z-1', 'Opportunity Name': 'Big rollout', 'Sales Stage': 'Secure', 'First Ship Fiscal Quarter New': '2026 Q4',
      'Product Name': 'TC22', 'Product Line': 'Mobile Computing', 'Schedule Quantity': 20, 'Schedule Amount (converted)': 10000,
      'Schedule Date': '15/11/2026', 'Created Date': '01/08/2026', 'Primary Distributor': VAD, 'Primary Channel Partner': 'Alpha Systems Limited', 'Account Name': 'Big Retail' },
    { 'Opportunity Number': 'Z-1', 'Opportunity Name': 'Big rollout', 'Sales Stage': 'Secure', 'First Ship Fiscal Quarter New': '2026 Q4',
      'Product Name': 'TC22', 'Product Line': 'Mobile Computing', 'Schedule Quantity': 10, 'Schedule Amount (converted)': 5000,
      'Schedule Date': '15/02/2027', 'Created Date': '01/08/2026', 'Primary Distributor': VAD, 'Primary Channel Partner': 'Alpha Systems Limited', 'Account Name': 'Big Retail' },
    { 'Opportunity Number': 'Z-2', 'Opportunity Name': 'Runrate Q4-R', 'Sales Stage': 'Validate', 'First Ship Fiscal Quarter New': '2026 Q4',
      'Product Name': 'ZD421', 'Product Line': 'Printers', 'Schedule Quantity': 5, 'Schedule Amount (converted)': 2000,
      'Schedule Date': '01/12/2026', 'Created Date': '01/08/2026', 'Primary Distributor': VAD, 'Primary Channel Partner': 'Beta Tech', 'Account Name': 'Run' },
    { 'Opportunity Number': 'Z-3', 'Opportunity Name': 'Lost', 'Sales Stage': 'Closed - Lost', 'First Ship Fiscal Quarter New': '2026 Q4',
      'Product Name': 'TC22', 'Product Line': 'Mobile Computing', 'Schedule Quantity': 5, 'Schedule Amount (converted)': 9999,
      'Schedule Date': '01/12/2026', 'Created Date': '01/08/2026', 'Primary Distributor': VAD, 'Primary Channel Partner': 'X', 'Account Name': 'X' },
    { 'Opportunity Number': 'Z-4', 'Opportunity Name': 'Other VAD', 'Sales Stage': 'Secure', 'First Ship Fiscal Quarter New': '2026 Q4',
      'Product Name': 'TC22', 'Product Line': 'Mobile Computing', 'Schedule Quantity': 5, 'Schedule Amount (converted)': 7777,
      'Schedule Date': '01/12/2026', 'Created Date': '01/08/2026', 'Primary Distributor': OTHER, 'Primary Channel Partner': 'Gamma Ltd', 'Account Name': 'Y' },
    { 'Opportunity Number': 'Z-5', 'Opportunity Name': 'New partner deal', 'Sales Stage': 'Qualify', 'First Ship Fiscal Quarter New': '2027 Q1',
      'Product Name': 'MC34', 'Product Line': 'Mobile Computing', 'Schedule Quantity': 1, 'Schedule Amount (converted)': 3000,
      'Schedule Date': '01/02/2027', 'Created Date': '01/08/2026', 'Primary Distributor': VAD, 'Primary Channel Partner': 'Fresh Partner Co', 'Account Name': 'Z' }
  ]),
  table('inventory', INV_H, [
    { 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936', 'Inventory As Of Date': '2026-10-17T00:00:00', 'Zebra Part Number': 'TC22', 'On-Hand Quantity': 3, 'Unit Inventory Price': 500 },
    { 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936', 'Inventory As Of Date': '2026-10-17T00:00:00', 'Zebra Part Number': 'WLMT0', 'On-Hand Quantity': 200, 'Unit Inventory Price': 30 },
    { 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936', 'Inventory As Of Date': '2026-10-17T00:00:00', 'Zebra Part Number': 'WLMT0', 'On-Hand Quantity': 100, 'Unit Inventory Price': 20 },
    { 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936', 'Inventory As Of Date': '2026-10-17T00:00:00', 'Zebra Part Number': 'OLD1', 'On-Hand Quantity': 4, 'Unit Inventory Price': 100 }
  ]),
  table('backlog', BL_H, [
    { 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936', 'Distributor to Reseller Order Number': 'ZEB-1',
      'Distributor to Reseller Order Date': '2026-09-01T00:00:00', 'Backlog As Of Date': '2026-10-16', 'PO Number': 'ZEB-1', 'Zebra Part Number': 'TC22', 'Quantity': 5 }
  ])
];

const a = R.review(tables, { today: new Date(Date.UTC(2026, 9, 22)), scope: 'vstecs' });

// --- 1. pipeline: schedule-date quarter, open stages, primary distributor only
assert.strictEqual(a.curFq, '2026 Q4');
assert.strictEqual(a.nextFq, '2027 Q1');
assert.strictEqual(a.pipeline.total.cur, 12000, 'Z-1 Q4 line + Z-2; lost and other VAD excluded');
assert.strictEqual(a.pipeline.total.next, 8000, 'Z-1 Q1 schedule line + Z-5');
assert.strictEqual(a.pipeline.stages.filter(s => s.stage === 'Secure')[0].cur, 10000);
assert.strictEqual(a.pipeline.forecast.cur, 2000, '-R opp flagged as forecast');
const noFc = R.review(tables, { today: new Date(Date.UTC(2026, 9, 22)), scope: 'vstecs', excludeForecast: true });
assert.strictEqual(noFc.pipeline.total.cur, 10000);
assert.strictEqual(R.review(tables, { today: new Date(Date.UTC(2026, 9, 22)), scope: 'all' }).pipeline.total.cur, 19777);

// --- 2. QTD against the same fiscal weeks last year
assert.strictEqual(a.qtd.fromWeek, 40);
assert.strictEqual(a.qtd.toWeek, 41);
assert.strictEqual(a.qtd.net, 6200);
assert.strictEqual(a.qtd.ly, 3500, '2025 weeks 40–41 only');
assert.strictEqual(a.qtd.lyFull, 11500);
assert.strictEqual(a.qtd.ly2, 1000, '2024 week 40, derived net');
assert.ok(Math.abs(a.qtd.hkShare - 6200 / 6600) < 1e-9);

// --- 3. years: YTD is weeks 1–41 of each year
const y = {};
a.years.years.forEach(r => { y[r.year] = r; });
assert.strictEqual(y[2025].net, 15000);
assert.strictEqual(y[2025].ytd, 7000);
assert.strictEqual(y[2026].ytd, 9300);
assert.deepStrictEqual(y[2024].quarters, [2000, 0, 0, 1000]);

// --- 4. product lines
const mc = a.productLines.lines.filter(l => l.key === 'Mobile Computing')[0];
assert.strictEqual(mc.ytd[2026], 8100);
assert.strictEqual(a.productLines.lines[0].key, 'Mobile Computing', 'fixed product line order');

// --- 5. partners: status from YTD vs same weeks LY, pipeline matched by name
const P = {};
a.partners.list.forEach(p => { P[p.name] = p; });
assert.strictEqual(P['ALPHA SYSTEMS'].status, 'growing');
assert.strictEqual(P['ALPHA SYSTEMS'].pipeline, 15000, 'Alpha Systems Limited pipeline matched to POS reseller');
assert.strictEqual(P['DELTA NEW'].status, 'new');
assert.strictEqual(P['OLD PARTNER'].status, 'lapsed');
assert.strictEqual(P['Fresh Partner Co'].status, 'pipeline');
assert.ok(!P['GAMMA LTD'], 'other distributor partners excluded');

// --- 6. inventory
const I = {};
a.inventory.list.forEach(p => { I[p.part] = p; });
assert.strictEqual(I.TC22.status, 'short', '5 on backlog, 3 on hand');
assert.strictEqual(I.TC22.free, -2);
assert.strictEqual(I.WLMT0.onHand, 300, 'lots summed');
assert.strictEqual(I.WLMT0.value, 8000);
assert.strictEqual(I.WLMT0.status, 'overstock', '70 sold in 13 weeks, 300 free');
assert.strictEqual(I.OLD1.status, 'no-sales');
assert.strictEqual(a.inventory.totalValue, 9900);

// --- fiscal calendar: year starts on the Sunday nearest 1 Jan, 13-week quarters
assert.strictEqual(R.fqOf(new Date(Date.UTC(2026, 9, 3))), '2026 Q3');
assert.strictEqual(R.fqOf(new Date(Date.UTC(2026, 9, 4))), '2026 Q4');
assert.strictEqual(R.fqOf(new Date(Date.UTC(2027, 0, 2))), '2026 Q4');
assert.strictEqual(R.fqOf(new Date(Date.UTC(2027, 0, 3))), '2027 Q1');
assert.strictEqual(R.fqOf(new Date(Date.UTC(2025, 11, 30))), '2025 Q4', 'week 53 of a 53-week year');
assert.strictEqual(R.fiscal(new Date(Date.UTC(2026, 9, 16))).week, 41);

// --- with a DSR: sell-in, pipeline already ordered, backlog on a Zebra open order
const DSR_H = ['Account Name', 'Account Number', 'Account Country', 'End User Name', 'APAC Order Type', 'Line Item Status',
  'Purchase Order Number', 'Order Number', 'Line Booked Date', 'ERP Invoice Date', 'Scheduled Ship Date', 'Part Number', 'Product Line',
  'Price Concession Number', 'Opportunity Number', 'Quantity', 'Amount USD SUM'];
const dsr = (po, part, qty, amt, status, booked, inv, ssd, extra) => Object.assign({
  'Account Name': VAD, 'Account Number': '61055936', 'Account Country': 'Hong Kong', 'APAC Order Type': 'Standard Line-ZSG',
  'Line Item Status': status, 'Purchase Order Number': po, 'Order Number': '9' + po.replace(/\D/g, ''), 'Line Booked Date': booked,
  'ERP Invoice Date': inv, 'Scheduled Ship Date': ssd, 'Part Number': part, 'Product Line': 'Mobile Computing', 'Quantity': qty, 'Amount USD SUM': amt
}, extra);
const withDsr = tables.concat([table('dsr', DSR_H, [
  dsr('PO-1', 'TC22', 20, 9000, 'Shipped', '2026-09-20T00:00:00', '2026-10-10T00:00:00', '2026-10-09T00:00:00', { 'Opportunity Number': 'Z-1' }),
  dsr('PO-2', 'ZD421', 5, 1000, 'Shipped', '2026-09-01T00:00:00', '2026-10-02T00:00:00', '2026-10-01T00:00:00'),
  dsr('ZEB-1', 'TC22', 5, 2500, 'Open Order', '2026-09-02T00:00:00', null, '2026-11-01T00:00:00'),
  dsr('PO-4', 'MC34', 2, 3000, 'Open Order', '2026-10-01T00:00:00', null, '2027-02-01T00:00:00'),
  dsr('PO-5', 'TC22', 1, 777, 'Shipped', '2026-10-01T00:00:00', '2026-10-12T00:00:00', null, { 'Account Name': OTHER, 'Account Number': '2' })
])]);
const targets = { '2026 Q4': { vstecs: { sellIn: 20000, sellOutNet: 26000, sellOutGross: 27000, stretch: 26780, startInv: 5000, startDoi: 30, endInv: 6000, endDoi: 40 } } };
const b = R.review(withDsr, { today: new Date(Date.UTC(2026, 9, 24)), scope: 'vstecs', targets });

assert.strictEqual(b.sellIn.shipped, 9000, 'invoiced 2 Oct is fiscal Q3; other distributor excluded');
assert.strictEqual(b.sellIn.open, 2500);
assert.strictEqual(b.sellIn.openLater, 3000);
assert.strictEqual(b.sellIn.inHand, 11500);
assert.strictEqual(b.pipeline.stages.filter(s => s.stage === 'Secure')[0].curOrdered, 10000, 'Z-1 Q4 line found in the DSR by opp number');

const BI = {};
b.inventory.list.forEach(p => { BI[p.part] = p; });
assert.strictEqual(BI.TC22.incoming, 5, 'reseller backlog ZEB-1 is on a Zebra open order');
assert.strictEqual(BI.TC22.free, 3);
assert.notStrictEqual(BI.TC22.status, 'short');

assert.strictEqual(b.plan.has, true);
assert.strictEqual(b.plan.weeksTotal, 13);
assert.strictEqual(b.plan.out.net, 6200);
assert.strictEqual(b.plan.inn.gap, 20000 - 11500);
assert.strictEqual(b.plan.out.needNet, (26000 - 6200) / 11);
assert.strictEqual(R.review(withDsr, { today: new Date(Date.UTC(2026, 9, 24)), scope: 'all', targets }).plan.has, false);

// --- bridge: 2025 → 2026 YTD by partner adds up
const br = b.bridges.filter(x => x.base === 2025)[0];
assert.strictEqual(br.baseTotal, 7000);
assert.strictEqual(br.curTotal, 9300);
const cat = br.partners.cat;
assert.deepStrictEqual([cat.lost, cat.down, cat.up, cat.gained], [-3000, -300, 3500, 2100]);
assert.strictEqual(br.baseTotal + cat.lost + cat.down + cat.up + cat.gained, br.curTotal);

console.log('review tests passed');
