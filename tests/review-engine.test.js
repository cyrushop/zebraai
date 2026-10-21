// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/review-engine.test.js
'use strict';
const assert = require('assert');
const E = require('../review/engine.js');

const H = ['First Ship Fiscal Quarter New', 'Opportunity Number', 'Opportunity Name', 'Sales Stage', 'Product Line',
  'Product Sub Line', 'Schedule Amount (converted)', 'Primary Distributor', 'Primary Channel Partner',
  'Channel Partner Siebel Account Number', 'Account Name', 'Siebel Account Number'];
const row = (q, opp, name, stage, pl, amt, acct, extra = {}) => {
  const o = Object.assign({ 'Product Sub Line': '', 'Primary Distributor': 'VSTECS (HK) LIMITED', 'Primary Channel Partner': 'Partner A',
    'Channel Partner Siebel Account Number': '111.0', 'Siebel Account Number': '900' }, extra,
    { 'First Ship Fiscal Quarter New': q, 'Opportunity Number': opp, 'Opportunity Name': name, 'Sales Stage': stage,
      'Product Line': pl, 'Schedule Amount (converted)': String(amt), 'Account Name': acct });
  return H.map(h => o[h] ?? '');
};

const pipe = E.parsePipeline([['Report title'], H,
  row('2026 Q4', 'Z-1', 'Acme-HK-TC58', 'Closed - Won', 'Mobile Computing', 1000, 'Acme Ltd'),
  row('2026 Q4', 'Z-2', 'Acme-HK-ZT411', 'Secure', 'Tabletop', 2000, 'Acme Ltd'),
  row('2026 Q4', 'Z-3', 'Acme-HK-Labels-F', 'Secure', 'Barcode Supplies', 500, 'Acme Ltd'),
  row('2026 Q4', 'Z-4', 'Beta-HK-MDM', 'Validate', 'Mobile Computing', 300, 'Beta Co', { 'Product Sub Line': 'EMC Software', 'Primary Distributor': 'Chinetek Group Company Ltd' }),
  row('2027 Q1', 'Z-5', 'Beta-HK-RFD40-P', 'Qualify', 'RFID Devices', 800, 'Beta Co'),
  row('n/a', 'Z-6', 'junk', 'Secure', 'X', 1, 'X'),
]);

// parsing: header found below a title row, non-quarter rows dropped, ids normalised
assert.strictEqual(pipe.length, 5);
assert.strictEqual(pipe[0].pid, '111');
assert.strictEqual(pipe[1].amt, 2000);

// quarters and tags
assert.strictEqual(E.qAdd('2026 Q4', 1), '2027 Q1');
assert.strictEqual(E.qAdd('2026 Q4', 2), '2027 Q2');
assert.strictEqual(E.firstWeekOf('2026 Q4'), 40);
assert.strictEqual(E.tagOf('Acme-HK-Labels-F'), 'F');
assert.strictEqual(E.tagOf('Beta-HK-RFD40-P'), 'P');
assert.strictEqual(E.tagOf('Police-HK-RFID-PNAL'), 'Real');

// classification helpers
assert.strictEqual(E.isSoftware(pipe[3]), true);
assert.strictEqual(E.isSoftware(pipe[1]), false);
assert.strictEqual(E.distOf(pipe[0]), 'VST');
assert.strictEqual(E.distOf(pipe[3]), 'Chinetek');

// week dashboard: POS for key ACME is allocated Closed-Won first, then Secure real, then -F
const pos = E.parsePOS([
  ['Invoice Fiscal Quarter', 'Invoice Fiscal Week', 'POS End User Name - Submitted', 'NVL End User', 'POS Extended Cost (Net) (USD @ Planned Rate)'],
  ['2026 Q4', '2026 Week 40', 'ACME LTD', '', 1500],
  ['2026 Q4', '2026 Week 41', 'acme ltd hk', '', 100],
  ['2026 Q4', '2026 Week 41', 'OTHER CO', '', 50],
  ['2026 Q3', '2026 Week 39', 'ACME LTD', '', 999],
]);
const W = E.weekDashboard(pipe, pos, { curQ: '2026 Q4', target: 13000, keys: { 'Acme Ltd': 'ACME' } });
const by = Object.fromEntries(W.rows.map(r => [r.opp, r]));
assert.strictEqual(W.posQtd, 1650);
assert.strictEqual(W.latestWk, 41);
assert.strictEqual(W.elapsed, 2);
assert.strictEqual(by['Z-1'].alloc, 1000);
assert.strictEqual(by['Z-1'].status, '已出貨');
assert.strictEqual(by['Z-2'].alloc, 600);
assert.strictEqual(by['Z-2'].status, '部分出貨');
assert.strictEqual(by['Z-3'].alloc, 0);
assert.strictEqual(by['Z-3'].status, '未出貨');
assert.strictEqual(W.matched, 1600);
assert.strictEqual(W.notMatched, 50);
assert.strictEqual(W.openSecure, 1400);
assert.strictEqual(W.openSecureF, 500);
assert.strictEqual(W.openValidate, 300);
assert.strictEqual(W.remaining, 11350);
assert.strictEqual(W.realGap, 9950);
assert.strictEqual(W.projected, 3050);
assert.deepStrictEqual(W.weekly.slice(0, 2).map(w => w.cum), [1500, 1650]);
assert.strictEqual(W.weekly[2].cum, null);

// account list: NAL / MPL rows, matched by Siebel ID first, then by name
const accts = E.parseAccounts([
  ['#', 'Type', 'Account Name', 'Account ID USD', 'Region', 'FY26 RAD', 'FY27 Projection'],
  [1, 'NAL', 'ACME LTD', 900, 'HK', 'R', 20000],
  [2, 'NAL', 'BETA CO', '', 'HK', 'a', ''],
  [3, 'MPL', 'PARTNER A', 111, 'HK', 'D', 5000],
  [4, 'Other', 'IGNORED', 1, 'HK', '', ''],
]);
assert.strictEqual(accts.length, 3);
assert.strictEqual(accts[1].rad, 'A');
const nal = E.accountIndex(accts, 'NAL');
assert.strictEqual(nal.size, 2);
assert.strictEqual(nal.find('900', 'whatever').name, 'ACME LTD');
assert.strictEqual(nal.find('', 'Beta Co').name, 'BETA CO');
assert.strictEqual(E.accountIndex(accts, 'MPL').find('111', '').name, 'PARTNER A');

console.log('review engine: all tests passed');
