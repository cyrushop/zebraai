// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/engine.test.js
'use strict';
const assert = require('assert');
const E = require('../app/engine.js');

const PIPE_H = ['Opportunity Number', 'Opportunity Name', 'Sales Stage', 'First Ship Fiscal Quarter New', 'PC Number',
  'Product Name', 'Schedule Quantity', 'Schedule Amount (converted)', 'Schedule Date', 'Created Date',
  'Primary Distributor', 'Primary Channel Partner', 'Account Name', 'Forecast Notes'];
const DSR_H = ['Account Name', 'Account Number', 'Account Country', 'End User Name', 'APAC Order Type', 'Line Item Status',
  'Purchase Order Number', 'Order Number', 'Line Booked Date', 'Scheduled Ship Date', 'Part Number',
  'Price Concession Number', 'Opportunity Number', 'Quantity', 'Amount USD SUM'];
const INV_H = ['Distributor Name', 'Distributor Account Number', 'Inventory As Of Date', 'Zebra Part Number', 'On-Hand Quantity',
  'Committed Quantity', 'Unit Inventory Price'];
const BL_H = ['Distributor Name', 'Distributor Account Number', 'Distributor to Reseller Order Number', 'Distributor to Reseller Order Date',
  'Scheduled Shipping Date', 'Backlog As Of Date', 'PO Number', 'Zebra Part Number', 'Quantity'];

const VAD = 'VSTECS (HK) LIMITED';
const pipe = (opp, name, part, qty, amt, eu, extra) => Object.assign({
  'Opportunity Number': opp, 'Opportunity Name': name, 'Sales Stage': 'Secure', 'First Ship Fiscal Quarter New': '2026 Q4',
  'Product Name': part, 'Schedule Quantity': qty, 'Schedule Amount (converted)': amt, 'Schedule Date': '15/11/2026',
  'Created Date': '01/08/2026', 'Primary Distributor': VAD, 'Primary Channel Partner': 'Partner A', 'Account Name': eu,
  'Forecast Notes': ''
}, extra);
const dsr = (po, part, qty, amt, status, extra) => Object.assign({
  'Account Name': VAD, 'Account Number': '61055936', 'Account Country': 'Hong Kong', 'APAC Order Type': 'Standard Line-ZSG',
  'Line Item Status': status, 'Purchase Order Number': po, 'Order Number': '9' + po.replace(/\D/g, ''),
  'Line Booked Date': '2026-09-01T00:00:00', 'Scheduled Ship Date': '2026-11-01T00:00:00', 'Part Number': part,
  'Quantity': qty, 'Amount USD SUM': amt
}, extra);
const table = (type, headers, objs) => ({ type, name: type, headers, rows: objs.map(o => headers.map(h => o[h] ?? null)) });

const tables = [
  table('pipeline', PIPE_H, [
    pipe('Z-1', 'Opp linked', 'TC22', 10, 5000, 'Alpha Retail Limited'),
    pipe('Z-2', 'End user', 'ZD421', 5, 1500, 'Beta Hospital'),
    pipe('Z-3', 'Basket', 'MC34', 4, 2400, 'Gamma Logistics'),
    pipe('Z-3', 'Basket', 'CRD-MC34', 4, 400, 'Gamma Logistics'),
    pipe('Z-4', 'From stock', 'DS2208', 6, 300, 'Delta Co'),
    pipe('Z-5', 'Nothing', 'ET401', 3, 1800, 'Epsilon Ltd'),
    pipe('Z-6', 'Lost', 'TC22', 1, 500, 'Zeta', { 'Sales Stage': 'Closed - Lost' }),
    pipe('Z-7', 'Substituted', 'TC58-OLD', 2, 2000, 'Eta Ltd')
  ]),
  table('dsr', DSR_H, [
    dsr('PO-1', 'TC22', 6, 3600, 'Shipped', { 'Opportunity Number': 'Z-1', 'Price Concession Number': 81000001, 'End User Name': 'Alpha Retail' }),
    dsr('PO-1', 'TC22', 4, 2400, 'Open Order', { 'Opportunity Number': 'Z-1', 'Price Concession Number': 81000001 }),
    dsr('PO-2', 'ZD421', 5, 2000, 'Shipped', { 'End User Name': 'BETA HOSPITAL LTD' }),
    dsr('PO-3', 'MC34', 4, 3200, 'Open Order'),
    dsr('PO-3', 'CRD-MC34', 4, 480, 'Open Order'),
    dsr('PO-7', 'TC58-NEW', 2, 2000, 'Shipped', { 'Opportunity Number': 'Z-7', 'Price Concession Number': 81000007 }),
    dsr('PO-X', 'TC22', 1, 600, 'Shipped', { 'Account Country': 'Taiwan' })
  ]),
  table('inventory', INV_H, [{ 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936',
    'Inventory As Of Date': '2026-10-17T00:00:00', 'Zebra Part Number': 'DS2208', 'On-Hand Quantity': 10, 'Unit Inventory Price': 70 }]),
  table('backlog', BL_H, [{ 'Distributor Name': 'VSTECS HK', 'Distributor Account Number': '61055936',
    'Distributor to Reseller Order Number': 'PO-3', 'PO Number': 'PO-3', 'Zebra Part Number': 'MC34', 'Quantity': 4,
    'Distributor to Reseller Order Date': '2026-08-30T00:00:00', 'Backlog As Of Date': '2026-10-16' }])
];

const a = E.analyse(E.buildDataset(tables));
const by = name => a.lines.filter(r => r.line.oppName === name);

assert.strictEqual(by('Lost').length, 0, 'Closed - Lost is skipped');
const linked = by('Opp linked')[0];
assert.strictEqual(linked.q.opp, 10);
assert.strictEqual(linked.status, 'zebra-backlog', '4 still open on the opp');
assert.strictEqual(linked.claimQty, 0, 'PC-priced order is not a claim');

const eu = by('End user')[0];
assert.strictEqual(eu.status, 'eu-claim');
assert.strictEqual(eu.q.eu, 5);

const basket = by('Basket');
basket.forEach(r => assert.strictEqual(r.status, 'stock-claim'));
assert.strictEqual(basket[0].pieces[0].conf, 'high');
assert.ok(basket.find(r => r.line.product === 'MC34').vstConfirmed, 'VST reseller order confirms the PO');
assert.strictEqual(Math.round(basket.find(r => r.line.product === 'MC34').claimEst), 800, '(800 − 600) × 4');

const stock = by('From stock')[0];
assert.strictEqual(stock.status, 'vad-stock');
assert.strictEqual(stock.q.inv, 6);
assert.strictEqual(a.stock['vstecs|DS2208'].left, 4);

assert.strictEqual(by('Nothing')[0].status, 'not-ordered');
assert.strictEqual(by('Substituted')[0].status, 'substituted');

assert.ok(E.sameEndUser('A. S. Watson Retail (HK) Limited', 'A.S. Watson'));
assert.ok(!E.sameEndUser('DHL HK', 'UPS HK'));

console.log('engine tests passed:', a.lines.length, 'lines');
